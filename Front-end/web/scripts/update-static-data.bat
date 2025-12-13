@echo off
TITLE Update Static Product Data
echo =====================================================
echo    Autobacs Frontend - Static Product Data Update
echo =====================================================

echo.
echo Updating static product data...
echo.

node "%~dp0updateStaticProductData.js"

echo.
echo Press any key to exit...
pause >nul