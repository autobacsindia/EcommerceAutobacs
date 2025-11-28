// Simple test to verify API connection
export const testApiConnection = async () => {
  try {
    const token = localStorage.getItem('token');
    console.log('Token:', token);
    
    if (!token) {
      console.log('No token found in localStorage');
      return { success: false, message: 'No authentication token found' };
    }
    
    const response = await fetch('http://localhost:5002/reviews/admin?page=1&limit=5', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log('Error response:', errorText);
      return { success: false, message: `API Error: ${response.status} - ${errorText}` };
    }
    
    const data = await response.json();
    console.log('Success response:', data);
    return { success: true, data };
  } catch (error) {
    console.log('Network error:', error);
    return { success: false, message: `Network Error: ${error}` };
  }
};