// Simple test to verify API connection
export const testApiConnection = async () => {
  try {
    const token = localStorage.getItem('token');
    console.log('Token:', token);
    
    if (!token) {
      console.log('No token found in localStorage');
      return { success: false, message: 'No authentication token found' };
    }
    
    // Add timeout handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    const response = await fetch('http://localhost:5002/reviews/admin?page=1&limit=5', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    console.log('Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log('Error response:', errorText);
      return { success: false, message: `API Error: ${response.status} - ${errorText}` };
    }
    
    const data = await response.json();
    console.log('Success response:', data);
    return { success: true, data };
  } catch (error: any) {
    // Handle timeout specifically
    if (error.name === 'AbortError') {
      console.log('Request timeout exceeded');
      return { success: false, message: 'Request timeout exceeded. The server may be busy or unavailable.' };
    }
    
    console.log('Network error:', error);
    return { success: false, message: `Network Error: ${error}` };
  }
};