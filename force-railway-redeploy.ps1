# Railway Force Redeployment Script
# This script helps force Railway to rebuild with latest code

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Railway Force Redeployment Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Railway CLI is installed
Write-Host "Checking for Railway CLI..." -ForegroundColor Yellow
$railwayInstalled = Get-Command railway -ErrorAction SilentlyContinue

if (-not $railwayInstalled) {
    Write-Host "Railway CLI not found. Installing..." -ForegroundColor Yellow
    npm install -g @railway/cli
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to install Railway CLI. Please install manually:" -ForegroundColor Red
        Write-Host "  npm install -g @railway/cli" -ForegroundColor Yellow
        exit 1
    }
}

Write-Host "Railway CLI is available." -ForegroundColor Green
Write-Host ""

# Prompt for action
Write-Host "Choose an option:" -ForegroundColor Cyan
Write-Host "1. View deployment status (requires login)" -ForegroundColor White
Write-Host "2. Trigger redeployment (requires login)" -ForegroundColor White
Write-Host "3. Just show me manual steps" -ForegroundColor White
Write-Host ""

$choice = Read-Host "Enter your choice (1-3)"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "Opening Railway login..." -ForegroundColor Yellow
        railway login
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Logged in successfully!" -ForegroundColor Green
            Write-Host ""
            Write-Host "Checking deployment status..." -ForegroundColor Yellow
            railway status
        }
    }
    "2" {
        Write-Host ""
        Write-Host "Opening Railway login..." -ForegroundColor Yellow
        railway login
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Logged in successfully!" -ForegroundColor Green
            Write-Host ""
            Write-Host "Triggering redeployment..." -ForegroundColor Yellow
            Write-Host "Note: This will deploy the latest code from GitHub main branch" -ForegroundColor Yellow
            Write-Host ""
            
            $confirm = Read-Host "Continue with deployment? (y/n)"
            if ($confirm -eq "y") {
                railway up --detach
                Write-Host ""
                Write-Host "Deployment triggered! Check Railway dashboard for progress." -ForegroundColor Green
                Write-Host "URL: https://railway.com/" -ForegroundColor Cyan
            }
        }
    }
    "3" {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "Manual Steps to Force Railway Redeployment" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "STEP 1: Clear Build Cache" -ForegroundColor Yellow
        Write-Host "  1. Go to https://railway.com/" -ForegroundColor White
        Write-Host "  2. Select your EcommerceAutobacs project" -ForegroundColor White
        Write-Host "  3. Click on Frontend service" -ForegroundColor White
        Write-Host "  4. Go to Settings tab" -ForegroundColor White
        Write-Host "  5. Scroll to Build section" -ForegroundColor White
        Write-Host "  6. Click 'Clear build cache'" -ForegroundColor White
        Write-Host ""
        Write-Host "STEP 2: Redeploy" -ForegroundColor Yellow
        Write-Host "  7. Go to Deployments tab" -ForegroundColor White
        Write-Host "  8. Click 'Redeploy' on latest deployment" -ForegroundColor White
        Write-Host "  9. OR click 'Deploy' > 'Deploy from GitHub repo'" -ForegroundColor White
        Write-Host ""
        Write-Host "STEP 3: Repeat for Backend (if needed)" -ForegroundColor Yellow
        Write-Host "  10. Select Backend service" -ForegroundColor White
        Write-Host "  11. Repeat steps 4-9" -ForegroundColor White
        Write-Host ""
        Write-Host "STEP 4: Verify Deployment" -ForegroundColor Yellow
        Write-Host "  12. Visit your production URL" -ForegroundColor White
        Write-Host "  13. Check vehicle selector appears in header" -ForegroundColor White
        Write-Host "  14. Verify categories are updated" -ForegroundColor White
        Write-Host ""
        Write-Host "TIP: Check build logs to ensure fresh build (not cached)" -ForegroundColor Cyan
        Write-Host ""
    }
    default {
        Write-Host "Invalid choice. Exiting." -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Latest Commit Information" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
git log -1 --format="Commit: %H%nDate: %ci%nMessage: %s"
Write-Host ""
Write-Host "Files changed in last vehicle/categories update:" -ForegroundColor Yellow
git show 00a060b9 --name-only --format=""
Write-Host ""
Write-Host "Script completed!" -ForegroundColor Green
