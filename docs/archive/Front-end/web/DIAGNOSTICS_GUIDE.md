# WordPress API and Backend Connectivity Issues - Diagnosis and Solutions

## Current Issues

### 1. WordPress API Network Error
The primary issue is that the WordPress API configuration in `.env.local` contains placeholder values:
```
NEXT_PUBLIC_WORDPRESS_SITE_URL=https://yourdomain.com
NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY=your_consumer_key
NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET=your_consumer_secret
```

These placeholder values cause Axios to attempt connections to invalid endpoints, resulting in "Network Error".

### 2. Backend API "Failed to fetch" Error
The location service is unable to connect to the backend API, likely because:
- The backend server is not running
- The API_BASE_URL is incorrectly configured
- Network connectivity issues between frontend and backend

## Solutions

### Solution 1: Fix WordPress API Configuration

1. **Update your `.env.local` file** with actual WordPress credentials:
   ```
   # WordPress API Configuration
   NEXT_PUBLIC_WORDPRESS_SITE_URL=https://your-real-wordpress-site.com
   NEXT_PUBLIC_WORDPRESS_API_VERSION=wc/v3
   NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY=ck_your_real_consumer_key
   NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET=cs_your_real_consumer_secret
   ```

2. **Get WordPress API credentials**:
   - Log in to your WordPress admin dashboard
   - Navigate to WooCommerce → Settings → Advanced → REST API
   - Click "Add Key"
   - Set permissions to "Read"
   - Copy the generated consumer key and consumer secret

### Solution 2: Fix Backend API Connectivity

1. **Ensure the backend server is running**:
   - Check if your Node.js/Express backend is started
   - Verify it's listening on the correct port (typically 5000)

2. **Verify API_BASE_URL configuration**:
   - Check that `NEXT_PUBLIC_API_BASE_URL` in `.env.local` points to the correct backend URL
   - Default is `http://localhost:5000` for local development

### Solution 3: Diagnostic Tools

We've created several diagnostic pages to help identify and resolve these issues:

1. **WordPress Diagnostics Page**: `/wordpress-diagnostics`
   - Shows current WordPress API configuration status
   - Identifies missing or invalid configuration values
   - Provides step-by-step instructions for fixing issues

2. **General System Diagnostics**: `/diagnostics`
   - Checks both WordPress API and backend API connectivity
   - Provides a comprehensive overview of system health

3. **WordPress API Test Page**: `/test-wordpress-api`
   - Tests actual API calls to WordPress endpoints
   - Shows real-time results of API requests

## Implementation Steps

1. **Stop all development servers**
2. **Update `.env.local` with real credentials**
3. **Start backend server** (if not already running)
4. **Start frontend development server**: `npm run dev`
5. **Visit diagnostic pages** to verify fixes:
   - http://localhost:3000/wordpress-diagnostics
   - http://localhost:3000/diagnostics
   - http://localhost:3000/test-wordpress-api

## Error Handling Improvements

The WordPress service has been updated with better error handling:
- Graceful degradation when API is not configured
- Detailed logging for debugging purposes
- User-friendly error messages
- Prevents app crashes when API calls fail

The location service includes:
- Enhanced error categorization
- Better timeout handling
- Improved network error detection
- Rate limiting protection

## Verification

After implementing the fixes, you should see:
- No more "Network Error" in the console
- Vehicle data loading correctly on the vehicles page
- Location services working properly
- All diagnostic pages showing green status indicators