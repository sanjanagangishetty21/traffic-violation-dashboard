import random
from datetime import datetime, timedelta
from backend.database import get_db_connection

def generate_mock_data():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check if table already has data
    cursor.execute("SELECT COUNT(*) FROM violations")
    count = cursor.fetchone()[0]
    
    if count > 0:
        print("[INFO] Database already populated with records.")
        conn.close()
        return
        
    print("[INFO] Pre-populating database with rich traffic violation logs for the last 7 days...")
    
    violation_types = [
        "Helmet Non-compliance",
        "Seatbelt Non-compliance",
        "Triple Riding",
        "Wrong-side Driving",
        "Red-light Violation",
        "Illegal Parking"
    ]
    
    vehicles = {
        "Helmet Non-compliance": ["motorcycle"],
        "Seatbelt Non-compliance": ["car", "truck", "bus"],
        "Triple Riding": ["motorcycle"],
        "Wrong-side Driving": ["car", "motorcycle", "truck"],
        "Red-light Violation": ["car", "motorcycle", "truck", "bus"],
        "Illegal Parking": ["car", "truck"]
    }
    
    plates_letters = ["DL", "MH", "KA", "HR", "UP", "TN", "AP", "GJ", "KL", "MH"]
    
    # Generate 180 records over the past 7 days
    now = datetime.now()
    records = []
    
    for _ in range(180):
        # Weighted random day in last 7 days
        days_ago = random.randint(0, 7)
        # Weighted hour (rush hours 8-10 AM and 5-7 PM have more violations)
        hour_roll = random.random()
        if hour_roll < 0.35: # Morning rush hour
            hour = random.randint(8, 10)
        elif hour_roll < 0.70: # Evening rush hour
            hour = random.randint(17, 19)
        else: # Other times
            hour = random.choice([0,1,2,3,4,5,6,7,11,12,13,14,15,16,20,21,22,23])
            
        minute = random.randint(0, 59)
        second = random.randint(0, 59)
        
        record_time = now - timedelta(days=days_ago)
        record_time = record_time.replace(hour=hour, minute=minute, second=second)
        
        vtype = random.choice(violation_types)
        v_class = random.choice(vehicles[vtype])
        
        # Plate number format: STATE-CODE-LETTER-NUMBER (e.g. DL 03 CA 4920)
        state = random.choice(plates_letters)
        num1 = random.randint(1, 99)
        letters = "".join(random.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ") for _ in range(2))
        num2 = random.randint(1000, 9999)
        plate = f"{state} {num1:02d} {letters} {num2}"
        
        confidence = round(random.uniform(0.72, 0.98), 2)
        
        # Status: 70% approved, 15% pending, 15% rejected
        status_roll = random.random()
        if status_roll < 0.70:
            status = "approved"
        elif status_roll < 0.85:
            status = "pending"
        else:
            status = "rejected"
            
        # Mock image urls
        img_id = random.randint(1, 10)
        image_path = f"/static/sample_traffic_{img_id}.jpg"
        annotated_image_path = f"/static/ann_sample_traffic_{img_id}.jpg"
        
        records.append((
            record_time.isoformat(),
            vtype,
            v_class,
            plate,
            confidence,
            image_path,
            annotated_image_path,
            status
        ))
        
    cursor.executemany("""
        INSERT INTO violations (timestamp, violation_type, vehicle_type, license_plate, confidence, image_path, annotated_image_path, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, records)
    
    conn.commit()
    conn.close()
    print(f"[INFO] Successfully inserted {len(records)} mock violation records.")

if __name__ == "__main__":
    generate_mock_data()
