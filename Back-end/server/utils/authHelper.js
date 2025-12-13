import fetch from 'node-fetch';

const API_BASE_URL = 'http://localhost:5000';

/**
 * Authenticate as admin user and get JWT token
 * @returns {Promise<string>} JWT token
 */
export async function getAdminAuthToken() {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'admin@autobacs.com',
        password: 'Admin123!'
      })
    });

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(`Authentication failed: ${data.message}`);
    }
    
    console.log('✅ Admin authentication successful');
    return data.token;
  } catch (error) {
    throw new Error(`Failed to authenticate: ${error.message}`);
  }
}