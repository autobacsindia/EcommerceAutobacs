# 🚨 CRITICAL SECURITY ALERT - Secrets Exposed in Git History

## Status: SECRETS FOUND AND NEED IMMEDIATE ROTATION

Exposed secrets detected in git history:
- ❌ MongoDB connection string with password
- ❌ Google Maps API keys (Client & Server)
- ❌ SendGrid API key

---

## ⚡ IMMEDIATE ACTION REQUIRED (DO THIS NOW!)

### STEP 1: Rotate ALL Exposed Secrets

#### 1.1 MongoDB Atlas Password
1. Go to: https://cloud.mongodb.com/
2. Navigate to: Database Access
3. Click on user: `Autobacs_info_db`
4. Click "Edit" → "Edit Password"
5. Generate new strong password
6. Update Railway backend environment variable: `MONGO_URI`
7. **New format:** `mongodb+srv://Autobacs_info_db:NEW_PASSWORD@cluster0.uavmin7.mongodb.net/autobacs?retryWrites=true&w=majority&appName=Cluster0`

#### 1.2 Google Maps API Keys
1. Go to: https://console.cloud.google.com/apis/credentials
2. **Delete or restrict** these exposed keys:
   - `AIzaSyCqmI-sLBZG726AoLN1x0SpBsdMtvJf7Hg` (Client)
   - `AIzaSyBDvVjZvbKADJRp3VBa-FjtrmndNP0FG24` (Server)
3. Create NEW API keys
4. Add HTTP referrer restrictions (only your domains)
5. Update environment variables:
   - `GOOGLE_MAPS_CLIENT_KEY` (Railway frontend)
   - `GOOGLE_MAPS_SERVER_KEY` (Railway backend)

#### 1.3 SendGrid API Key
1. Go to: https://app.sendgrid.com/settings/api_keys
2. **Delete** exposed key: `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`
3. Create new API key
4. Update Railway backend: `SENDGRID_API_KEY`

---

### STEP 2: Clean Git History

#### Option A: Using git-filter-repo (Recommended)

```powershell
# Install git-filter-repo (if not installed)
pip install git-filter-repo

# Navigate to repo
cd "c:\Main project\Autobacs"

# Remove all .env files from history
git-filter-repo --path-glob "**/.env*" --invert-paths --force

# Force push to GitHub
git push origin --force --all
git push origin --force --tags
```

#### Option B: Using BFG Repo-Cleaner (Alternative)

```powershell
# Download BFG from: https://rtyley.github.io/bfg-repo-cleaner/
# Or install via: scoop install bfg

cd "c:\Main project\Autobacs"

# Delete .env files from history
bfg --delete-files "*.env" --no-blob-protection

# Clean up
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Force push
git push origin --force --all
```

#### Option C: Manual Nuclear Option (If tools fail)

```powershell
cd "c:\Main project\Autobacs"

# Create new branch from first commit
git checkout --orphan temp-main

# Add all files except .env
git add .
git commit -m "Initial commit (clean history)"

# Cherry-pick non-.env commits manually
# This is labor-intensive but guaranteed clean

# Replace main branch
git branch -D main
git branch -m temp-main main
git push origin --force main
```

---

### STEP 3: Verify Cleanup

After cleaning history:

```powershell
# Search for any remaining secrets
git log --all -p | Select-String -Pattern "mongodb\+srv|SG\.|AIza|sk-|pk-"

# Should return NO results
```

---

### STEP 4: Check GitHub for Leaked Secrets

1. **Search GitHub:**
   - Go to: https://github.com/search
   - Search: `repo:CSKrishnaprasad/EcommerceAutobacs "mongodb+srv"`
   - Search: `repo:CSKrishnaprasad/EcommerceAutobacs "AIza"`
   - Search: `repo:CSKrishnaprasad/EcommerceAutobacs "SG."`

2. **Check if indexed by Google:**
   - Search: `site:github.com "CSKrishnaprasad/EcommerceAutobacs" "mongodb"`
   - Search: `site:github.com "CSKrishnaprasad/EcommerceAutobacs" "api key"`

3. **If found in search results:**
   - Request removal via GitHub
   - File DMCA takedown if necessary

