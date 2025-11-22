@echo off
echo Stopping MongoDB service...
net stop MongoDB

echo Creating temporary configuration without authentication...
echo # mongod.conf > temp-config.cfg
echo. >> temp-config.cfg
echo # for documentation of all options, see: >> temp-config.cfg
echo #   http://docs.mongodb.org/manual/reference/configuration-options/ >> temp-config.cfg
echo. >> temp-config.cfg
echo # Where and how to store data. >> temp-config.cfg
echo storage: >> temp-config.cfg
echo   dbPath: C:\Program Files\MongoDB\Server\8.2\data >> temp-config.cfg
echo. >> temp-config.cfg
echo # where to write logging data. >> temp-config.cfg
echo systemLog: >> temp-config.cfg
echo   destination: file >> temp-config.cfg
echo   logAppend: true >> temp-config.cfg
echo   path: C:\Program Files\MongoDB\Server\8.2\log\mongod.log >> temp-config.cfg
echo. >> temp-config.cfg
echo # network interfaces >> temp-config.cfg
echo net: >> temp-config.cfg
echo   port: 27017 >> temp-config.cfg
echo   bindIp: 127.0.0.1 >> temp-config.cfg
echo. >> temp-config.cfg
echo # Security settings (authentication disabled) >> temp-config.cfg
echo #security: >> temp-config.cfg
echo #  authorization: enabled >> temp-config.cfg
echo. >> temp-config.cfg
echo #processManagement: >> temp-config.cfg
echo. >> temp-config.cfg
echo #operationProfiling: >> temp-config.cfg
echo. >> temp-config.cfg
echo #replication: >> temp-config.cfg
echo. >> temp-config.cfg
echo #sharding: >> temp-config.cfg
echo. >> temp-config.cfg
echo ## Enterprise-Only Options: >> temp-config.cfg
echo. >> temp-config.cfg
echo #auditLog: >> temp-config.cfg

echo Replacing MongoDB configuration file...
copy /Y temp-config.cfg "C:\Program Files\MongoDB\Server\8.2\bin\mongod.cfg"

echo Starting MongoDB service...
net start MongoDB

echo Cleaning up temporary files...
del temp-config.cfg

echo.
echo Next steps:
echo 1. Run: node init-mongodb-user.js
echo 2. Run: enable-mongodb-auth.bat