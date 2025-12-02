@echo off
echo ======================================
echo   Restarting Backend with Debug Logs
echo ======================================
echo.

echo Step 1: Finding and stopping existing backend process...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5000 ^| findstr LISTENING') do (
    echo Found process %%a on port 5000, killing...
    taskkill /F /PID %%a
)

timeout /t 2 /nobreak >nul

echo.
echo Step 2: Starting backend server...
echo Debug logs will show location data flow
echo.
start cmd /k "npm start"

echo.
echo ======================================
echo Backend restarting with debug enabled
echo Watch the new terminal for debug logs
echo ======================================
echo.
pause
