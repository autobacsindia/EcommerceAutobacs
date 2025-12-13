@echo off
cd /d "c:\Main project\Autobacs\Back-end\server"
node sync-products-to-live-count-final.js --dry-run
pause