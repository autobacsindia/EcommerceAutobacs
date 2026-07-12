# CRITICAL: Secrets Rotation Guide

## ⚠️ URGENT: Your secrets have been exposed in the codebase

The following secrets were found in `.env` files and MUST be rotated immediately:

### 1. MongoDB Credentials
- **Current**: `mongodb+srv://Autobacs_info_db:AutobacsInfodb2026@...`
- **Action**: 
  1. Go to MongoDB Atlas: https://cloud.mongodb.com/
  2. Navigate to Database Access
  3. Change password for user `Autobacs_info_db`
  4. Update `MONGO_URI` in Railway environment variables

### 2. MongoDB Atlas API Keys
- **Current**: `hibwcoaw` / `c7480c6f-08cd-40ac-a75f-5feda19b7450`
- **Action**:
  1. Go to MongoDB Atlas > Organization Settings > Access Manager > API Keys
  2. Delete existing API keys
  3. Create new API keys
  4. Update `MONGODB_ATLAS_PUBLIC_API_KEY` and `MONGODB_ATLAS_PRIVATE_API_KEY` in Railway

### 3. SendGrid API Key
- **Current**: `SG.sedo_hTUTLexJB0dhskL1g...`
- **Action**:
  1. Go to SendGrid: https://app.sendgrid.com/settings/api_keys
  2. Delete existing API key
  3. Create new API key
  4. Update `SENDGRID_API_KEY` in Railway

### 4. Google OAuth Client Secret
- **Current**: `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`
- **Action**:
  1. Go to Google Cloud Console > APIs & Services > Credentials
  2. Reset OAuth client secret
  3. Update `GOOGLE_CLIENT_SECRET` in Railway

### 5. Facebook App Secret
- **Current**: `0cc97796ff395712e1263bc3c2ea1fb5`
- **Action**:
  1. Go to Facebook Developers: https://developers.facebook.com/apps/
  2. Navigate to your app > Settings > Basic
  3. Reset App Secret
  4. Update `FACEBOOK_CLIENT_SECRET` in Railway

### 6. Cloudinary API Secret
- **Current**: `Yf-19DBPQx15YDmRdkPq3lnCGBc`
- **Action**:
  1. Go to Cloudinary: https://cloudinary.com/console
  2. Navigate to Settings > Security
  3. Regenerate API Secret
  4. Update `CLOUDINARY_API_SECRET` in Railway

### 7. JWT Secret
- **Current**: `ac165bfe5778e5f61ab6bab5ff3c5912...`
- **Action**:
  1. Generate new JWT secret: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
  2. Update `JWT_SECRET` in Railway
  3. **WARNING**: This will invalidate all existing user sessions. Users will need to log in again.

### 8. Razorpay Keys (CRITICAL FOR PRODUCTION)
- **Current**: Using TEST keys (`rzp_test_*`)
- **Action**:
  1. Go to Razorpay Dashboard: https://dashboard.razorpay.com/app/keys
  2. Switch to LIVE mode
  3. Copy LIVE Key ID and Secret
  4. Update `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in Railway
  5. **VERIFY**: Keys should start with `rzp_live_*`, NOT `rzp_test_*`

## Post-Rotation Steps

1. **Delete all `.env` files from git history** (if committed):
   ```bash
   git filter-branch --force --index-filter \
     'git rm --cached --ignore-unmatch Autobacs/Back-end/server/.env' \
     --prune-empty --tag-name-filter cat -- --all
   git push origin --force --all
   ```

2. **Verify Railway environment variables**:
   - Go to Railway Dashboard
   - Navigate to Backend service > Variables
   - Ensure all variables are set correctly
   - Remove any localhost references

3. **Test all integrations** after rotation:
   - MongoDB connection
   - Email sending (SendGrid)
   - Google Maps API
   - OAuth logins (Google, Facebook)
   - Image uploads (Cloudinary)
   - Payment processing (Razorpay LIVE mode)

4. **Monitor logs** for any authentication failures or integration errors

## Prevention

- **NEVER** commit `.env` files to any repository
- Use `.env.example` as template (no real secrets)
- Implement secret scanning in CI/CD pipeline
- Use Railway's environment variable dashboard for all secrets
- Rotate secrets every 90 days minimum