---

### STEP 5: Add Prevention Measures

#### 5.1 GitHub Secret Scanning
1. Go to: https://github.com/CSKrishnaprasad/EcommerceAutobacs/settings/security_analysis
2. Enable:
   - ✅ Secret scanning
   - ✅ Push protection
   - ✅ Dependabot alerts

#### 5.2 Pre-commit Hooks (Local)
```powershell
# Install pre-commit
pip install pre-commit

# Create .pre-commit-config.yaml
cat > .pre-commit-config.yaml @"
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.1
    hooks:
      - id: gitleaks
  - repo: https://github.com/trufflesecurity/trufflehog
    rev: main
    hooks:
      - id: trufflehog
"@

# Install hooks
pre-commit install
```

#### 5.3 Install Gitleaks
```powershell
# Windows (Scoop)
scoop install gitleaks

# Or download from: https://github.com/gitleaks/gitleaks/releases

# Scan repo
gitleaks detect --source . -v
```

---

### STEP 6: Railway Security Audit

#### 6.1 Check Build Logs
1. Go to Railway dashboard
2. Check recent deployments
3. Verify NO secrets appear in build logs
4. If found, delete those deployments

#### 6.2 Verify Frontend Bundle
1. Open production site
2. Press F12 → Network tab
3. Search for sensitive patterns in JS files:
   - `mongodb+srv`
   - `SG.`
   - `AIza`
4. **Should NOT find any** (frontend should only have `NEXT_PUBLIC_*` vars)

#### 6.3 Backend-Only Variables
Ensure these are ONLY in backend Railway service:
- ✅ `MONGO_URI`
- ✅ `SENDGRID_API_KEY`
- ✅ `GOOGLE_MAPS_SERVER_KEY`
- ✅ `JWT_SECRET`
- ✅ `CLOUDINARY_API_SECRET`
- ✅ Any `*_SECRET` variables

Ensure these are in frontend Railway service:
- ✅ `NEXT_PUBLIC_API_URL`
- ✅ `NEXT_PUBLIC_API_BASE_URL`
- ✅ `NEXT_PUBLIC_APP_URL`
- ✅ `GOOGLE_MAPS_CLIENT_KEY` (if needed client-side)

---

## 📋 Secret Rotation Checklist

- [ ] MongoDB password rotated
- [ ] MongoDB URI updated in Railway backend
- [ ] Google Maps Client key rotated
- [ ] Google Maps Server key rotated
- [ ] Keys updated in Railway (frontend + backend)
- [ ] SendGrid API key rotated
- [ ] SendGrid key updated in Railway backend
- [ ] Git history cleaned with git-filter-repo
- [ ] Force push completed (`git push origin --force --all`)
- [ ] GitHub search verified clean
- [ ] Railway build logs checked for secrets
- [ ] Frontend bundle scanned for secrets
- [ ] GitHub Secret Scanning enabled
- [ ] Pre-commit hooks installed (optional)
- [ ] Gitleaks scan passed

---

## 🎯 Priority Order

**DO IN THIS ORDER:**
1. ⚡ **Rotate secrets NOW** (5 minutes) - Most critical!
2. 🧹 **Clean git history** (10 minutes)
3. 🔍 **Verify cleanup** (5 minutes)
4. 🛡️ **Add prevention** (15 minutes)
5. ✅ **Final audit** (10 minutes)

**Total time: ~45 minutes**

---

## ⚠️ IMPORTANT NOTES

1. **Old keys are compromised** - Anyone with repo access can see them
2. **Rotate ALL secrets** - Don't skip any
3. **Test after rotation** - Verify everything still works
4. **Monitor for abuse** - Check MongoDB/Google/SendGrid logs for unusual activity
5. **Never commit .env files** - Already in .gitignore, but history still has them

---

## 🆘 Emergency Contacts

If you notice unauthorized usage:
- **MongoDB:** Contact MongoDB Atlas support immediately
- **Google Cloud:** Disable compromised keys in Google Cloud Console
- **SendGrid:** Contact SendGrid support to disable old API key

---

**Start with Step 1 (Rotate Secrets) IMMEDIATELY! Everything else can wait, but exposed credentials are an active security risk.**
