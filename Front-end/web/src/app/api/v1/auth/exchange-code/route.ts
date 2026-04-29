/**
 * Proxy endpoint for OAuth code exchange
 * 
 * This endpoint properly forwards Set-Cookie headers from the backend
 * which Next.js rewrites sometimes strip.
 */
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
    
    // Get CSRF token from request cookies
    const xsrfToken = request.cookies.get('XSRF-TOKEN')?.value;
    
    // Forward the request to the backend
    const response = await fetch(`${backendUrl}/api/v1/auth/exchange-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward the CSRF token
        ...(xsrfToken && { 'X-XSRF-TOKEN': xsrfToken }),
        // Forward the session cookie if present
        Cookie: request.headers.get('cookie') || '',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    // Create response
    const nextResponse = NextResponse.json(data, { status: response.status });

    // Forward ALL Set-Cookie headers from backend
    const setCookieHeaders = response.headers.getSetCookie?.() || [];
    setCookieHeaders.forEach((cookie: string) => {
      nextResponse.headers.append('Set-Cookie', cookie);
    });

    return nextResponse;
  } catch (error) {
    console.error('[API Proxy] Exchange-code proxy failed:', error);
    return NextResponse.json(
      { success: false, message: 'Proxy failed' },
      { status: 500 }
    );
  }
}
