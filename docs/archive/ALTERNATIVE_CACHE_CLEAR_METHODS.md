# Alternative Methods to Force Railway Rebuild (When "Clear Build Cache" is Missing)

## Problem
The "Clear Build Cache" button is not visible in Railway dashboard settings.

## Solution: Force Fresh Build Using These Methods

---

## METHOD 1: Modify Dockerfile BUILD_ID (RECOMMENDED - Works 100%)

This forces Docker to rebuild from scratch by changing a comment in the Dockerfile.

### Steps:

**1. Update Backend Dockerfile:**
```powershell
# Run this in PowerShell
cd "c:\Main project\Autobacs\Back-end\server"

# Read the Dockerfile
$content = Get-Content Dockerfile -Raw

# Replace the BUILD_HASH comment with new timestamp
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$newContent = $content -replace 'BUILD_HASH:.*', "BUILD_HASH: FORCE-REBUILD-$timestamp"

# Write back
$newContent | Set-Content Dockerfile -NoNewline

# Verify
Get-Content Dockerfile | Select-String "BUILD_HASH"
```

**2. Update Frontend Dockerfile:**
```powershell
cd "c:\Main project\Autobacs\Front-end\web"

# Add build timestamp comment at the top
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$content = Get-Content Dockerfile -Raw

if ($content -notmatch "FORCE-REBUILD") {
    "# BUILD_TRIGGER: $timestamp`n" + $content | Set-Content Dockerfile -NoNewline
}

# Verify
Get-Content Dockerfile | Select-String "BUILD_TRIGGER" -First 1
```

**3. Commit and Push:**
```powershell
cd "c:\Main project\Autobacs"

git add Back-end/server/Dockerfile Front-end/web/Dockerfile
git commit -m "Force rebuild: Update Dockerfile build trigger $(Get-Date -Format 'yyyyMMdd-HHmmss')"
git push origin main
```

**Why this works:** Docker sees the Dockerfile has changed and invalidates the entire build cache.

---

## METHOD 2: Delete and Recreate Service (GUARANTEED FRESH)

This is the nuclear option - completely removes the service and creates it fresh.

### Steps:

**1. Delete Frontend Service:**
- Go to Railway dashboard
- Click on Frontend service
- Go to **Settings** tab
- Scroll to **VERY BOTTOM**
- Click **"Delete Service"** (in Danger Zone section)
- Type the service name to confirm
- Click **Delete**

**2. Create New Service:**
- Go back to your project page
- Click **"New"** button (top right)
- Select **"GitHub Repo"**
- Choose: `CSKrishnaprasad/EcommerceAutobacs`
- Configure:
  - **Root Directory:** `Autobacs/Front-end/web`
  - **Builder:** Dockerfile (should auto-detect)
- Click **"Deploy"**

**3. Add Environment Variables:**
- Go to the new service
- Click **"Variables"** tab
- Add all required environment variables (copy from backup or .env.example)
- Key variables needed:
  - `NEXT_PUBLIC_API_URL`
  - `NEXT_PUBLIC_API_BASE_URL`
  - `NEXT_PUBLIC_APP_URL`
  - `NODE_ENV=production`

**4. Wait for deployment** (5-7 minutes)

**Why this works:** Brand new service = zero cache = 100% fresh build.

---

## METHOD 3: Change Root Directory Temporarily

This tricks Railway into thinking it's a different project.

### Steps:

1. Go to Frontend service → **Settings** tab
2. Find **"Root Directory"** field
3. Change from: `Autobacs/Front-end/web`
4. Change to: `Autobacs/Front-end/web` (add and remove a space, or add `/` at end)
5. Click **Save**
6. Go to **Deployments** tab
7. Click **"Redeploy"** on latest deployment
8. After it starts building, change Root Directory back to original
9. Redeploy again

**Why this works:** Changing root directory invalidates the build context.

---

## METHOD 4: Add Empty File to Invalidate Cache

Create a new file that forces Docker to rebuild.

### Steps:

**1. Create a trigger file:**
```powershell
cd "c:\Main project\Autobacs\Front-end\web"

