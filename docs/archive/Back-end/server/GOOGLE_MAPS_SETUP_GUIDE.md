# Google Maps API Setup Guide

## Overview
This guide provides step-by-step instructions for setting up Google Maps Platform APIs for the Autobacs application. Follow these steps carefully to enable location-based features including store locator, delivery zone mapping, and distance calculations.

## Prerequisites
- Google account (Gmail)
- Credit/debit card for billing verification (charges only after exceeding $200 free monthly credit)
- Access to Autobacs backend server environment configuration

## Estimated Time
- Initial setup: 15-20 minutes
- Testing and verification: 10-15 minutes
- Total: 30-35 minutes

---

## Part 1: Google Cloud Platform Setup

### Step 1: Create Google Cloud Project

1. **Navigate to Google Cloud Console**
   - Open your browser and go to: https://console.cloud.google.com
   - Sign in with your Google account

2. **Create New Project**
   - Click on the project dropdown at the top of the page (next to "Google Cloud Platform")
   - Click "NEW PROJECT"
   - Enter project details:
     - **Project name**: `Autobacs-Location-Services` (or your preferred name)
     - **Organization**: Leave as default (optional)
     - **Location**: Leave as default
   - Click "CREATE"
   - Wait for project creation (10-30 seconds)

3. **Select Your Project**
   - Once created, click on the project dropdown again
   - Select your newly created project: `Autobacs-Location-Services`
   - Verify the project name appears in the top navigation bar

4. **Note Your Project ID**
   - The Project ID will be visible in the project selector
   - It will be similar to: `autobacs-location-services-123456`
   - **IMPORTANT**: Save this Project ID for future reference

---

### Step 2: Enable Billing

1. **Navigate to Billing**
   - In the left sidebar, click "Billing"
   - Or go to: https://console.cloud.google.com/billing

2. **Link Billing Account**
   - If you have an existing billing account:
     - Click "LINK A BILLING ACCOUNT"
     - Select your existing billing account
     - Click "SET ACCOUNT"
   
   - If you need to create a new billing account:
     - Click "CREATE ACCOUNT"
     - Select "Business" or "Individual" account type
     - Enter your billing information:
       - Country
       - Payment method (Credit/Debit card)
       - Billing address
     - Accept the terms of service
     - Click "SUBMIT AND ENABLE BILLING"

3. **Verify Billing Status**
   - Ensure the project shows as "Billing Enabled"
   - You should see: "This project is linked to billing account: [Account Name]"

4. **Set Budget Alerts (Recommended)**
   - Click "Budgets & alerts" in the billing menu
   - Click "CREATE BUDGET"
   - Configure budget:
     - **Name**: `Autobacs Google Maps Monthly Budget`
     - **Budget amount**: $50 (or your preferred limit)
     - **Alert thresholds**: 50%, 75%, 90%
   - Click "FINISH"

**Note**: Google provides $200 monthly credit for Maps Platform. You will only be charged if usage exceeds this amount.

---

## Part 2: Enable Required APIs

### Step 3: Enable Geocoding API

1. **Navigate to API Library**
   - In the left sidebar, click "APIs & Services" → "Library"
   - Or go to: https://console.cloud.google.com/apis/library

2. **Search for Geocoding API**
   - In the search bar, type: `Geocoding API`
   - Click on "Geocoding API" from the results

3. **Enable the API**
   - Click the blue "ENABLE" button
   - Wait for the API to be enabled (5-10 seconds)
   - You should see "API enabled" confirmation

---

### Step 4: Enable Places API

1. **Return to API Library**
   - Click "APIs & Services" → "Library" again
   - Or use the browser back button

2. **Search for Places API**
   - In the search bar, type: `Places API`
   - Click on "Places API" from the results

3. **Enable the API**
   - Click the blue "ENABLE" button
   - Wait for confirmation

---

### Step 5: Enable Maps JavaScript API

1. **Return to API Library**
   - Click "APIs & Services" → "Library" again

