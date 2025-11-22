@echo off
echo Starting MongoDB in background...
cd "C:\Program Files\MongoDB\Server\8.2\bin"
start /B mongod.exe --config "C:\Main project\Autobacs\Back-end\server\mongod-local.cfg"
echo MongoDB started in background.
timeout /t 5 /nobreak >nul