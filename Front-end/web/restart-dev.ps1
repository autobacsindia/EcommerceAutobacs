# Script to properly restart Next.js dev server with cache clearing

Write-Host "=== Restarting Next.js Development Server ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Stop all node processes running on port 3000
Write-Host "Step 1: Stopping existing dev servers..." -ForegroundColor Yellow
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowTitle -like "*3000*" -or $_.CommandLine -like "*next dev*"
} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Step 2: Clear Next.js cache
Write-Host "Step 2: Clearing Next.js cache..." -ForegroundColor Yellow
if (Test-Path ".next") {
    Remove-Item -Recurse -Force ".next" -ErrorAction SilentlyContinue
    Write-Host "  ✓ .next folder deleted" -ForegroundColor Green
} else {
    Write-Host "  ✓ No .next folder found" -ForegroundColor Green
}

# Step 3: Clear Node modules cache (optional, uncomment if needed)
# Write-Host "Step 3: Clearing node_modules/.cache..." -ForegroundColor Yellow
# if (Test-Path "node_modules/.cache") {
#     Remove-Item -Recurse -Force "node_modules/.cache" -ErrorAction SilentlyContinue
#     Write-Host "  ✓ node_modules/.cache deleted" -ForegroundColor Green
# }

Write-Host ""
Write-Host "Step 3: Starting development server..." -ForegroundColor Yellow
Write-Host ""
Write-Host "Running: npm run dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "After the server starts, test:" -ForegroundColor White
Write-Host "  • http://localhost:3000/model/toyota-hilux" -ForegroundColor White
Write-Host "  • http://localhost:3000/model/toyota-hilux/page/2" -ForegroundColor White
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Step 4: Start dev server
npm run dev