2. **Search for Maps JavaScript API**
   - In the search bar, type: `Maps JavaScript API`
   - Click on "Maps JavaScript API" from the results

3. **Enable the API**
   - Click the blue "ENABLE" button
   - Wait for confirmation

4. **Verify All APIs Are Enabled**
   - Click "APIs & Services" → "Enabled APIs & services"
   - You should see all three APIs listed:
     - ✓ Geocoding API
     - ✓ Places API
     - ✓ Maps JavaScript API

---

## Part 3: Create API Keys

### Step 6: Create Server-Side API Key

1. **Navigate to Credentials**
   - Click "APIs & Services" → "Credentials"
   - Or go to: https://console.cloud.google.com/apis/credentials

2. **Create New API Key**
   - Click "CREATE CREDENTIALS" at the top
   - Select "API key"
   - A dialog will appear showing your new API key
   - **IMPORTANT**: Copy this key immediately and save it securely
   - Example format: `AIzaSyABC123DEF456GHI789JKL012MNO345PQR`

3. **Restrict the Server Key**
   - Click "RESTRICT KEY" in the dialog (or click "CLOSE" and then click on the key to edit it)
   - Update the key name:
     - **Name**: `Autobacs-Backend-Server-Key`

4. **Configure Application Restrictions**
   - Under "Application restrictions"
   - Select "IP addresses"
   - Click "ADD AN ITEM"
   - Enter your server IP addresses:
     - For local development: `127.0.0.1` or your machine's public IP
     - For production: Your production server's public IP address
     - You can add multiple IPs
   - Click "DONE"

5. **Configure API Restrictions**
   - Under "API restrictions"
   - Select "Restrict key"
   - Click "Select APIs" dropdown
   - Check the boxes for:
     - ✓ Geocoding API
     - ✓ Places API
   - Leave other APIs unchecked

6. **Save the Key**
   - Click "SAVE" at the bottom
   - **IMPORTANT**: Copy and save this API key securely
   - Label it as: "Server-Side Key"

---

### Step 7: Create Client-Side API Key

1. **Create Another API Key**
   - Click "CREATE CREDENTIALS" again
   - Select "API key"
   - Copy the generated key

2. **Restrict the Client Key**
   - Click "RESTRICT KEY"
   - Update the key name:
     - **Name**: `Autobacs-Frontend-Client-Key`

3. **Configure Application Restrictions**
   - Under "Application restrictions"
   - Select "HTTP referrers (web sites)"
   - Click "ADD AN ITEM"
   - Add allowed referrers:
     - Development: `http://localhost:3000/*`
     - Development: `http://localhost:*`
     - Production: `https://yourdomain.com/*`
     - Production: `https://www.yourdomain.com/*`
   - Replace `yourdomain.com` with your actual domain
   - Click "DONE"

4. **Configure API Restrictions**
   - Under "API restrictions"
   - Select "Restrict key"
   - Check the boxes for:
     - ✓ Maps JavaScript API
     - ✓ Places API
   - Leave other APIs unchecked

5. **Save the Key**
   - Click "SAVE"
   - **IMPORTANT**: Copy and save this API key securely
   - Label it as: "Client-Side Key"

**Summary**: You should now have TWO API keys:
- **Server-Side Key**: Restricted by IP addresses, for Geocoding & Places APIs
- **Client-Side Key**: Restricted by HTTP referrers, for Maps JavaScript & Places APIs

---

## Part 4: Configure Autobacs Application

### Step 8: Update Environment Variables

1. **Locate the .env File**
   - Navigate to: `Autobacs/Back-end/server/.env`
   - Open this file in a text editor

2. **Find Google Maps Configuration Section**
   - Look for lines starting with `GOOGLE_MAPS_`
   - You should see:
     ```env
     GOOGLE_MAPS_CLIENT_KEY=your_client_key_here
     GOOGLE_MAPS_SERVER_KEY=your_server_key_here
     ```

