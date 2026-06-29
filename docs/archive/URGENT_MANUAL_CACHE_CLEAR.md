# URGENT: Manual Railway Cache Clear Required

## Why The Script Didn't Work
The automation script can trigger deployments but **CANNOT clear Railway's build cache** - this MUST be done manually in the Railway dashboard.

## IMMEDIATE ACTION REQUIRED (2 Minutes)

### Step-by-Step Instructions:

**1. Open Railway Dashboard**
   - Go to: https://railway.com/
   - Login if needed

**2. Navigate to Your Project**
   - Click on: **EcommerceAutobacs** (or your project name)
   - You'll see your services (Frontend, Backend, etc.)

**3. Clear Frontend Build Cache** ⚠️ CRITICAL
   - Click on the **Frontend** service (the one with the vehicle/categories updates)
   - Click on **"Settings"** tab (top navigation)
   - Scroll down to the **"Build"** section
   - Find and click: **"Clear Build Cache"** button
   - Confirm the action

**4. Trigger New Deployment**
   - Click on **"Deployments"** tab
   - You should see the latest deployment with commit: `90d85326` or `00a060b9`
   - Click the **"..."** (three dots) menu on the right
   - Click **"Redeploy"**
   - OR click **"Deploy"** button → **"Deploy from GitHub repo"** → Select `main` branch

**5. Wait for Build to Complete**
   - The build will take 3-5 minutes
   - Watch the deployment logs
   - Look for: "Building with Dockerfile" (NOT using cached layers)

**6. Verify the Update**
   - Visit your production URL
   - Check for the vehicle selector dropdown in the header
   - Navigate to categories and verify updates
   - Hard refresh your browser: **Ctrl + Shift + R** (Windows) or **Cmd + Shift + R** (Mac)

---

## How to Verify Build is Fresh (Not Cached)

In the Railway deployment logs, you should see:
```
=> CACHED [internal] load metadata for docker.io/library/node:20-alpine  ❌ BAD (using cache)
=> [internal] load metadata for docker.io/library/node:20-alpine         ✅ GOOD (fresh build)
```

If you see "CACHED" everywhere, the cache wasn't cleared properly.

---

## Alternative: Delete and Recreate Service (Last Resort)

If clearing cache doesn't work:

1. In Railway dashboard, click on the **Frontend** service
2. Go to **Settings** tab
3. Scroll to bottom and click **"Delete Service"**
4. Go back to your project
5. Click **"New"** → **"GitHub Repo"**
6. Select: `CSKrishnaprasad/EcommerceAutobacs`
7. Configure:
   - Root directory: `Autobacs/Front-end/web`
   - Builder: Dockerfile
8. Click **Deploy**

This guarantees 100% fresh build with NO cache.

---

## What Changed in Your Code (Commit 00a060b9)

✅ **NEW FILE:** `HeaderVehicleSelector.tsx` (203 lines) - Vehicle dropdown selector  
✅ **MODIFIED:** `Header.tsx` - Integrated vehicle selector  
✅ **MODIFIED:** `MobileMenu.tsx` - Added vehicle selector to mobile  
✅ **MODIFIED:** `categories/[slug]/ClientPage.tsx` - Category page fixes  
✅ **MODIFIED:** `products/page.tsx` - Product page updates  
✅ **MODIFIED:** `lib/constants.ts` - Updated constants  

**Total:** 563 lines added, 10 lines removed

---

## Browser Cache Issue?

After Railway deploys, your browser might still show old cached version:

**Windows:**
- Chrome/Edge: `Ctrl + Shift + Delete` → Clear cache
- OR: `Ctrl + Shift + R` (hard refresh)
- OR: Open DevTools (F12) → Right-click refresh → "Empty Cache and Hard Reload"

**Mac:**
- Chrome/Safari: `Cmd + Shift + R` (hard refresh)
- OR: `Cmd + Option + E` then `Cmd + R`

---

## Still Not Working?

Run this diagnostic command to verify the code is on GitHub:
```powershell
cd "c:\Main project\Autobacs"
git log --oneline -5
```

You should see:
```
90d85326 Add Railway redeployment guide and automation script
e2e7536f Add .dockerignore files to force clean Railway builds
00a060b9 commit  ← This has your vehicle/categories updates
```

Then check GitHub directly:
https://github.com/CSKrishnaprasad/EcommerceAutobacs/tree/main/Autobacs/Front-end/web/src/components/layout

You should see `HeaderVehicleSelector.tsx` file there.

---

## Timeline
- ✅ Code committed: April 18, 2026
- ✅ Code pushed to GitHub: April 18, 2026
- ✅ Cache fix committed: April 20, 2026 11:43 AM
- ⏳ **AWAITING: Manual cache clear in Railway dashboard**
- ⏳ **AWAITING: Fresh deployment**

---

**The code is 100% ready on GitHub. Railway just needs you to clear the build cache manually!**
