@echo off
REM Autobacs Windows Deployment Script
REM Usage: deploy-windows.bat

echo 🚀 Starting Autobacs Windows Deployment...
echo ==========================================

REM Configuration
set PROJECT_DIR=C:\inetpub\wwwroot\autobacs
set BACKEND_DIR=%PROJECT_DIR%\Autobacs\Back-end\server
set FRONTEND_DIR=%PROJECT_DIR%\Autobacs\Front-end\web
set DOMAIN=yourdomain.com

echo Configuration:
echo   Project Directory: %PROJECT_DIR%
echo   Backend Directory: %BACKEND_DIR%
echo   Frontend Directory: %FRONTEND_DIR%
echo.

REM Check if running as administrator
net session >nul 2>&1
if %errorLevel% == 0 (
    echo ✓ Running with administrator privileges
) else (
    echo ✗ This script requires administrator privileges
    echo Please run as administrator
    pause
    exit /b 1
)

REM Check Node.js installation
node --version >nul 2>&1
if %errorLevel% == 0 (
    echo ✓ Node.js found: 
    node --version
) else (
    echo ✗ Node.js not found
    echo Please install Node.js 18+ from https://nodejs.org/
    pause
    exit /b 1
)

REM Create project directory
if not exist "%PROJECT_DIR%" (
    echo Creating project directory...
    mkdir "%PROJECT_DIR%"
)

REM Navigate to project directory
cd /d "%PROJECT_DIR%"

REM Clone or update repository
if exist ".git" (
    echo Updating existing repository...
    git pull origin main
) else (
    echo Cloning repository...
    git clone <your-repo-url> .
)

REM Backend Setup
echo.
echo Setting up backend...
cd /d "%BACKEND_DIR%"

REM Install backend dependencies
echo Installing backend dependencies...
npm install --production

REM Check if production environment file exists
if not exist ".env.production" (
    echo Creating .env.production file...
    copy .env .env.production
    echo.
    echo ⚠ Please update .env.production with your production values!
    echo Key values to update:
    echo   - MONGO_URI (MongoDB connection string)
    echo   - JWT_SECRET (change this!)
    echo   - RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET
    echo   - Google Maps API keys
    echo   - SendGrid API key
    echo.
    pause
)

REM Frontend Setup
echo.
echo Setting up frontend...
cd /d "%FRONTEND_DIR%"

REM Install frontend dependencies
echo Installing frontend dependencies...
npm install --production

REM Check if production environment file exists
if not exist ".env.production.local" (
    echo Creating .env.production.local file...
    copy .env.local .env.production.local
    echo.
    echo ⚠ Please update .env.production.local with production API URL!
    echo.
    pause
)

REM Build frontend
echo Building frontend...
npm run build

REM Install PM2 globally if not installed
npm list -g pm2 >nul 2>&1
if %errorLevel% neq 0 (
    echo Installing PM2...
    npm install -g pm2
)

REM Start applications with PM2
echo Starting applications with PM2...

REM Start backend
cd /d "%BACKEND_DIR%"
pm2 start server.js --name "autobacs-backend" --env production

REM Start frontend
cd /d "%FRONTEND_DIR%"
pm2 start npm --name "autobacs-frontend" -- start

REM Save PM2 configuration
pm2 startup
pm2 save

echo.
echo ✓ Applications started successfully!

echo.
echo Deployment Status:
echo ==================
pm2 list

echo.
echo Next Steps:
echo ===========
echo 1. Configure IIS as reverse proxy
echo 2. Set up SSL certificate with IIS
echo 3. Update domain in environment files
echo 4. Test all functionality
echo 5. Set up monitoring and backups

echo.
echo Useful PM2 Commands:
echo   pm2 status          - View application status
echo   pm2 logs            - View application logs
echo   pm2 restart all     - Restart all applications
echo   pm2 stop all        - Stop all applications

echo.
echo ✓ Deployment completed successfully! 🎉
pause