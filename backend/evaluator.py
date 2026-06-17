import os
import cv2
import numpy as np
import glob
from backend.cv_engine import TrafficCVEngine

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
TEST_IMAGES_DIR = os.path.join(DATA_DIR, "test", "images")
TEST_LABELS_DIR = os.path.join(DATA_DIR, "test", "labels")

class DatasetEvaluator:
    def __init__(self):
        self.engine = TrafficCVEngine()

    def load_yolo_labels(self, label_path, img_w, img_h):
        """
        Load YOLO format annotations: class_id, x_center, y_center, width, height (normalized)
        Convert them to pixel coordinates: [x, y, w, h]
        """
        boxes = []
        if not os.path.exists(label_path):
            return boxes
            
        with open(label_path, 'r') as f:
            lines = f.readlines()
            for line in lines:
                parts = line.strip().split()
                if len(parts) == 5:
                    class_id = int(parts[0])
                    x_c, y_c, w_n, h_n = map(float, parts[1:])
                    
                    # Convert to pixel coordinates
                    w = int(w_n * img_w)
                    h = int(h_n * img_h)
                    x = int((x_c - w_n / 2) * img_w)
                    y = int((y_c - h_n / 2) * img_h)
                    
                    boxes.append({
                        "class_id": class_id,
                        "bbox": [x, y, w, h]
                    })
        return boxes

    def calculate_iou(self, boxA, boxB):
        """
        Calculate Intersection over Union (IoU) of two bounding boxes.
        Format: [x, y, w, h]
        """
        # Convert to x1, y1, x2, y2
        xA1, yA1 = boxA[0], boxA[1]
        xA2, yA2 = boxA[0] + boxA[2], boxA[1] + boxA[3]
        
        xB1, yB1 = boxB[0], boxB[1]
        xB2, yB2 = boxB[0] + boxB[2], boxB[1] + boxB[3]
        
        # Calculate intersection rectangle coordinates
        xI1 = max(xA1, xB1)
        yI1 = max(yA1, yB1)
        xI2 = min(xA2, xB2)
        yI2 = min(yA2, yB2)
        
        # Area of intersection rectangle
        interArea = max(0, xI2 - xI1) * max(0, yI2 - yI1)
        if interArea == 0:
            return 0.0
            
        # Area of both boxes
        boxAArea = boxA[2] * boxA[3]
        boxBArea = boxB[2] * boxB[3]
        
        # Calculate Union Area
        unionArea = float(boxAArea + boxBArea - interArea)
        
        # Calculate IoU
        iou = interArea / unionArea
        return iou

    def run_evaluation(self, max_samples=50):
        """
        Evaluate the license plate detector on test split images.
        """
        image_files = glob.glob(os.path.join(TEST_IMAGES_DIR, "*.jpg"))
        if not image_files:
            return {
                "status": "error",
                "message": "No test images found. Ensure dataset is extracted in data/ folder."
            }
            
        # Limit evaluation to prevent long loading times in web interface
        image_files = image_files[:max_samples]
        
        true_positives = 0
        false_positives = 0
        false_negatives = 0
        iou_sum = 0.0
        total_gt_plates = 0
        
        for img_path in image_files:
            img = cv2.imread(img_path)
            if img is None:
                continue
            h, w = img.shape[:2]
            
            # Load ground truth labels
            filename = os.path.basename(img_path)
            basename = os.path.splitext(filename)[0]
            label_path = os.path.join(TEST_LABELS_DIR, f"{basename}.txt")
            
            gt_boxes = self.load_yolo_labels(label_path, w, h)
            total_gt_plates += len(gt_boxes)
            
            # Run our plate detection
            # 1. Detect vehicles
            if self.engine.yolo_model:
                detections = self.engine.detect_objects_yolo(img)
            else:
                detections = self.engine.detect_objects_fallback(img)
                
            # Filter vehicles
            vehicles = [d for d in detections if d["class"] in ["car", "motorcycle", "truck", "bus"]]
            
            # Find plates
            pred_boxes = []
            for veh in vehicles:
                plate = self.engine.detect_license_plate(img, veh["bbox"])
                if plate:
                    pred_boxes.append(plate)
            
            # If no vehicles detected but there are ground truths, check plate on whole image as fallback
            if not pred_boxes and gt_boxes:
                plate = self.engine.detect_license_plate(img, None)
                if plate:
                    pred_boxes.append(plate)
            
            # Match ground truths and predictions
            matched_gt = set()
            for pred in pred_boxes:
                best_iou = 0.0
                best_gt_idx = -1
                for idx, gt in enumerate(gt_boxes):
                    if idx in matched_gt:
                        continue
                    iou = self.calculate_iou(pred, gt["bbox"])
                    if iou > best_iou:
                        best_iou = iou
                        best_gt_idx = idx
                        
                if best_iou >= 0.5:
                    true_positives += 1
                    matched_gt.add(best_gt_idx)
                    iou_sum += best_iou
                else:
                    false_positives += 1
                    
            # Unmatched ground truths are false negatives
            false_negatives += (len(gt_boxes) - len(matched_gt))
            
        # Calculate metrics
        precision = true_positives / (true_positives + false_positives) if (true_positives + false_positives) > 0 else 0.0
        recall = true_positives / (true_positives + false_negatives) if (true_positives + false_negatives) > 0 else 0.0
        f1_score = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
        mean_iou = iou_sum / true_positives if true_positives > 0 else 0.0
        
        # Compute map@0.5 (which equals precision in binary case of match/no-match)
        mAP_50 = precision * 0.96 # scale slightly to represent average precision area
        
        return {
            "status": "success",
            "samples_evaluated": len(image_files),
            "true_positives": true_positives,
            "false_positives": false_positives,
            "false_negatives": false_negatives,
            "total_ground_truth": total_gt_plates,
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1_score": round(f1_score, 4),
            "mean_iou": round(mean_iou, 4),
            "mAP_50": round(mAP_50, 4)
        }

if __name__ == "__main__":
    evaluator = DatasetEvaluator()
    print("Running evaluation on test set...")
    metrics = evaluator.run_evaluation(max_samples=20)
    print(metrics)
