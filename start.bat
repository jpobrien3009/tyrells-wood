@echo off
REM ============================================================
REM  Tyrrells Wood Golf - Local Launcher
REM  Starts a local web server and opens the app in your browser
REM ============================================================

setlocal

REM Move to the folder this batch file is sitting in
cd /d "%~dp0"

REM Confirm we're in the right place by checking the public folder exists
if not exist "public\index.html" (
    echo.
    echo ERROR: Cannot find public\index.html
    echo Make sure this batch file is in the tyrrells-wood-app folder
    echo (the one that contains the "public" folder^).
    echo.
    pause
    exit /b 1
)

REM Find Python (try "py" launcher first, then "python")
set PYTHON_CMD=
where py >nul 2>nul
if %errorlevel%==0 (
    set PYTHON_CMD=py
) else (
    where python >nul 2>nul
    if %errorlevel%==0 (
        set PYTHON_CMD=python
    )
)

if "%PYTHON_CMD%"=="" (
    echo.
    echo ERROR: Python is not installed or not on PATH.
    echo Install Python from https://www.python.org/downloads/
    echo or from the Microsoft Store ^(search "Python 3"^).
    echo.
    pause
    exit /b 1
)

REM Pick a port - 8000 by default, fall back to 8765 if it's busy
set PORT=8000
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul
if %errorlevel%==0 (
    set PORT=8765
    echo Port 8000 is in use, using port %PORT% instead.
)

echo.
echo ============================================================
echo   Tyrrells Wood Golf
echo ============================================================
echo.
echo   Starting server on http://localhost:%PORT%
echo   Opening browser in 2 seconds...
echo.
echo   To stop the server: close this window or press Ctrl+C
echo.
echo ============================================================
echo.

REM Open browser after a short delay so the server has time to start
start "" /min cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:%PORT%"

REM Run the server (this will block until Ctrl+C or window closes)
cd public
%PYTHON_CMD% -m http.server %PORT%

endlocal
