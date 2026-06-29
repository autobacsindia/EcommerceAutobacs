import axios from 'axios';

/**
 * Test script to verify location endpoint is working
 * Run with: node test-location-endpoint.js
 */

const API_BASE = 'http://localhost:5000';

async function testLocationEndpoint() {
  console.log('\n=== Testing Location Endpoint ===\n');

  // Test data - exactly what frontend should send
  const testData = {
    address: {
      city: 'Mumbai',
      state: 'Maharashtra',
      postalCode: '400001',
      country: 'India'
    }
  };

  console.log('Sending request to:', `${API_BASE}/location/select`);
  console.log('Request body:', JSON.stringify(testData, null, 2));
  console.log('\n---\n');

  try {
    const response = await axios.post(`${API_BASE}/location/select`, testData, {
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': 'test-session-' + Date.now()
      }
    });

    console.log('Response status:', response.status);
    console.log('\nResponse body:', JSON.stringify(response.data, null, 2));

    if (response.status === 200) {
      console.log('\n✅ SUCCESS! Location endpoint is working correctly.');
      console.log('Location saved:', response.data.location?.selectedAddress?.formatted);
    }

  } catch (error) {
    if (error.response) {
      console.error('\n❌ ERROR! Backend returned an error.');
      console.error('Status:', error.response.status);
      console.error('Error message:', error.response.data?.message);
      console.error('Full response:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('\n❌ NETWORK ERROR! Could not reach backend.');
      console.error('Error:', error.message);
      console.error('\nMake sure:');
      console.error('1. Backend server is running (npm start)');
      console.error('2. Server is on port 5000');
      console.error('3. Delivery zones are seeded');
    } else {
      console.error('\n❌ ERROR:', error.message);
    }
  }

  console.log('\n=== Test Complete ===\n');
}

// Run the test
testLocationEndpoint();
