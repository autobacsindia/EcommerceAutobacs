import axios from 'axios';

// Base URL for our API
const BASE_URL = 'http://localhost:5002';

// Test user credentials
const TEST_USER = {
  name: 'Test User',
  email: `test${Date.now()}@example.com`, // Use unique email each time
  password: 'password123'
};

let authToken = '';
let wishlistId = '';

async function testWishlistAPI() {
  try {
    console.log('Testing Wishlist API...\n');

    // 1. Register a new test user
    console.log('1. Registering test user...');
    try {
      const registerResponse = await axios.post(`${BASE_URL}/auth/register`, {
        name: TEST_USER.name,
        email: TEST_USER.email,
        password: TEST_USER.password
      });
      console.log('User registered successfully\n');
    } catch (registerError) {
      if (registerError.response && registerError.response.data.message === 'user already exists') {
        console.log('User already exists, continuing with login...\n');
      } else {
        throw registerError;
      }
    }

    // 2. Login to get auth token
    console.log('2. Logging in...');
    const loginResponse = await axios.post(`${BASE_URL}/auth/login`, {
      email: TEST_USER.email,
      password: TEST_USER.password
    });
    
    authToken = loginResponse.data.token;
    console.log('Login successful, token received\n');

    // Generate a unique wishlist name
    const uniqueName = `Test Wishlist ${Date.now()}`;

    // 3. Create a new wishlist
    console.log('3. Creating a new wishlist...');
    const createResponse = await axios.post(`${BASE_URL}/wishlist`, 
      {
        name: uniqueName,
        description: 'A test wishlist for verification',
        privacy: 'private'
      },
      {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      }
    );
    
    wishlistId = createResponse.data.wishlist._id;
    console.log('Wishlist created:', createResponse.data.wishlist.name, '\n');

    // 4. Get all wishlists
    console.log('4. Getting all wishlists...');
    const getAllResponse = await axios.get(`${BASE_URL}/wishlist`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    console.log(`Found ${getAllResponse.data.count} wishlist(s)\n`);

    // 5. Get specific wishlist
    console.log('5. Getting specific wishlist...');
    const getOneResponse = await axios.get(`${BASE_URL}/wishlist/${wishlistId}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    console.log('Wishlist details:', getOneResponse.data.wishlist.name, '\n');

    // 6. Update wishlist
    console.log('6. Updating wishlist...');
    const updateResponse = await axios.put(`${BASE_URL}/wishlist/${wishlistId}`,
      {
        name: `Updated ${uniqueName}`,
        description: 'Updated description'
      },
      {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      }
    );
    console.log('Wishlist updated:', updateResponse.data.wishlist.name, '\n');

    // 7. Export wishlist
    console.log('7. Exporting wishlist...');
    const exportResponse = await axios.get(`${BASE_URL}/wishlist/${wishlistId}/export`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    console.log('Wishlist exported successfully\n');

    // 8. Delete wishlist
    console.log('8. Deleting wishlist...');
    const deleteResponse = await axios.delete(`${BASE_URL}/wishlist/${wishlistId}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    console.log('Wishlist deleted:', deleteResponse.data.message, '\n');

    console.log('All tests completed successfully!');
  } catch (error) {
    console.error('Test failed:', error.response ? error.response.data : error.message);
  }
}

// Run the test
testWishlistAPI();