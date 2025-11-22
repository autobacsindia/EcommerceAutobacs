@echo off
echo Stopping MongoDB service...
net stop MongoDB

echo Replacing MongoDB configuration file with authentication enabled...
copy /Y mongod-with-auth.cfg "C:\Program Files\MongoDB\Server\8.2\bin\mongod.cfg"

echo Starting MongoDB service...
net start MongoDB

echo.
echo Next steps:
echo 1. Run: npm run test-db