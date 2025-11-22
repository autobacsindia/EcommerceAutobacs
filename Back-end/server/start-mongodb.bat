@echo off
echo Starting MongoDB without authentication...
echo Killing any existing MongoDB processes...
taskkill /f /im mongod.exe >nul 2>&1
timeout /t 2 /nobreak >nul
echo Starting MongoDB...
start /b "C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe" --dbpath "C:\Main project\Autobacs\Back-end\server\mongodb-data" --port 27017
echo MongoDB started. Waiting for initialization...
timeout /t 5 /nobreak >nul
tasklist /fi "imagename eq mongod.exe" | findstr mongod >nul
if %errorlevel% == 0 (
    echo MongoDB is running
    echo You can now test the connection with: node test-mongodb-connection.js
) else (
    echo Failed to start MongoDB
)