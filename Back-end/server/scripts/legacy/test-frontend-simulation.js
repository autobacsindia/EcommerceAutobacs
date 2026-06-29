
const fetch = globalThis.fetch;

async function testFrontendSimulation() {
  const url = 'http://localhost:5000/location/select';
  const sessionId = `session_${Date.now()}_test`;
  
  const payload = {
    coordinates: {
      latitude: 12.9716, // Bangalore coordinates
      longitude: 77.5946
    }
  };

  console.log(`Sending request to ${url}...`);
  console.log('Payload:', JSON.stringify(payload));
  console.log('Session ID:', sessionId);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': sessionId,
        'Origin': 'http://localhost:3000' // Simulate frontend origin
      },
      body: JSON.stringify(payload)
    });

    console.log('Response Status:', response.status);
    console.log('Response Headers:', JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2));

    const data = await response.json();
    console.log('Response Body:', JSON.stringify(data, null, 2));

    if (response.ok) {
      console.log('SUCCESS: Location selected successfully.');
    } else {
      console.error('FAILURE: Request failed.');
    }

  } catch (error) {
    console.error('ERROR:', error);
  }
}

testFrontendSimulation();
