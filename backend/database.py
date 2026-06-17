import sqlite3
import os
import json
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "traffic_system.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Violations table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS violations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            violation_type TEXT NOT NULL,
            vehicle_type TEXT NOT NULL,
            license_plate TEXT,
            confidence REAL,
            image_path TEXT,
            annotated_image_path TEXT,
            status TEXT DEFAULT 'pending' -- pending, approved, rejected
        )
    """)
    
    # System settings table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)
    
    # Insert default settings if they don't exist
    cursor.execute("SELECT COUNT(*) FROM settings")
    if cursor.fetchone()[0] == 0:
        default_settings = {
            "stop_line": {"start": [100, 350], "end": [700, 350]},
            "traffic_light_zone": {"x": 500, "y": 50, "width": 80, "height": 200},
            "no_parking_zone": [[100, 400], [400, 400], [350, 550], [50, 550]],
            "traffic_light_state": "Red",
            "lane_directions": {"lane1": "North", "lane2": "South"}
        }
        for key, value in default_settings.items():
            cursor.execute("INSERT INTO settings (key, value) VALUES (?, ?)", (key, json.dumps(value)))
            
    conn.commit()
    conn.close()

def add_violation(violation_type, vehicle_type, license_plate, confidence, image_path, annotated_image_path):
    conn = get_db_connection()
    cursor = conn.cursor()
    timestamp = datetime.now().isoformat()
    cursor.execute("""
        INSERT INTO violations (timestamp, violation_type, vehicle_type, license_plate, confidence, image_path, annotated_image_path)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (timestamp, violation_type, vehicle_type, license_plate, confidence, image_path, annotated_image_path))
    violation_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return violation_id

def get_violations(search_query=None, violation_type=None, status=None, limit=50, offset=0):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    query = "SELECT * FROM violations WHERE 1=1"
    params = []
    
    if search_query:
        query += " AND (license_plate LIKE ? OR vehicle_type LIKE ?)"
        params.append(f"%{search_query}%")
        params.append(f"%{search_query}%")
        
    if violation_type:
        query += " AND violation_type = ?"
        params.append(violation_type)
        
    if status:
        query += " AND status = ?"
        params.append(status)
        
    query += " ORDER BY id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    
    # Count total for pagination
    count_query = "SELECT COUNT(*) FROM violations WHERE 1=1"
    count_params = []
    if search_query:
        count_query += " AND (license_plate LIKE ? OR vehicle_type LIKE ?)"
        count_params.append(f"%{search_query}%")
        count_params.append(f"%{search_query}%")
    if violation_type:
        count_query += " AND violation_type = ?"
        count_params.append(violation_type)
    if status:
        count_query += " AND status = ?"
        count_params.append(status)
        
    cursor.execute(count_query, count_params)
    total_count = cursor.fetchone()[0]
    
    conn.close()
    
    return [dict(row) for row in rows], total_count

def update_violation_status(violation_id, status):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE violations SET status = ? WHERE id = ?", (status, violation_id))
    conn.commit()
    conn.close()

def get_settings():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM settings")
    rows = cursor.fetchall()
    conn.close()
    
    settings = {}
    for row in rows:
        settings[row['key']] = json.loads(row['value'])
    return settings

def update_setting(key, value):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, json.dumps(value)))
    conn.commit()
    conn.close()

def get_analytics():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Total violations count
    cursor.execute("SELECT COUNT(*) FROM violations")
    total_violations = cursor.fetchone()[0]
    
    # Violations by type
    cursor.execute("SELECT violation_type, COUNT(*) as count FROM violations GROUP BY violation_type")
    by_type = {row['violation_type']: row['count'] for row in cursor.fetchall()}
    
    # Violations by vehicle type
    cursor.execute("SELECT vehicle_type, COUNT(*) as count FROM violations GROUP BY vehicle_type")
    by_vehicle = {row['vehicle_type']: row['count'] for row in cursor.fetchall()}
    
    # Violations by status
    cursor.execute("SELECT status, COUNT(*) as count FROM violations GROUP BY status")
    by_status = {row['status']: row['count'] for row in cursor.fetchall()}
    
    # Hourly distribution of violations
    cursor.execute("SELECT strftime('%H', timestamp) as hour, COUNT(*) as count FROM violations GROUP BY hour")
    by_hour = {row['hour']: row['count'] for row in cursor.fetchall()}
    
    conn.close()
    
    return {
        "total_violations": total_violations,
        "by_type": by_type,
        "by_vehicle": by_vehicle,
        "by_status": by_status,
        "by_hour": by_hour
    }

# Initialize database on module import
init_db()
