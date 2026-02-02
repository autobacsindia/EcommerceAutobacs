import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:5002';

async function runPenetrationTests() {
  console.log('Starting Security Penetration Tests...');
  let vulnerabilitiesFound = 0;

  // Helper to log result
  const logResult = (testName, passed, details = '') => {
    if (passed) {
      console.log(`✅ [PASS] ${testName}`);
    } else {
      console.log(`❌ [FAIL] ${testName} - ${details}`);
      vulnerabilitiesFound++;
    }
  };

  try {
    // 1. NoSQL Injection Test on Login
    console.log('\n--- NoSQL Injection Tests ---');
    const nosqlPayload = {
      email: { "$ne": null },
      password: { "$ne": null }
    };
    
    // Note: fetch might stringify the object keys, but JSON.stringify handles nested objects correctly.
    // However, if the server expects a string for email, this payload tests if it crashes or handles type mismatch.
    // If the server uses the input directly in a query { email: req.body.email }, it might be vulnerable if body parsing allows objects.
    const nosqlRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nosqlPayload)
    });
    
    // We expect a 400 Bad Request (validation error) or 401 Unauthorized, NOT 200 OK
    const nosqlData = await nosqlRes.json();
    logResult('NoSQL Injection on Login', !nosqlData.token, 'Received token with injection payload');

    // 2. XSS Payload Test (Reflected)
    console.log('\n--- XSS Tests ---');
    const xssPayload = '<script>alert(1)</script>';
    const xssRes = await fetch(`${BASE_URL}/products?keyword=${encodeURIComponent(xssPayload)}`);
    // Just check if it didn't crash (500)
    logResult('XSS Payload in Search', xssRes.status !== 500, 'Server crashed (500)');

    // 3. Unauthenticated Access to Admin Routes
    console.log('\n--- Access Control Tests ---');
    const adminRes = await fetch(`${BASE_URL}/users`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    logResult('Unauthenticated Access to /users', adminRes.status === 401, `Got status ${adminRes.status}`);

    // 4. Rate Limiting Test
    console.log('\n--- Rate Limiting Tests ---');
    console.log('Sending 10 requests rapidly to /auth/login...');
    const requests = [];
    for (let i = 0; i < 10; i++) {
      requests.push(fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'fake@example.com', password: 'wrong' })
      }));
    }
    
    const responses = await Promise.all(requests);
    const tooManyRequests = responses.filter(r => r.status === 429).length;
    
    // Note: The limit might be higher (e.g. 5 per min). If we send 10, we expect at least some 429s if the limit is < 10.
    // server.js says auth limit is 5 req/min.
    logResult('Rate Limiting on Login', tooManyRequests > 0, `Got ${tooManyRequests} 429 responses (expected > 0)`);

    console.log(`\nTests Completed. Vulnerabilities potentially found: ${vulnerabilitiesFound}`);

  } catch (error) {
    console.error('Test execution failed:', error);
  }
}

runPenetrationTests();