3. **Update API Keys**
   - Replace `your_server_key_here` with your **Server-Side Key**
   - Replace `your_client_key_here` with your **Client-Side Key**
   
   Example:
   ```env
   GOOGLE_MAPS_SERVER_KEY=AIzaSyABC123DEF456GHI789JKL012MNO345PQR
   GOOGLE_MAPS_CLIENT_KEY=AIzaSyXYZ789DEF012GHI345JKL678MNO901PQR
   ```

4. **Verify Other Settings**
   - Ensure these settings are present (should already be configured):
   ```env
   GOOGLE_MAPS_REGION=IN
   GOOGLE_MAPS_LANGUAGE=en
   ```

5. **Save the File**
   - **CRITICAL**: Do NOT commit this file to version control
   - Verify `.env` is listed in your `.gitignore` file

---

### Step 9: Restart Application

1. **Stop Running Server**
   - If your backend server is currently running, stop it:
     - Press `Ctrl+C` in the terminal where it's running
     - Or close the terminal window

2. **Restart Backend Server**
   - Open a new terminal/command prompt
   - Navigate to: `Autobacs/Back-end/server`
   - Run:
     ```bash
     npm run dev
     ```

3. **Verify Configuration**
   - Check the terminal output for any errors related to Google Maps
   - If configured correctly, you should NOT see any warnings about missing API keys
   - The server should start successfully on port 5000

---

## Part 5: Testing & Verification

### Step 10: Test API Integration

1. **Run the Verification Script**
   - In a new terminal, navigate to: `Autobacs/Back-end/server`
   - Run the test script:
     ```bash
     node test-google-maps-integration.js
     ```

2. **Expected Output**
   - The script will test three scenarios:
     - ✓ Geocoding an address
     - ✓ Reverse geocoding coordinates
     - ✓ PIN code-based location selection
   
   - You should see output like:
     ```
     Testing Google Maps Integration...
     ✓ Geocoding test passed
     ✓ Reverse geocoding test passed
     ✓ Location selection test passed
     All tests passed successfully!
     ```

3. **If Tests Fail**
   - Check error messages carefully
   - Common issues:
     - "REQUEST_DENIED": API not enabled or key restrictions incorrect
     - "INVALID_REQUEST": API key format incorrect
     - "Location services not configured": API key missing in .env
   - Refer to the Troubleshooting section below

---

### Step 11: Test Features in Application

1. **Test Location Selection**
   - Start your frontend application
   - Navigate to the location selection feature
   - Try selecting a location using:
     - Manual PIN code entry (e.g., 400001 for Mumbai)
     - GPS/Current location (if implemented)
   - Verify the location is saved correctly

2. **Test Warehouse Distance Calculation**
   - View products in the application
   - Check if warehouse availability shows distance information
   - Verify delivery estimates are calculated

3. **Test Delivery Zone Assignment**
   - Enter different PIN codes
   - Verify correct delivery zones are assigned
   - Check delivery time estimates

---

## Part 6: Monitoring & Maintenance

### Step 12: Set Up Monitoring

1. **Monitor API Usage**
   - Go to: https://console.cloud.google.com/apis/dashboard
   - Select your project
   - Click on "Geocoding API", "Places API", "Maps JavaScript API"
   - Review usage graphs to monitor requests

2. **Check Billing**
   - Go to: https://console.cloud.google.com/billing
   - Click "Reports"
   - Filter by "Maps" services
   - Monitor daily/monthly costs
   - Verify usage stays within free tier ($200/month credit)

3. **Review Budget Alerts**
   - Check your email for budget alert notifications
   - Take action if approaching budget limits

---

## Troubleshooting

### Common Errors and Solutions

#### Error: "Location services not configured"
- **Cause**: API key missing or invalid in .env file
- **Solution**:
  1. Verify GOOGLE_MAPS_SERVER_KEY is set in .env
  2. Check for typos in the API key
  3. Restart the server after updating .env
  4. Verify API key is not wrapped in quotes

#### Error: "REQUEST_DENIED"
- **Cause**: API not enabled or key restrictions blocking access
- **Solution**:
  1. Verify all three APIs are enabled in GCP Console
  2. Check IP address restrictions allow your server IP
  3. For server key, ensure IP matches your current IP
  4. Remove restrictions temporarily to test if that's the issue

