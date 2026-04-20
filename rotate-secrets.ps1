# Secret Rotation Quick-Start Script
# This script helps you rotate exposed secrets

Write-Host "========================================" -ForegroundColor Red
Write-Host "  CRITICAL SECURITY ALERT" -ForegroundColor Red
Write-Host "========================================" -ForegroundColor Red
Write-Host ""
Write-Host "Exposed secrets found in git history:" -ForegroundColor Yellow
Write-Host "  - MongoDB connection string" -ForegroundColor Yellow
Write-Host "  - Google Maps API keys" -ForegroundColor Yellow
Write-Host "  - SendGrid API key" -ForegroundColor Yellow
Write-Host ""

$continue = Read-Host "Do you want to start rotating secrets? (y/n)"

if ($continue -ne "y") {
    Write-Host "Please rotate secrets ASAP! See CRITICAL_SECURITY_ACTION_REQUIRED.md" -ForegroundColor Red
    exit
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  STEP 1: Rotate Secrets" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# MongoDB
Write-Host "1. MongoDB Atlas Password Rotation" -ForegroundColor Green
Write-Host "   URL: https://cloud.mongodb.com/" -ForegroundColor White
Write-Host "   Path: Database Access → Autobacs_info_db → Edit Password" -ForegroundColor White
Write-Host ""
$mongoDone = Read-Host "MongoDB password rotated? (y/n)"

if ($mongoDone -eq "y") {
    $newMongoPassword = Read-Host "Enter NEW MongoDB password (will not be stored)"
    Write-Host "   ✓ Remember to update Railway backend MONGO_URI variable" -ForegroundColor Green
}

Write-Host ""

# Google Maps
Write-Host "2. Google Maps API Keys Rotation" -ForegroundColor Green
Write-Host "   URL: https://console.cloud.google.com/apis/credentials" -ForegroundColor White
Write-Host "   Action: Delete old keys, create new ones with restrictions" -ForegroundColor White
Write-Host "   Exposed keys:" -ForegroundColor Yellow
Write-Host "     - AIzaSyCqmI-sLBZG726AoLN1x0SpBsdMtvJf7Hg (Client)" -ForegroundColor Red
Write-Host "     - AIzaSyBDvVjZvbKADJRp3VBa-FjtrmndNP0FG24 (Server)" -ForegroundColor Red
Write-Host ""
$googleDone = Read-Host "Google Maps keys rotated? (y/n)"

Write-Host ""

# SendGrid
Write-Host "3. SendGrid API Key Rotation" -ForegroundColor Green
Write-Host "   URL: https://app.sendgrid.com/settings/api_keys" -ForegroundColor White
Write-Host "   Action: Delete old key, create new one" -ForegroundColor White
Write-Host "   Exposed key: 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" -ForegroundColor Red
Write-Host ""
$sendgridDone = Read-Host "SendGrid key rotated? (y/n)"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  STEP 2: Update Railway Variables" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Update these Railway environment variables:" -ForegroundColor Yellow
Write-Host ""
Write-Host "Backend Service:" -ForegroundColor Green
Write-Host "  - MONGO_URI (with new password)" -ForegroundColor White
Write-Host "  - SENDGRID_API_KEY (new key)" -ForegroundColor White
Write-Host "  - GOOGLE_MAPS_SERVER_KEY (new key)" -ForegroundColor White
Write-Host ""
Write-Host "Frontend Service:" -ForegroundColor Green
Write-Host "  - GOOGLE_MAPS_CLIENT_KEY (new key, if applicable)" -ForegroundColor White
Write-Host ""

$railwayDone = Read-Host "Railway variables updated? (y/n)"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  STEP 3: Clean Git History" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$cleanHistory = Read-Host "Do you want to clean git history now? (y/n)"

if ($cleanHistory -eq "y") {
    Write-Host ""
    Write-Host "Checking for git-filter-repo..." -ForegroundColor Yellow
    
    try {
        $filterRepoPath = (Get-Command git-filter-repo -ErrorAction Stop).Source
        Write-Host "Found: $filterRepoPath" -ForegroundColor Green
    }
    catch {
        Write-Host "git-filter-repo not found. Installing..." -ForegroundColor Yellow
        pip install git-filter-repo
    }
    
    Write-Host ""
    Write-Host "WARNING: This will rewrite git history!" -ForegroundColor Red
    $confirm = Read-Host "Are you sure? Type 'YES' to continue"
    
    if ($confirm -eq "YES") {
        Write-Host ""
        Write-Host "Cleaning git history..." -ForegroundColor Yellow
        
        try {
            git-filter-repo --path-glob "**/.env*" --invert-paths --force
            
            Write-Host ""
            Write-Host "✓ Git history cleaned!" -ForegroundColor Green
            Write-Host ""
            
            $forcePush = Read-Host "Force push to GitHub? This will overwrite remote history (y/n)"
            
            if ($forcePush -eq "y") {
                Write-Host ""
                Write-Host "Force pushing to GitHub..." -ForegroundColor Yellow
                git push origin --force --all
                git push origin --force --tags
                
                Write-Host ""
                Write-Host "✓ History cleaned from GitHub!" -ForegroundColor Green
            }
            else {
                Write-Host ""
                Write-Host "Run manually: git push origin --force --all" -ForegroundColor Yellow
            }
        }
        catch {
            Write-Host ""
            Write-Host "Error cleaning history. See CRITICAL_SECURITY_ACTION_REQUIRED.md for alternatives" -ForegroundColor Red
        }
    }
    else {
        Write-Host "History cleaning skipped. Run manually when ready." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  STEP 4: Enable GitHub Secret Scanning" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Go to: https://github.com/CSKrishnaprasad/EcommerceAutobacs/settings/security_analysis" -ForegroundColor White
Write-Host "2. Enable:" -ForegroundColor White
Write-Host "   - Secret scanning" -ForegroundColor White
Write-Host "   - Push protection" -ForegroundColor White
Write-Host "   - Dependabot alerts" -ForegroundColor White
Write-Host ""

Write-Host "========================================" -ForegroundColor Green
Write-Host "  Security Rotation Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Test your application with new secrets" -ForegroundColor White
Write-Host "  2. Monitor logs for unauthorized access" -ForegroundColor White
Write-Host "  3. Consider installing pre-commit hooks (see guide)" -ForegroundColor White
Write-Host ""
Write-Host "Full guide: CRITICAL_SECURITY_ACTION_REQUIRED.md" -ForegroundColor Cyan
Write-Host ""
