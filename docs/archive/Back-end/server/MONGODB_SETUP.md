# MongoDB Setup Instructions

## Current Status
MongoDB 8.2 is installed but experiencing issues when authentication is enabled:
- MongoDB crashes with unhandled exception (0xC000001D) when authorization is enabled
- This is a known issue with MongoDB 8.2 on some Windows systems

## Temporary Solution
MongoDB is currently configured to run without authentication for development purposes.

### Configuration Files
1. **mongod-local.cfg** - MongoDB configuration file (authentication disabled)
2. **.env** - Environment variables with MongoDB connection string (no auth)

### Scripts
1. **start-mongodb-final.ps1** - PowerShell script to start MongoDB without authentication
2. **test-mongodb-connection.js** - Script to test MongoDB connection

## How to Start MongoDB (Without Authentication)
```powershell
# Run the PowerShell script to start MongoDB
powershell -ExecutionPolicy Bypass -File "C:\Main project\Autobacs\Back-end\server\start-mongodb-final.ps1"
```

## How to Test Connection
```bash
# Test the MongoDB connection
node test-mongodb-connection.js
```

## Future Steps to Enable Authentication
1. **Option 1: Downgrade MongoDB**
   - Uninstall MongoDB 8.2
   - Install MongoDB 6.0 Community Edition which is more stable on Windows
   - Enable authentication as normal

2. **Option 2: Use Docker**
   - Install Docker Desktop for Windows
   - Run MongoDB in a container with authentication enabled
   ```bash
   docker run --name mongodb -p 27017:27017 -e MONGO_INITDB_ROOT_USERNAME=Autobacs_info_db -e MONGO_INITDB_ROOT_PASSWORD=Info@autobacs -d mongo:6.0
   ```

3. **Option 3: Fix MongoDB 8.2 Issue**
   - Check Windows system requirements for MongoDB 8.2
   - Update Windows to the latest version
   - Check for any conflicting software
   - Try running MongoDB as administrator

## User Credentials
The MongoDB user has already been created with the following credentials:
- Username: `Autobacs_info_db`
- Password: `Info@autobacs`
- Database: `autobacs`
- Roles:
  - `readWrite` on `autobacs` database
  - `dbAdmin` on `autobacs` database
  - `userAdminAnyDatabase` on `admin` database
  - `readWriteAnyDatabase` on `admin` database

## Environment Variables
The .env file is configured with:
```env
MONGO_URI=mongodb://localhost:27017/autobacs
```

To enable authentication later, change it to:
```env
MONGO_URI=mongodb://Autobacs_info_db:Info%40autobacs@localhost:27017/autobacs
```

And enable authorization in mongod-local.cfg:
```yaml
security:
  authorization: enabled
```