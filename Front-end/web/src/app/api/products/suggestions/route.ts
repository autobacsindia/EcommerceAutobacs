import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const limit = searchParams.get('limit') || '10';
  
  try {
    // Get the backend API URL from environment variables
    const backendUrl = process.env.BACKEND_API_URL || 'http://localhost:5000';
    
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    // Forward the request to the backend with timeout
    const response = await fetch(`${backendUrl}/products/suggestions?q=${encodeURIComponent(query || '')}&limit=${limit}`, {
      signal: controller.signal
    });
    
    // Clear timeout
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error('Failed to fetch suggestions from backend');
    }
    
    const data = await response.json();
    
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error fetching suggestions:', error);
    
    // Handle timeout specifically
    if (error.name === 'AbortError') {
      return NextResponse.json({
        success: false,
        message: 'Request timeout exceeded. The server may be busy or unavailable.'
      }, { status: 408 });
    }
    
    return NextResponse.json({
      success: false,
      message: 'Failed to fetch suggestions'
    }, { status: 500 });
  }
}