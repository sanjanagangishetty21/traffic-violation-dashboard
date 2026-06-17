import cv2
import numpy as np

def apply_clahe(image):
    """
    Enhance image contrast using Contrast Limited Adaptive Histogram Equalization (CLAHE).
    Excellent for low-light conditions.
    """
    # Convert image to LAB color space
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    
    # Apply CLAHE to L-channel
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    cl = clahe.apply(l)
    
    # Merge channels and convert back to BGR
    limg = cv2.merge((cl, a, b))
    enhanced = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)
    return enhanced

def reduce_motion_blur(image):
    """
    Sharpen the image to reduce the effect of motion blur.
    Uses unsharp masking.
    """
    # Gaussian blur the image
    gaussian_3 = cv2.GaussianBlur(image, (9, 9), 10.0)
    # Weighted sum: original * (1 + alpha) + blurred * (-alpha)
    sharpened = cv2.addWeighted(image, 1.8, gaussian_3, -0.8, 0)
    return sharpened

def suppress_shadows(image):
    """
    Suppress shadows using bilateral filtering to preserve edges while smoothing lighting variations,
    and adjust brightness in dark regions.
    """
    # Bilateral filter to smooth texture while preserving edges
    smoothed = cv2.bilateralFilter(image, 9, 75, 75)
    
    # Increase brightness in dark pixels slightly
    gray = cv2.cvtColor(smoothed, cv2.COLOR_BGR2GRAY)
    mask = cv2.threshold(gray, 50, 255, cv2.THRESH_BINARY_INV)[1]
    
    # Enhance shadow regions
    hsv = cv2.cvtColor(smoothed, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    
    # Add offset to V channel where mask is active
    v_new = np.where(mask == 255, np.minimum(v + 30, 255), v).astype(np.uint8)
    hsv_new = cv2.merge((h, s, v_new))
    
    return cv2.cvtColor(hsv_new, cv2.COLOR_HSV2BGR)

def dehaze_image(image):
    """
    Fast dehazing/defogging using a simplified Dark Channel Prior or local contrast stretch.
    """
    # Convert to float
    img_float = image.astype('float64') / 255.0
    
    # Get dark channel
    dark_channel = np.min(img_float, axis=2)
    kernel = cv2.getStructuringElement(cv2.ROUND_RECT, (15, 15))
    dark_channel = cv2.erode(dark_channel, kernel)
    
    # Estimate atmospheric light (top 0.1% brightest in dark channel)
    num_pixels = dark_channel.size
    num_search = max(int(num_pixels * 0.001), 1)
    indices = np.argpartition(dark_channel.ravel(), -num_search)[-num_search:]
    
    flat_img = img_float.reshape(-1, 3)
    atmospheric_light = np.max(flat_img[indices], axis=0)
    
    # Estimate transmission map
    omega = 0.95  # keeps a small amount of haze for depth perception
    transmission = 1.0 - omega * cv2.erode(np.min(img_float / atmospheric_light, axis=2), kernel)
    transmission = np.maximum(transmission, 0.1)  # restrict minimum transmission to avoid division by zero
    
    # Recover scene radiance
    dehazed = np.zeros_like(img_float)
    for i in range(3):
        dehazed[:, :, i] = (img_float[:, :, i] - atmospheric_light[i]) / transmission + atmospheric_light[i]
        
    dehazed = np.clip(dehazed * 255, 0, 255).astype('uint8')
    return dehazed

def preprocess_image(image, low_light=False, sharpen=False, shadow=False, dehaze=False):
    """
    Apply selected preprocessing pipeline.
    """
    processed = image.copy()
    if low_light:
        processed = apply_clahe(processed)
    if dehaze:
        processed = dehaze_image(processed)
    if shadow:
        processed = suppress_shadows(processed)
    if sharpen:
        processed = reduce_motion_blur(processed)
    return processed
