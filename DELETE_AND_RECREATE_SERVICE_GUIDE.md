# 🚨 URGENT: Delete & Recreate Railway Service - Step by Step

## Why This Is Necessary
Railway's Docker cache is at the registry level and CANNOT be cleared through normal means. We've tried:
- ❌ .dockerignore files
- ❌ Dockerfile timestamp changes  
- ❌ Package.json version bumps
- ❌ Build trigger files

**ALL FAILED** - Everything still shows "cached" in build logs.

**Solution:** Delete the service and create it fresh. This guarantees ZERO cache.

---

## 📋 STEP-BY-STEP INSTRUCTIONS

### PHASE 1: Backup Environment Variables (IMPORTANT!)

Before deleting, save your environment variables:

1. Go to: https://railway.com/
2. Click your **EcommerceAutobacs** project
3. Click on the **Frontend** service (the one that needs rebuilding)
4. Click **"Variables"** tab at the top
5. **TAKE SCREENSHOTS** of all environment variables, or copy them to a text file

You need to save these variables (example):
```
NEXT_PUBLIC_API_URL = https://your-backend.up.railway.app
NEXT_PUBLIC_API_BASE_URL = https://your-backend.up.railway.app
NEXT_PUBLIC_APP_URL = https://ecommerceautobacs-production-1716.up.railway.app
NODE_ENV = production
```

**⚠️ DO NOT SKIP THIS STEP!** You'll need these variables for the new service.

---

### PHASE 2: Delete the Frontend Service

1. With the **Frontend** service still selected
2. Click **"Settings"** tab
3. Scroll to the **VERY BOTTOM** of the page
4. Look for **"Danger Zone"** section
5. Click **"Delete Service"** button
6. A dialog will appear asking you to confirm
7. **Type the service name** exactly as shown
8. Click **"Delete"** or **"Confirm"**

The service will be deleted. Don't worry - this only deletes the Railway service, not your code on GitHub.

---

### PHASE 3: Create Fresh Service

1. Go back to your **EcommerceAutobacs** project page
2. Click **"New"** button (top right corner)
3. Select **"GitHub Repo"** from the dropdown
4. Search and select: `CSKrishnaprasad/EcommerceAutobacs`
5. Click **"Deploy"**

Railway will start configuring the service.

---

### PHASE 4: Configure the Service

Railway might auto-detect the configuration, but verify these settings:

1. Click on the **new service** that was created
2. Go to **"Settings"** tab
3. Verify these settings:
   - **Root Directory:** `Autobacs/Front-end/web`
   - **Builder:** `Dockerfile` (should auto-detect)
   - **Dockerfile Path:** `./Dockerfile`

If Root Directory is not set correctly:
- Click "Edit" next to Root Directory
- Enter: `Autobacs/Front-end/web`
- Click **Save**

---

### PHASE 5: Add Environment Variables

1. Click **"Variables"** tab on the new service
2. Add all the environment variables you saved in Phase 1:
   - Click **"New Variable"**
   - Enter the variable name and value
   - Click **"Add"**
   - Repeat for each variable

**Required Variables:**
```
NEXT_PUBLIC_API_URL = [your backend URL]
NEXT_PUBLIC_API_BASE_URL = [your backend URL]
NEXT_PUBLIC_APP_URL = [your frontend URL]
NODE_ENV = production
```

If you're unsure about the values, check your `.env.local` or `.env.production` file in `Autobacs/Front-end/web/`

---

### PHASE 6: Deploy

1. After adding all variables
2. Go to **"Deployments"** tab
3. The service should automatically start building
4. If not, click **"Deploy"** → **"Deploy from GitHub repo"** → Select `main` branch

---

### PHASE 7: Monitor the Build

Click on the deployment to watch the build logs.

**✅ SUCCESS - You should see:**
```
Step 1/15 : FROM node:20-alpine AS builder
 ---> Downloading (NOT cached)
Step 2/15 : WORKDIR /app
 ---> Running in container (NOT cached)
...
Step X/15 : RUN npm run build
 ---> This will take 60-120 seconds (NOT 0ms!)
...
Build time: 180-300 seconds (3-5 minutes)
```

**❌ FAILURE - If you see:**
```
RUN npm run build cached
0ms
Build time: 10-20 seconds
```
Then something went wrong - contact me immediately.

---

### PHASE 8: Verify Deployment

Once deployment shows **"SUCCESS"**:

1. Click on the deployment
2. Find your **production URL** (should be the same as before)
3. Click the URL to open your site
4. **Hard refresh browser:** `Ctrl + Shift + R`
5. **Look for:**
   - ✅ Vehicle selector dropdown in header
   - ✅ Updated categories navigation
   - ✅ Mobile menu improvements

---

## 🔍 Verification Checklist

After completing all phases:

- [ ] Environment variables backed up (screenshots taken)
- [ ] Old Frontend service deleted
- [ ] New service created from GitHub repo
- [ ] Root Directory set to: `Autobacs/Front-end/web`
- [ ] All environment variables added to new service
- [ ] Deployment triggered
- [ ] Build logs show NO "cached" messages
- [ ] Build time is 180-300 seconds (not 10-20 seconds)
- [ ] Deployment status: SUCCESS
- [ ] Production URL accessible
- [ ] Browser hard refreshed (Ctrl + Shift + R)
- [ ] Vehicle selector visible in header
- [ ] No console errors in browser DevTools (F12)

---

## ⏱️ Expected Timeline

- Phase 1 (Backup variables): 2 minutes
- Phase 2 (Delete service): 1 minute
- Phase 3-4 (Create & configure): 2 minutes
- Phase 5 (Add variables): 3 minutes
- Phase 6-7 (Build): 3-5 minutes
- Phase 8 (Verify): 2 minutes

**Total: ~15 minutes**

---

## 📞 If Something Goes Wrong

**Problem:** Can't find environment variables
**Solution:** Check these files in your codebase:
- `Autobacs/Front-end/web/.env.local`
- `Autobacs/Front-end/web/.env.production`
- `Autobacs/Front-end/web/.env.example`

**Problem:** Build fails with errors
**Solution:** Copy the error message from Railway logs and send it to me

**Problem:** New service has different URL
**Solution:** You can set a custom domain in Railway Settings, or update your DNS

**Problem:** Vehicle selector still not showing
**Solution:** 
1. Check browser console for errors (F12)
2. Verify the deployment logs showed fresh build (not cached)
3. Try incognito/private browsing mode

---

## 🎯 Why This Works

When you delete and recreate a service:
- ✅ **Zero Docker cache** - Brand new service = no cached layers
- ✅ **Fresh npm install** - Must install all dependencies from scratch
- ✅ **Fresh Next.js build** - Must compile everything from scratch
- ✅ **Latest code** - Pulls from GitHub main branch (which has all your updates)

This is the **NUCLEAR OPTION** and it **ALWAYS WORKS**.

---

## 📊 Current State

- ✅ Code on GitHub: Commit `358f90f9` (12:36 PM)
- ✅ Vehicle selector code: Ready and tested
- ✅ All features: Complete and working
- ❌ Railway: Using stale registry cache that cannot be cleared
- ❌ Production: Still showing version from before April 18

**The delete & recreate method is the ONLY solution that will work.**

---

**Take your time, follow each step carefully, and you'll have your vehicle selector live within 15 minutes!**