# Create a new file with timestamp
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
"Build forced at: $timestamp" | Out-File -FilePath "BUILD_FORCE_$timestamp" -Encoding utf8
```

**2. Update .dockerignore to NOT ignore this file:**
```powershell
# Check if BUILD_FORCE is in .dockerignore
$content = Get-Content .dockerignore -Raw
if ($content -match "BUILD_FORCE") {
    $content = $content -replace "BUILD_FORCE.*\n", ""
    $content | Set-Content .dockerignore -NoNewline
}
```

**3. Commit and push:**
```powershell
cd "c:\Main project\Autobacs"

git add Front-end/web/BUILD_FORCE_*
git commit -m "Add build trigger file to force cache invalidation"
git push origin main
```

---

## METHOD 5: Use Railway CLI to Redeploy

If you have Railway CLI installed:

```powershell
# Login to Railway
railway login

# Link to your project (follow prompts)
railway link

# Deploy with --no-cache flag (if available)
railway up --detach

# Or redeploy specific service
railway up --service [service-name] --detach
```

---

## METHOD 6: Trigger Build via Railway API

Advanced method using Railway's API:

```powershell
# Get your project and service IDs from Railway dashboard URL
# URL format: https://railway.com/project/[PROJECT_ID]/service/[SERVICE_ID]

$projectId = "your-project-id"
$serviceId = "your-service-id"
$apiKey = "your-railway-api-token"

# Trigger deployment
$headers = @{
    "Authorization" = "Bearer $apiKey"
    "Content-Type" = "application/json"
}

$body = @{
    projectId = $projectId
    serviceId = $serviceId
    branch = "main"
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://backboard.railway.com/graphql/v2" -Method POST -Headers $headers -Body $body
```

---

## ✅ RECOMMENDED APPROACH

**Do THIS right now (easiest and fastest):**

### Option A: Modify Dockerfile (2 minutes)
```powershell
# Copy and paste this entire block into PowerShell:

cd "c:\Main project\Autobacs"

# Update Backend Dockerfile
$ts1 = Get-Date -Format "yyyyMMdd-HHmmss"
$backend = Get-Content "Back-end\server\Dockerfile" -Raw
$backend = $backend -replace 'BUILD_HASH:.*', "BUILD_HASH: FORCE-REBUILD-$ts1"
$backend | Set-Content "Back-end\server\Dockerfile" -NoNewline

# Update Frontend Dockerfile
$ts2 = Get-Date -Format "yyyyMMdd-HHmmss"
$frontend = Get-Content "Front-end\web\Dockerfile" -Raw
if ($frontend -notmatch "FORCE-REBUILD") {
    $frontend = "# BUILD_TRIGGER: FORCE-REBUILD-$ts2`n" + $frontend
}
$frontend | Set-Content "Front-end\web\Dockerfile" -NoNewline

# Commit and push
git add Back-end/server/Dockerfile Front-end/web/Dockerfile
git commit -m "Force rebuild with timestamp $ts1"
git push origin main

Write-Host "✅ Dockerfiles updated and pushed!" -ForegroundColor Green
Write-Host "✅ Railway will now trigger a fresh build!" -ForegroundColor Green
Write-Host "⏳ Wait 3-5 minutes for deployment" -ForegroundColor Yellow
```

### Option B: Delete & Recreate Service (5 minutes)
1. Delete the Frontend service in Railway
2. Create it fresh from GitHub
3. Add environment variables
4. Deploy

---

## How to Verify Fresh Build

After triggering rebuild, check Railway deployment logs:

**✅ GOOD (Fresh Build):**
```
Step 1/15 : FROM node:20-alpine AS builder
 ---> Downloading (not cached)
Step 2/15 : WORKDIR /app
 ---> Running in container
```

**❌ BAD (Still Using Cache):**
```
Step 1/15 : FROM node:20-alpine AS builder
 ---> Using cache
Step 2/15 : WORKDIR /app
 ---> Using cache
```

---

## Timeline
- ✅ Code on GitHub: April 18, 2026
- ✅ .dockerignore added: April 20, 2026
- ⏳ **NOW: Force fresh build using one of the methods above**
- ⏳ Deployment should complete in 3-5 minutes
- ✅ Verify vehicle selector appears on production

---

**Try Method 1 (Modify Dockerfile) first - it's the fastest and most reliable!**
