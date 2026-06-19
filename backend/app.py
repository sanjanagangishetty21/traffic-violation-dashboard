import os
import shutil
import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, Query, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from backend.database import (
    get_violations,
    update_violation_status,
    add_violation,
    get_settings,
    update_setting,
    get_analytics
)
from backend.cv_engine import TrafficCVEngine
from backend.mock_data import generate_mock_data
from backend.evaluator import DatasetEvaluator

app = FastAPI(title="APIC-TV Traffic Violation Detection API")

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Setup directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "..", "static")
UPLOAD_DIR = os.path.join(STATIC_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Mount static files
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Mount frontend files at root (index.html, styles.css, app.js)
FRONTEND_DIR = os.path.join(BASE_DIR, "..", "frontend")
if os.path.exists(FRONTEND_DIR):
    app.mount("/dashboard", StaticFiles(directory=FRONTEND_DIR, html=True), name="dashboard")

# Global instances
cv_engine = None
evaluator = None

def generate_synthetic_samples():
    """
    Generate synthetic traffic junction images using OpenCV drawing tools.
    This ensures we have high quality demo images in the /static folder immediately on startup.
    """
    os.makedirs(STATIC_DIR, exist_ok=True)
    
    # 1. General Traffic Image
    img1 = np.zeros((600, 800, 3), dtype=np.uint8)
    # Background: Green grass
    img1[:] = (34, 139, 34)
    # Road: Dark grey asphalt
    cv2.rectangle(img1, (100, 0), (700, 600), (80, 80, 80), -1)
    # Lanes
    cv2.line(img1, (400, 0), (400, 600), (255, 255, 255), 5)
    cv2.line(img1, (250, 0), (250, 600), (255, 255, 255), 2, cv2.LINE_AA)
    cv2.line(img1, (550, 0), (550, 600), (255, 255, 255), 2, cv2.LINE_AA)
    # Stop Line
    cv2.rectangle(img1, (100, 420), (700, 435), (240, 240, 240), -1)
    # Zebra Crossing
    for i in range(120, 690, 40):
        cv2.rectangle(img1, (i, 450), (i + 25, 500), (255, 255, 255), -1)
        
    # Draw Traffic Light Pole
    cv2.rectangle(img1, (710, 100), (720, 350), (50, 50, 50), -1)
    cv2.rectangle(img1, (695, 100), (735, 220), (10, 10, 10), -1)
    # Red Light ON, others OFF
    cv2.circle(img1, (715, 125), 15, (0, 0, 255), -1)
    cv2.circle(img1, (715, 160), 15, (20, 50, 20), -1)
    cv2.circle(img1, (715, 195), 15, (20, 20, 50), -1)
    
    # Draw Vehicles
    # Car 1 (Red SUV) crossing the stop line - Red Light Violation
    cv2.rectangle(img1, (150, 320), (230, 450), (30, 30, 180), -1) # Red Car body
    cv2.rectangle(img1, (160, 340), (220, 400), (220, 220, 220), -1) # Windshield
    # License plate crop zone
    cv2.rectangle(img1, (175, 435), (205, 445), (255, 255, 255), -1)
    cv2.putText(img1, "DL3C 5928", (177, 443), cv2.FONT_HERSHEY_SIMPLEX, 0.25, (0, 0, 0), 1)
    
    # Car 2 (Blue Sedan) stopped before stop line
    cv2.rectangle(img1, (450, 150), (520, 260), (180, 50, 50), -1) # Blue Car body
    cv2.rectangle(img1, (460, 170), (510, 220), (220, 220, 220), -1) # Windshield
    # License plate
    cv2.rectangle(img1, (475, 245), (495, 255), (255, 255, 255), -1)
    cv2.putText(img1, "MH12 GR88", (476, 253), cv2.FONT_HERSHEY_SIMPLEX, 0.25, (0, 0, 0), 1)
    
    # Motorcycle 1 with helmetless rider
    cv2.rectangle(img1, (300, 250), (330, 310), (20, 20, 20), -1) # Bike
    # Rider body
    cv2.circle(img1, (315, 220), 10, (180, 220, 240), -1) # Head (no helmet)
    
    # Save base sample images
    for idx in range(1, 11):
        cv2.imwrite(os.path.join(STATIC_DIR, f"sample_traffic_{idx}.jpg"), img1)
        # Create matching annotated sample too
        cv2.imwrite(os.path.join(STATIC_DIR, f"ann_sample_traffic_{idx}.jpg"), img1)

@app.on_event("startup")
def startup_event():
    global cv_engine, evaluator
    cv_engine = TrafficCVEngine()
    evaluator = DatasetEvaluator()
    
    # Ensure sample images exist in static folder
    generate_synthetic_samples()
    
    # Generate mock history if empty
    generate_mock_data()
    print("[INFO] Application startup sequence completed.")

class UpdateStatusRequest(BaseModel):
    status: str

class SettingsRequest(BaseModel):
    stop_line: Dict[str, List[float]]
    traffic_light_zone: Dict[str, float]
    no_parking_zone: List[List[float]]
    traffic_light_state: str
    lane_directions: Dict[str, str]

@app.get("/api/violations")
def api_get_violations(
    q: Optional[str] = Query(None, description="Search plates or vehicle type"),
    type: Optional[str] = Query(None, description="Filter by violation type"),
    status: Optional[str] = Query(None, description="Filter by status (pending, approved, rejected)"),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100)
):
    offset = (page - 1) * limit
    records, total = get_violations(search_query=q, violation_type=type, status=status, limit=limit, offset=offset)
    
    return {
        "data": records,
        "pagination": {
            "total_records": total,
            "page": page,
            "limit": limit,
            "total_pages": (total + limit - 1) // limit
        }
    }

