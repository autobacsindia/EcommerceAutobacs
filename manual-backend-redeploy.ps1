# Manual Railway Backend Redeploy Script
# Run this if automatic deployment isn't working

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Manual Railway Backend Redeploy" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Railway CLI is installed
$railwayInstalled = Get-Command railway -ErrorAction SilentlyContinue

if (-not $railwayInstalled) {
    Write-Host "Railway CLI not found. Installing..." -ForegroundColor Yellow
    npm install -g @railway/cli
    Write-Host ""
}

Write-Host "Step 1: Login to Railway" -ForegroundColor Green
Write-Host "Opening browser for authentication..." -ForegroundColor Yellow
railway login

if ($LASTEXITCODE -ne 0) {
    Write-Host "Login failed. Please try again." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 2: Link to your project" -ForegroundColor Green
Write-Host "Select your backend service when prompted" -ForegroundColor Yellow
railway link

if ($LASTEXITCODE -ne 0) {
    Write-Host "Link failed. Please select your project." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 3: Check current deployment status" -ForegroundColor Green
railway status

Write-Host ""
Write-Host "Step 4: Force redeploy" -ForegroundColor Green
Write-Host "This will trigger a fresh Docker build..." -ForegroundColor Yellow

$confirm = Read-Host "Continue with redeploy? (y/n)"
if ($confirm -eq 'y' -or $confirm -eq 'Y') {
    railway up --detach
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✅ Redeploy triggered successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Monitoring deployment..." -ForegroundColor Yellow
        Write-Host "Check logs with: railway logs" -ForegroundColor Yellow
        Write-Host "Check status with: railway status" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Expected build time: 3-5 minutes" -ForegroundColor Cyan
    } else {
        Write-Host ""
        Write-Host "❌ Redeploy failed. Check error messages above." -ForegroundColor Red
    }
} else {
    Write-Host "Redeploy cancelled." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Alternative: Manual Steps in Railway Dashboard" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Go to: https://railway.app"
Write-Host "2. Click on your project"
Write-Host "3. Find the BACKEND service (not frontend)"
Write-Host "4. Click 'Deployments' tab"
Write-Host "5. Find the latest deployment"
Write-Host "6. Click the ⋮ (three dots) menu"
Write-Host "7. Click 'Redeploy'"
Write-Host ""
Write-Host "OR"
Write-Host ""
Write-Host "1. Go to Settings (gear icon)"
Write-Host "2. Scroll to 'Build' section"
Write-Host "3. Click 'Clear Build Cache'"
Write-Host "4. Then trigger redeploy"
Write-Host ""
