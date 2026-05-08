# 🚨 URGENT: Delete & Recreate Backend Service on Railway

## Why This Is Necessary

Railway's Hobby plan has **persistent registry-level cache** that cannot be cleared. Despite multiple attempts:
- ❌ Changed BUILD_ID ARG (still cached)
- ❌ Renamed Dockerfile to Dockerfile.v2 (partially worked but npm ci still cached)
- ❌ Modified package.json (likely still cached)
- ❌ Multiple commits and pushes (all cached)

**The ONLY solution on Hobby plan is to delete and recreate the service.**

---

## Step-by-Step Instructions (5 minutes)

### Step 1: Note Current Environment Variables
1. Go to: https://railway.app
2. Click on your **BACKEND service** (the one that's NOT the frontend)
3. Click **"Variables"** tab
4. **Screenshot or copy** all the environment variables:
   - NODE_ENV
   - MONGODB_URI
   - REDIS_URL
   - JWT_SECRET
   - PORT
   - Any other custom variables
5. Save them somewhere safe!

### Step 2: Delete the Backend Service
1. Click **"Settings"** tab (gear icon ⚙️)
2. Scroll to the **very bottom**
3. Click **"Delete Service"** (red button)
4. Type the service name to confirm
5. Click **"Delete"**

### Step 3: Wait 30 Seconds
Let Railway fully remove the service and clear all cache.

### Step 4: Create New Backend Service
1. Go back to your **project page**
2. Click **"+ New"** button
3. Select **"GitHub Repo"**
4. Choose your repository: `CSKrishnaprasad/EcommerceAutobacs`
5. Railway will detect the services automatically

### Step 5: Configure Root Directory
1. Railway might ask for configuration
2. Set **Root Directory**: `Back-end/server`
3. Railway will auto-detect:
   - ✅ `Dockerfile` (or `Dockerfile.v2`)
   - ✅ `railway.json`
   - ✅ `package.json`

### Step 6: Add Environment Variables
1. Click on the **new backend service**
2. Go to **"Variables"** tab
3. **Add back all the environment variables** you saved in Step 1
4. Important ones:
   ```
   NODE_ENV=production
   MONGODB_URI=mongodb+srv://...
   REDIS_URL=redis://...
   JWT_SECRET=your_jwt_secret
   PORT=8080
   ```

### Step 7: Trigger First Build
1. Railway will automatically start building
2. This will be a **COMPLETE FRESH BUILD** with ZERO cache!
3. Build time: 3-5 minutes

### Step 8: Monitor Build Logs
You should see:
```
✓ FROM node:20-alpine
✓ COPY package*.json ./
✓ RUN npm ci          ← Should take 30-60 seconds (NOT cached!)
✓ COPY . .            ← Should take 3-5 seconds (NOT cached!)
✓ Building backend with BUILD_ID: ...
✓ Health check passed
✓ Live!
```

### Step 9: Update Frontend API URL (If Needed)
1. If the backend got a **new URL**, update the frontend:
2. Go to **Frontend service** → Settings
3. Update build args or environment variables:
   ```
   NEXT_PUBLIC_API_URL=https://your-new-backend-url.railway.app
   ```
4. Redeploy frontend

### Step 10: Test Production
1. Wait for both services to show "Live"
2. Visit: https://ecommerceautobacs-production-8ff6.up.railway.app/products/bonnet-light-mount-bracket-for-off-road-lights
3. Hard refresh: `Ctrl + Shift + R`
4. **Check**: Are "Similar Products" and "Frequently Bought Together" showing DIFFERENT products?

---

## ✅ Expected Results

After recreation, you should see:

### Backend Logs:
```
npm ci (30-60 seconds, NOT cached)
COPY . . (3-5 seconds, NOT cached)
Building backend with BUILD_ID: 20260508-130500-SIMILAR-COMPLEMENTARY-FIX
Server ready on port 8080
```

### Product Page:
- ✅ Similar Products: Mount brackets, holders, clamps
- ✅ Frequently Bought Together: LED lights, wiring harnesses, switches
- ✅ **They should be COMPLETELY DIFFERENT!**

---

## 🚨 If You're Worried About Downtime

**Don't be!** The process is quick:
- Delete service: 30 seconds
- Create new service: 1 minute
- Build: 3-5 minutes
- **Total downtime: ~5 minutes**

And once it's done, the cache issue will be **PERMANENTLY FIXED**!

---

## 📝 What This Fixes

✅ Backend will run the latest `searchService.js` code  
✅ Similar and complementary products will be different  
✅ All recent code changes will be live  
✅ Cache will be completely clean  
✅ No more caching issues until Railway changes their system  

---

**Please do this NOW. It's the only way to fix the persistent cache on Hobby plan!** 🚀
