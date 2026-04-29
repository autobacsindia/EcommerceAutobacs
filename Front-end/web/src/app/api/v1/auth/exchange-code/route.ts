/**
 * Proxy endpoint for OAuth code exchange
 * 
 * This endpoint properly forwards Set-Cookie headers from the backend
 * which Next.js rewrites sometimes strip.
 * 
 * Updated: 2026-04-29 - Adding cache-busting timestamp
 */
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    console.log('[API Proxy] Exchange-code request received');
    const body = await request.json();
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
    
    console.log('[API Proxy] Backend URL:', backendUrl);
    
    // Get CSRF token from request cookies
    const xsrfToken = request.cookies.get('XSRF-TOKEN')?.value;
    console.log('[API Proxy] XSRF Token:', xsrfToken ? 'present' : 'missing');
    
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

    console.log('[API Proxy] Backend response status:', response.status);
    
    const data = await response.json();
    console.log('[API Proxy] Backend response data:', data);

    // Create response
    const nextResponse = NextResponse.json(data, { status: response.status });

    // Forward ALL Set-Cookie headers from backend
    const setCookieHeaders = response.headers.getSetCookie?.() || [];
    console.log('[API Proxy] Set-Cookie headers from backend:', setCookieHeaders.length);
    console.log('[API Proxy] Set-Cookie values:', setCookieHeaders);
    
    setCookieHeaders.forEach((cookie: string) => {
      console.log('[API Proxy] Forwarding cookie:', cookie.substring(0, 50) + '...');
      nextResponse.headers.append('Set-Cookie', cookie);
    });

    console.log('[API Proxy] Sending response with', setCookieHeaders.length, 'cookies');
    return nextResponse;
  } catch (error) {
    console.error('[API Proxy] Exchange-code proxy failed:', error);
    return NextResponse.json(
      { success: false, message: 'Proxy failed' },
      { status: 500 }
    );
  }
}
