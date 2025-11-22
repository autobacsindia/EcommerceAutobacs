@echo off
echo Starting MongoDB in a simple way...
echo Make sure no other MongoDB instances are running
taskkill /f /im mongod.exe >nul 2>&1
timeout /t 2 /nobreak >nul
cd "C:\Program Files\MongoDB\Server\8.2\bin"
start "MongoDB" /D "C:\Program Files\MongoDB\Server\8.2\bin" mongod.exe --dbpath "C:\Main project\Autobacs\Back-end\server\mongodb-data" --port 27017
echo.
echo If MongoDB started successfully, you should see a new window.
echo To test the connection, run: node test-mongodb-connection.js
pause