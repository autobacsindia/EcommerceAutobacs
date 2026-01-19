import fetch from 'node-fetch';

const API_URL = 'http://localhost:5000';
const ADMIN_EMAIL = 'admin@autobacs.com';
const ADMIN_PASSWORD = 'Admin123!'; // You might need to adjust this

async function testSSE() {
  try {
    // 1. Login as admin to get token
    console.log('Logging in...');
    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    });

    const loginData = await loginRes.json();
    
    if (!loginData.success) {
      console.error('Login failed:', loginData);
      // Try to register admin if login fails (just in case)
      // Or maybe we can't easily register admin via public API
      return;
    }

    console.log('Login response:', JSON.stringify(loginData, null, 2));
    const token = loginData.accessToken;
    console.log('Login successful. Token:', token ? 'Found' : 'Missing');

    // 2. Connect to SSE stream
    console.log('Connecting to SSE stream...');
    const streamUrl = `${API_URL}/dashboard/stream`;
    
    // Node's EventSource doesn't support headers easily, so we use fetch like the frontend
    const response = await fetch(streamUrl, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'text/event-stream'
        }
    });

    console.log(`Response status: ${response.status}`);
    
    if (!response.ok) {
        console.error('Failed to connect:', response.statusText);
        const text = await response.text();
        console.error('Response body:', text);
        return;
    }

    // Read stream
    console.log('Connected! Reading stream...');
    response.body.on('data', (chunk) => {
        const text = chunk.toString();
        console.log('Received chunk:', text);
        // Just read a few chunks and exit
        if (text.includes('analytics')) {
            console.log('Received analytics data. Test passed.');
            process.exit(0);
        }
    });

    // Timeout after 10 seconds
    setTimeout(() => {
        console.log('Timeout reached.');
        process.exit(0);
    }, 10000);

  } catch (error) {
    console.error('Error:', error);
  }
}

testSSE();
