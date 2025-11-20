import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const limit = searchParams.get('limit') || '10';
  
  try {
    // Get the backend API URL from environment variables
    const backendUrl = process.env.BACKEND_API_URL || 'http://localhost:5000';
    
    // Forward the request to the backend
    const response = await fetch(`${backendUrl}/products/suggestions?q=${encodeURIComponent(query || '')}&limit=${limit}`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch suggestions from backend');
    }
    
    const data = await response.json();
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching suggestions:', error);
    return NextResponse.json({
      success: false,
      message: 'Failed to fetch suggestions'
    }, { status: 500 });
  }
}