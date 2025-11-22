@echo off
echo Stopping MongoDB service...
net stop MongoDB
if %errorlevel% neq 0 (
    echo Failed to stop MongoDB service. Please run this script as Administrator.
    pause
    exit /b 1
)
echo MongoDB service stopped successfully.