import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const API_URL = 'http://127.0.0.1:5000';
const ADMIN_EMAIL = 'admin@autobacs.com';
const ADMIN_PASSWORD = 'admin123';

async function runImport() {
  console.log('--- Starting Product Import Process ---');

  // 1. Login
  console.log('1. Logging in...');
  let token;
  try {
    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    });

    const loginData = await loginRes.json();
    if (!loginRes.ok) {
      console.error('Login failed:', loginData);
      process.exit(1);
    }
    token = loginData.accessToken;
    console.log('Login successful.');
  } catch (error) {
    console.error('Login error:', error.message);
    process.exit(1);
  }

  // 2. Check Missing Products
  console.log('\n2. Checking for missing products...');
  try {
    const missingRes = await fetch(`${API_URL}/products/import/wordpress/missing`, {
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const missingData = await missingRes.json();
    if (!missingRes.ok) {
      console.error('Check failed:', missingData);
      process.exit(1);
    }

    console.log('Missing Products Summary:', missingData.summary);

    if (missingData.summary.missingCount === 0) {
      console.log('No missing products found. All WordPress products are already imported.');
      // We can still choose to run import to update existing ones, but user specifically said "importing for products that are not imported"
      // However, usually import means sync. Let's ask or just finish? 
      // User said "do importing for products that are not imported". If none are missing, we are done.
      // But maybe they want to ensure everything is up to date?
      // I'll skip if 0 missing to be efficient, but mention it.
      console.log('Skipping import process.');
      return;
    }

    console.log(`Found ${missingData.summary.missingCount} missing products. Initiating import...`);

  } catch (error) {
    console.error('Check error:', error.message);
    process.exit(1);
  }

  // 3. Trigger Import
  console.log('\n3. Triggering Import (this may take a while)...');
  try {
    // Set a long timeout for this request
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      console.log('Request timed out, but import might still be running on server.');
      controller.abort();
    }, 300000); // 5 minutes

    const importRes = await fetch(`${API_URL}/products/import/wordpress`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeout);

    const importData = await importRes.json();
    if (!importRes.ok) {
      console.error('Import failed:', importData);
      process.exit(1);
    }

    console.log('Import Completed Successfully!');
    console.log('Job ID:', importData.jobId);
    console.log('Summary:', importData.summary);

  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('Import request timed out (client-side). Check server logs for progress.');
    } else {
      console.error('Import error:', error.message);
    }
    process.exit(1);
  }
}

runImport();
