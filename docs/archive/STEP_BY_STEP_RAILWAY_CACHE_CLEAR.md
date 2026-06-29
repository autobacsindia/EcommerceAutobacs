# 🎯 STEP-BY-STEP: Clear Railway Build Cache (With Visual Guide)

## Why This Is Necessary
Railway is using OLD cached builds. The automation script CANNOT clear the cache - only you can do this manually in the Railway dashboard.

---

## 📋 PRECISE STEPS (Follow Exactly)

### STEP 1: Open Railway
1. Open your browser
2. Go to: **https://railway.com/**
3. You should see your dashboard with projects

### STEP 2: Select Your Project
1. Look for project named: **"EcommerceAutobacs"** or similar
2. Click on it
3. You'll see a visual diagram with your services (Frontend, Backend, Database, etc.)

### STEP 3: Click on Frontend Service
1. Find the service that runs your Next.js frontend
2. It might be named: "web", "frontend", "nextjs", or similar
3. **Click on that service box**
4. A new page opens showing that service

### STEP 4: Go to Settings Tab
1. Look at the TOP of the page
2. You'll see tabs: "Deployments", "Variables", "Settings", "Metrics"
3. **Click on "Settings"** tab
4. The page will show various configuration options

### STEP 5: Find Build Section
1. **Scroll DOWN** the Settings page
2. Look for section titled: **"Build"**
3. Inside this section, you'll see:
   - Builder: Dockerfile
   - Dockerfile Path: ./Dockerfile
   - **⚠️ "Clear Build Cache" button** (this is what we need!)

### STEP 6: Clear the Cache ⚠️ CRITICAL
1. **Click the "Clear Build Cache" button**
2. A confirmation dialog appears
3. Click **"Confirm"** or **"Yes"**
4. You should see a message: "Build cache cleared"

### STEP 7: Trigger Redeployment
**Option A - Redeploy Latest:**
1. Click on **"Deployments"** tab (at the top)
2. Find the latest deployment (should show commit `90d85326` or `00a060b9`)
3. Click the **"...""** (three dots) on the RIGHT side
4. Click **"Redeploy"**

**Option B - Deploy from GitHub:**
1. Click on **"Deployments"** tab
2. Click **"Deploy"** button (top right)
3. Select **"Deploy from GitHub repo"**
4. Choose branch: **main**
5. Click **"Deploy"**

### STEP 8: Watch the Build
1. You'll see the deployment in progress
2. Click on the deployment to see logs
3. Build takes **3-5 minutes**
4. Look for messages like:
   ```
   Building with Dockerfile
   Step 1/15 : FROM node:20-alpine AS builder
   ...
   ```

### STEP 9: Verify Deployment
1. Once deployment shows **"SUCCESS"** or **"Deployed"**
2. Click on the deployment
3. Find your production URL (looks like: `https://your-app.up.railway.app`)
4. **Click the URL** to open your site

### STEP 10: Hard Refresh Browser ⚠️ IMPORTANT
Your browser might show old cached version. Force it to load new version:

**Windows (Chrome/Edge):**
- Press: **Ctrl + Shift + R**
- OR: Press **F12** → Right-click the refresh button → "Empty Cache and Hard Reload"

**What to look for:**
- ✅ Vehicle selector dropdown in the header (near the top)
- ✅ Updated categories navigation
- ✅ New styling or layout changes

---

## 🖼️ Visual Map of Railway Dashboard

```
Railway Dashboard
├── Project: EcommerceAutobacs
│   ├── [Frontend Service] ← CLICK THIS
│   ├── [Backend Service]
│   └── [Database Service]
│
After clicking Frontend:
│
├── Tabs: [Deployments] [Variables] [Settings] ← CLICK THIS
│                               [Metrics]
│
In Settings tab (scroll down):
│
├── General
│   ├── Service Name
│   └── Root Directory
│
├── Build ← LOOK FOR THIS SECTION
│   ├── Builder: Dockerfile
│   ├── Dockerfile Path: ./Dockerfile
│   └── [Clear Build Cache] ← CLICK THIS BUTTON!
│
└── Deploy
    ├── Start Command
    └── Healthcheck Path
```

---

## ❓ Troubleshooting

### "I don't see Clear Build Cache button"
- Make sure you're in the **Settings** tab (not Deployments)
- Scroll DOWN - it's usually in the middle of the page
- You might need admin permissions on the project

### "Cache cleared but still showing old version"
1. Did you **redeploy** after clearing cache? (Step 7)
2. Did you **hard refresh** your browser? (Step 10)
3. Check the deployment logs - does it say "CACHED" everywhere?
   - If yes, cache wasn't cleared properly - try again
   - If no "CACHED" messages, the build is fresh

### "Deployment is failing"
1. Click on the failed deployment
2. Look at the **Build Logs**
3. Look for error messages (usually in red)
4. Common errors:
   - Build timeout: Try again
   - Out of memory: Contact Railway support
   - Dockerfile error: Check your Dockerfile syntax

### "I cleared cache but deployment still uses old code"
**Last Resort - Delete and Recreate Service:**
1. Go to Frontend service → Settings tab
2. Scroll to VERY BOTTOM
3. Click **"Delete Service"** (danger zone)
4. Confirm deletion
5. Go back to project page
6. Click **"New"** → **"GitHub Repo"**
7. Select: `CSKrishnaprasad/EcommerceAutobacs`
8. Set root directory: `Autobacs/Front-end/web`
9. Click **Deploy**

This guarantees 100% fresh build with NO cache whatsoever.

---

## ✅ Success Checklist

After following all steps, verify:
- [ ] Build cache was cleared in Railway dashboard
- [ ] New deployment triggered successfully
- [ ] Deployment shows "SUCCESS" status
- [ ] Build logs don't show "CACHED" everywhere
- [ ] Opened production URL
- [ **Hard refreshed browser** (Ctrl + Shift + R)
- [ ] Can see vehicle selector in header
- [ ] Categories are updated
- [ ] No console errors in browser DevTools (F12)

---

## 📞 If You're Still Stuck

Take a screenshot of:
1. Your Railway dashboard showing the project
2. The Settings tab of the Frontend service
3. The current deployment logs

This will help diagnose exactly what's happening.

---

**Remember: The code is 100% ready on GitHub. Railway just needs the cache cleared manually!**
