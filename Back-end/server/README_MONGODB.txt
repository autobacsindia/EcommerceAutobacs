MONGODB SETUP INSTRUCTIONS
==========================

PROBLEM:
--------
MongoDB 8.2 is crashing with an unhandled exception (0xC000001D) on your Windows system.
This is a known issue with MongoDB 8.2 on certain Windows configurations.

CURRENT STATUS:
---------------
- MongoDB is installed but not running properly with authentication enabled
- The application is configured to connect without authentication for development
- User credentials have been created successfully

SOLUTIONS:
----------

1. TEMPORARY WORKAROUND (What we've set up):
   - MongoDB runs without authentication
   - Application connects to MongoDB without credentials
   - This allows development to continue

2. PERMANENT SOLUTIONS:

   Option A: Downgrade to MongoDB 6.0
   - Uninstall MongoDB 8.2
   - Download and install MongoDB 6.0 Community Edition
   - Enable authentication as normal

   Option B: Use Docker
   - Install Docker Desktop for Windows
   - Run MongoDB in a container:
     docker run --name mongodb -p 27017:27017 -d mongo:6.0

   Option C: Try to fix MongoDB 8.2
   - Run MongoDB as Administrator
   - Check Windows system requirements
   - Update Windows to latest version

FILES CONFIGURED:
-----------------
1. .env - MongoDB connection string without authentication
2. mongod-local.cfg - MongoDB config with authentication disabled
3. start-mongodb-final.ps1 - PowerShell script to start MongoDB
4. MONGODB_SETUP.md - Detailed setup instructions

TO TEST CURRENT SETUP:
----------------------
1. Run the PowerShell script:
   powershell -ExecutionPolicy Bypass -File "C:\Main project\Autobacs\Back-end\server\start-mongodb-final.ps1"

2. In a new terminal, test the connection:
   node test-mongodb-connection.js

USER CREDENTIALS:
-----------------
Username: Autobacs_info_db
Password: Info@autobacs
Database: autobacs

TO ENABLE AUTHENTICATION LATER:
-------------------------------
1. Change .env file:
   MONGO_URI=mongodb://Autobacs_info_db:Info%40autobacs@localhost:27017/autobacs

2. Enable authorization in mongod-local.cfg:
   security:
     authorization: enabled