@app.put("/api/violations/{violation_id}/status")
def api_update_status(violation_id: int, payload: UpdateStatusRequest):
    if payload.status not in ["pending", "approved", "rejected"]:
        raise HTTPException(status_code=400, detail="Invalid status. Must be pending, approved, or rejected.")
        
    update_violation_status(violation_id, payload.status)
    return {"status": "success", "message": f"Violation {violation_id} updated to {payload.status}."}

@app.get("/api/analytics")
def api_get_analytics():
    stats = get_analytics()
    return stats

@app.get("/api/settings")
def api_get_settings(camera: str = Query("cam_01")):
    return get_settings(camera)

@app.post("/api/settings")
def api_save_settings(payload: SettingsRequest, camera: str = Query("cam_01")):
    update_setting(camera, payload.dict())
    return {"status": "success", "message": f"Settings for {camera} updated successfully."}

@app.post("/api/process")
async def api_process_image(
    file: UploadFile = File(...),
    camera: str = Query("cam_01"),
    low_light: bool = Query(False),
    sharpen: bool = Query(False),
    shadow: bool = Query(False),
    dehaze: bool = Query(False)
):
    # Save uploaded file
    file_ext = os.path.splitext(file.filename)[1]
    temp_filename = f"upload_{os.urandom(4).hex()}{file_ext}"
    temp_filepath = os.path.join(UPLOAD_DIR, temp_filename)
    
    try:
        with open(temp_filepath, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # Get active settings from database
        settings = get_settings(camera)
        # Add custom pre-processing filters selected from query params
        settings["filters"] = {
            "low_light": low_light,
            "sharpen": sharpen,
            "shadow": shadow,
            "dehaze": dehaze
        }
        
        # Run CV analysis
        results = cv_engine.process_image(temp_filepath, settings)
        
        # Log all detected violations in the database
        rel_orig_path = f"/static/uploads/{temp_filename}"
        logged_violations = []
        
        for viol in results["violations"]:
            # Find matching vehicle category
            # Look for license plate text for this vehicle
            v_bbox = viol["target_bbox"]
            plate_text = "UNKNOWN"
            # Find if any plate matches coordinates of this vehicle
            for pl in results["plates"]:
                px, py, pw, ph = pl["bbox"]
                # Plate center inside vehicle bbox?
                if v_bbox[0] <= px <= v_bbox[0] + v_bbox[2] and v_bbox[1] <= py <= v_bbox[1] + v_bbox[3]:
                    plate_text = pl["text"]
                    break
                    
            # Set default vehicle class
            v_class = "motorcycle" if "Riding" in viol["type"] or "Helmet" in viol["type"] else "car"
            
            violation_id = add_violation(
                violation_type=viol["type"],
                vehicle_type=v_class,
                license_plate=plate_text,
                confidence=viol["confidence"],
                image_path=rel_orig_path,
                annotated_image_path=results["annotated_image_url"]
            )
            
            logged_violations.append({
                "id": violation_id,
                "type": viol["type"],
                "vehicle": v_class,
                "plate": plate_text,
                "confidence": viol["confidence"]
            })
            
        return {
            "status": "success",
            "file": rel_orig_path,
            "annotated_file": results["annotated_image_url"],
            "detections_count": len(results["detections"]),
            "violations_detected": logged_violations,
            "license_plates": [p["text"] for p in results["plates"]]
        }
        
    except Exception as e:
        # Cleanup temp file on error
        if os.path.exists(temp_filepath):
            os.remove(temp_filepath)
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")

@app.get("/api/evaluation")
def api_get_evaluation(samples: int = Query(30, ge=1, le=100)):
    if not evaluator:
        raise HTTPException(status_code=500, detail="Evaluator not initialized.")
    metrics = evaluator.run_evaluation(max_samples=samples)
    return metrics

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app:app", host="127.0.0.1", port=8000, reload=True)