#### Error: "OVER_QUERY_LIMIT"
- **Cause**: Daily quota exceeded or billing not enabled
- **Solution**:
  1. Verify billing is enabled for the project
  2. Check quota limits in GCP Console
  3. Wait for quota reset (daily at midnight Pacific Time)
  4. Consider increasing quotas if needed

#### Error: "INVALID_REQUEST"
- **Cause**: Malformed API request or invalid parameters
- **Solution**:
  1. Check the test script output for specific error details
  2. Verify the API key format is correct (starts with "AIza")
  3. Ensure no extra spaces or characters in .env file

#### Error: "Unable to determine PIN code from location"
- **Cause**: Location doesn't have postal code in Google's database
- **Solution**:
  - This is expected behavior
  - User should enter PIN code manually
  - Verify the fallback mechanism is working

### Getting Help

1. **Check Application Logs**
   - Review server logs for detailed error messages
   - Look for Google Maps API error codes

2. **Test API Key Directly**
   - Use the verification script: `node verify-google-maps-config.js`
   - This will show detailed connection information

3. **Google Maps Platform Support**
   - Documentation: https://developers.google.com/maps/documentation
   - Support: https://developers.google.com/maps/support
   - Stack Overflow: Tag questions with `google-maps-api`

---

## Security Best Practices

### Protecting Your API Keys

1. **Never Commit Keys to Git**
   - Always use .env file for keys
   - Verify .env is in .gitignore
   - Never share keys in code repositories

2. **Use Proper Restrictions**
   - Server keys: Always restrict by IP address
   - Client keys: Always restrict by HTTP referrer
   - Limit APIs to only those needed

3. **Regular Key Rotation**
   - Rotate keys every 90 days
   - Create new keys before disabling old ones
   - Update .env and restart servers

4. **Monitor for Abuse**
   - Set up budget alerts
   - Review usage regularly
   - Investigate unexpected spikes
   - Disable compromised keys immediately

---

## Cost Optimization Tips

1. **Leverage Caching**
   - The application caches geocoding results for 30 days
   - This reduces API calls by ~90%

2. **Use PIN Code Entry**
   - Encourage users to enter PIN codes directly
   - Bypasses geocoding API calls

3. **Monitor Usage Patterns**
   - Review which endpoints use most API calls
   - Optimize high-volume operations

4. **Set Quotas**
   - Set daily quotas to prevent runaway costs
   - Configure alerts before hitting limits

---

## Next Steps

After completing this setup:

1. ✓ Google Maps APIs are fully configured
2. ✓ Location services are operational
3. ✓ Store locator feature is enabled
4. ✓ Delivery zone mapping is active
5. ✓ Distance calculations are working

### Future Enhancements

Consider implementing:
- Address autocomplete in frontend
- Interactive store locator map
- Delivery zone visualization
- Real-time traffic-based estimates

---

## Summary Checklist

Use this checklist to verify all steps are completed:

- [ ] Created Google Cloud Platform project
- [ ] Enabled billing for the project
- [ ] Enabled Geocoding API
- [ ] Enabled Places API
- [ ] Enabled Maps JavaScript API
- [ ] Created server-side API key with IP restrictions
- [ ] Created client-side API key with referrer restrictions
- [ ] Updated .env file with both API keys
- [ ] Restarted backend server
- [ ] Ran verification tests successfully
- [ ] Tested location features in application
- [ ] Set up budget alerts
- [ ] Configured monitoring

If all items are checked, your Google Maps integration is complete!

---

## Support & Documentation

- **Application Documentation**: See `LOCATION_SERVICE_API_DOCS.md`
- **API Testing Guide**: See `API_TESTING.md`
- **Google Maps Pricing**: https://cloud.google.com/maps-platform/pricing
- **API Documentation**: https://developers.google.com/maps

For technical support with the Autobacs application, contact your development team.
