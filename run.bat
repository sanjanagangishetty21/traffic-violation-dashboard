@echo off
echo ===================================================
echo   APIC-TV Traffic Violation Detection System
echo ===================================================
echo.

REM Verify Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in PATH. Please install Python 3.8+ and try again.
    pause
    exit /b 1
)

REM Extract zip file if not already done
if not exist "data\test\images" (
    echo [INFO] Extracting dataset zip archive. This may take a few seconds...
    python -c "import zipfile, os; os.makedirs('data', exist_ok=True); z = zipfile.ZipFile('archive (1).zip'); z.extractall('data')"
    echo [INFO] Dataset extracted successfully.
) else (
    echo [INFO] Dataset already extracted.
)

REM Install requirements
echo [INFO] Installing required Python dependencies...
python -m pip install -r backend\requirements.txt
if errorlevel 1 (
    echo [WARNING] Failed to install some dependencies. The server might still run if packages are already installed.
)

REM Start FastAPI Server
echo [INFO] Starting FastAPI server on http://localhost:8000
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload
pause
