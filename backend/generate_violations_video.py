import cv2
import numpy as np
import os

def generate_video():
    # Setup directories
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    STATIC_DIR = os.path.join(BASE_DIR, "..", "static")
    os.makedirs(STATIC_DIR, exist_ok=True)
    video_path = os.path.join(STATIC_DIR, "sample_violations.mp4")
    
    # Video properties
    fps = 10
    width, height = 800, 600
    duration_sec = 15
    total_frames = fps * duration_sec
    
    # Initialize VideoWriter
    # Use MP4V codec which is widely supported in Windows python OpenCV environments
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(video_path, fourcc, fps, (width, height))
    
    print(f"[INFO] Writing video to {video_path}...")
    
    for f in range(total_frames):
        t = f / float(fps)
        
        # Create Frame
        # Grass background
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        frame[:] = (34, 139, 34) # Forest Green
        
        # Road asphalt (x=100 to x=700)
        cv2.rectangle(frame, (100, 0), (700, 600), (80, 80, 80), -1)
        
        # Lane divider lanes (white dashed line)
        cv2.line(frame, (400, 0), (400, 600), (255, 255, 255), 5)
        
        # Lane bounds
        cv2.line(frame, (250, 0), (250, 600), (200, 200, 200), 2)
        cv2.line(frame, (550, 0), (550, 600), (200, 200, 200), 2)
        
        # Stop line (y=420 to y=435) on the right lane (x=400 to x=700)
        cv2.rectangle(frame, (400, 420), (700, 435), (240, 240, 240), -1)
        
        # Zebra crossing (y=450 to y=500)
        for z in range(410, 690, 40):
            cv2.rectangle(frame, (z, 450), (z + 25, 490), (255, 255, 255), -1)
            
        # Traffic light pole
        cv2.rectangle(frame, (720, 100), (730, 350), (50, 50, 50), -1)
        cv2.rectangle(frame, (705, 100), (745, 220), (10, 10, 10), -1)
        # Red light ON, others OFF
        cv2.circle(frame, (725, 125), 15, (0, 0, 255), -1)   # Red (ON)
        cv2.circle(frame, (725, 160), 15, (20, 50, 20), -1)  # Yellow
        cv2.circle(frame, (725, 195), 15, (20, 20, 50), -1)  # Green
        
        # --- DRAW VEHICLES ---
        
        # 1. Illegal Parking Car (Stationary inside No Parking zone on bottom left)
        # Bounding box center inside configured parking zone
        ip_y = 480
        cv2.rectangle(frame, (120, ip_y), (220, ip_y + 80), (0, 165, 255), -1) # Orange Car
        # License plate UP 16 IP 9982
        cv2.rectangle(frame, (145, ip_y + 70), (195, ip_y + 78), (255, 255, 255), -1)
        cv2.putText(frame, "UP16IP9982", (147, ip_y + 77), cv2.FONT_HERSHEY_SIMPLEX, 0.2, (0, 0, 0), 1)
        
        # 2. Red-light Violation Car (Moving down right lane, crossing stop line)
        # Start at y=100, moves down past stop line (y=420)
        rl_y = int(120 + t * 25)
        if rl_y < 520:
            cv2.rectangle(frame, (450, rl_y), (550, rl_y + 80), (30, 30, 180), -1) # Red Car
            # License plate DL 03 RL 4421
            cv2.rectangle(frame, (475, rl_y + 70), (525, rl_y + 78), (255, 255, 255), -1)
            cv2.putText(frame, "DL03RL4421", (477, rl_y + 77), cv2.FONT_HERSHEY_SIMPLEX, 0.2, (0, 0, 0), 1)
            
        # 3. Wrong-side Driving Car (Moving down left lane - oncoming traffic direction)
        ws_y = int(80 + t * 22)
        if ws_y < 520:
            cv2.rectangle(frame, (150, ws_y), (240, ws_y + 75), (180, 50, 50), -1) # Blue Car
            # License plate MH 12 WS 1192
            cv2.rectangle(frame, (170, ws_y + 65), (220, ws_y + 73), (255, 255, 255), -1)
            cv2.putText(frame, "MH12WS1192", (172, ws_y + 72), cv2.FONT_HERSHEY_SIMPLEX, 0.2, (0, 0, 0), 1)
            
        # 4. Triple Riding & Helmet motorcycle (Moving down middle-right lane)
        mc_y = int(100 + t * 28)
        if mc_y < 520:
            cv2.rectangle(frame, (310, mc_y), (350, mc_y + 70), (20, 20, 20), -1) # Black Bike
            # Three riders heads (Helmet non-compliance & Triple riding)
            cv2.circle(frame, (330, mc_y + 5), 8, (180, 220, 240), -1)  # Rider 1
            cv2.circle(frame, (330, mc_y + 20), 8, (180, 220, 240), -1) # Rider 2
            cv2.circle(frame, (330, mc_y + 35), 8, (180, 220, 240), -1) # Rider 3
            # License plate KA 03 TR 7721
            cv2.rectangle(frame, (315, mc_y + 60), (345, mc_y + 68), (255, 255, 255), -1)
            cv2.putText(frame, "KA03TR7721", (316, mc_y + 67), cv2.FONT_HERSHEY_SIMPLEX, 0.18, (0, 0, 0), 1)
            
        # 5. Seatbelt Violation Car (Stopped before the stop line)
        sb_y = 300
        cv2.rectangle(frame, (580, sb_y), (680, sb_y + 80), (220, 220, 220), -1) # White Car
        # Draw Windshield area (with NO seatbelt diagonal line)
        cv2.rectangle(frame, (595, sb_y + 10), (665, sb_y + 40), (120, 120, 120), -1)
        # License plate TN 07 SB 4839
        cv2.rectangle(frame, (605, sb_y + 70), (655, sb_y + 78), (255, 255, 255), -1)
        cv2.putText(frame, "TN07SB4839", (607, sb_y + 77), cv2.FONT_HERSHEY_SIMPLEX, 0.2, (0, 0, 0), 1)
        
        # Write Frame
        out.write(frame)
        
    out.release()
    print(f"[SUCCESS] Generated video at {video_path}!")

if __name__ == "__main__":
    generate_video()
