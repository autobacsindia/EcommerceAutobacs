@echo off
echo ================================
echo COMPLETE FRONTEND RESTART SCRIPT
echo ================================
echo.

echo Step 1: Killing any running Next.js processes...
taskkill /F /IM node.exe /FI "WINDOWTITLE eq npm*" 2>nul
timeout /t 2 /nobreak >nul

echo Step 2: Navigating to frontend directory...
cd /d "c:\Main project\Autobacs\Front-end\web"

echo Step 3: Removing .next cache...
if exist .next (
    rmdir /s /q .next
    echo .next directory removed
) else (
    echo .next directory not found
)

echo Step 4: Clearing npm cache...
npm cache clean --force

echo Step 5: Starting fresh development server...
echo.
echo ================================
echo Server starting...
echo ================================
echo.

npm run dev
