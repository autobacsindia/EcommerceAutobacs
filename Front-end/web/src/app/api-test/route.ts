import { NextResponse } from 'next/server';

// Test API connectivity
export async function GET() {
  try {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000';
    
    // Test basic connectivity
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new DOMException('API test request timeout exceeded', 'TimeoutError')), 30000); // 30 second timeout
    
    const response = await fetch(`${API_BASE_URL}/products?limit=1`, {
      signal: controller.signal,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      return NextResponse.json({
        success: false,
        error: `API responded with status ${response.status}: ${response.statusText}`,
        url: `${API_BASE_URL}/products?limit=1`
      }, { status: 500 });
    }
    
    const data = await response.json();
    
    return NextResponse.json({
      success: true,
      message: 'API connectivity test successful',
      productCount: data.products?.length || 0,
      apiUrl: API_BASE_URL
    });
    
  } catch (error: any) {
    console.error('API Test Error:', {
      message: error.message,
      name: error.name,
      stack: error.stack
    });
    
    let errorMessage = 'Unknown error';
    if (error.name === 'AbortError') {
      errorMessage = 'Request timeout - server not responding';
    } else if (error instanceof TypeError) {
      errorMessage = `Network error: ${error.message}`;
    } else {
      errorMessage = error.message || error.toString();
    }
    
    return NextResponse.json({
      success: false,
      error: errorMessage,
      errorType: error.name,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}