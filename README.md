# APIC-TV: Intelligent Traffic Violation Detection System

APIC-TV is a modern, web-based traffic enforcement dashboard powered by Computer Vision. The system processes video/image feeds to detect traffic violations in real-time, extracts license plates using Optical Character Recognition (OCR), and provides a comprehensive dashboard for station administrators to review citations and monitor intersection performance.

## 🚀 Features

* **Real-time Live Monitoring:** Upload intersection snapshots or run simulations to detect active vehicles, pedestrians, and license plates.
* **Intelligent Heuristics Detection:**
  * **Red-light Violation:** Tracks vehicles crossing stop-lines while the traffic light is Red.
  * **Helmet Non-compliance:** Identifies motorcycle riders operating vehicles without a helmet.
  * **Seatbelt Non-compliance:** Uses edge detection and Hough lines to flag front seat cabin occupants without seatbelts.
  * **Triple Riding:** Detects multiple riders overlapping on a single motorcycle.
  * **Wrong-side Driving & Illegal Parking:** Flagging vehicles based on direction rules and boundary zones.
* **Interactive Calibration Canvas:** Draw and calibrate Stop Lines and No Parking polygons directly on the stream settings panel.
* **Logs & Resolution Dashboard:** Full audit trail to filter, search, export citation logs (CSV), and approve or reject ticket issues.
* **Analytics Panel:** Interactive Chart.js reports showcasing violation categories, peak density hours, and vehicle classification trends.

---

## 🛠️ Tech Stack

* **Frontend:** Vanilla HTML5, CSS3 (Premium dark/light theme options), Javascript, Chart.js.
* **Backend:** FastAPI (Python), Uvicorn server, SQLite database.
* **Computer Vision Core:** OpenCV, YOLOv8 (`ultralytics`), EasyOCR.

---

## 💻 Local Quickstart

### Prerequisites
* Python 3.8 or higher.
* Node.js / NPM (optional, for custom static previewing).

### Run the App (Windows)
Double-click the **`run.bat`** script in the project root. This script will:
1. Verify Python is installed.
2. Automatically unzip dataset archives (if not already done).
3. Install required Python libraries (`pip install -r backend/requirements.txt`).
4. Start the FastAPI uvicorn server at `http://localhost:8000`.


## 🌐 Cloud Deployment Architecture

The application uses a **split deployment** model to optimize host performance and resource usage:

1. **Frontend (Vercel):**
   * Static assets (`frontend/` folder) are hosted on Vercel for high performance and global CDN delivery.
   * Configuration rewrites in `vercel.json` automatically proxy `/api` and `/static` assets to the hosted backend.
2. **Backend (Render / Railway / VPS):**
   * The FastAPI server is hosted on a platform supporting Docker / standard Python environments.
   * Integrates the large YOLO and EasyOCR models with persistent storage.
