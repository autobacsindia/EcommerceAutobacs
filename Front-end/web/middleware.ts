import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js Middleware - Admin Route Protection
 * 
 * This middleware runs BEFORE any page rendering occurs,
 * blocking unauthorized access at the edge.
 * 
 * Protection Layers:
 * 1. Middleware (this file) - Early blocking, prevents HTML rendering
 * 2. Server Components - Additional check before HTML sent
 * 3. Backend API - REAL security (RBAC enforcement)
 * 4. Client redirect - UX fallback (now redundant)
 * 
 * WARNING: This middleware does NOT verify JWT signature.
 * It only checks the token exists and decodes the payload.
 * A forged token could bypass this check.
 * 
 * REAL security is enforced by backend admin middleware.
 * This is an additional guard for UX/performance.
 */

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  
  // Only protect admin routes
  if (!pathname.startsWith('/admin')) {
    return NextResponse.next();
  }
  
  // Get access token from httpOnly cookie
  const accessToken = req.cookies.get('accessToken');
  
  // No token → block immediately (not logged in)
  if (!accessToken || !accessToken.value) {
    // Redirect to login with return URL
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }
  
  try {
    // Decode JWT payload (DOES NOT verify signature)
    // Format: header.payload.signature
    const parts = accessToken.value.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }
    
    // Decode payload (base64url)
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64').toString()
    );
    
    // Check token expiration (exp is in seconds, Date.now() is in ms)
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      console.warn(`[Middleware] Expired token for ${pathname}`);
      const response = NextResponse.redirect(new URL('/login', req.url));
      response.cookies.delete('accessToken');
      response.cookies.delete('refreshToken');
      return response;
    }
    
    // Check if user has admin role
    if (payload.role !== 'admin') {
      // Not an admin → redirect to homepage
      console.warn(
        `[Middleware] Non-admin access attempt to ${pathname} | User: ${payload.id}`
      );
      return NextResponse.redirect(new URL('/', req.url));
    }
    
    // Admin token → allow request to proceed
    return NextResponse.next();
    
  } catch (error) {
    // Invalid token → block access
    console.error(
      `[Middleware] Invalid admin token for ${pathname} | Error: ${error instanceof Error ? error.message : 'Unknown'}`
    );
    
    // Clear invalid cookie and redirect to login
    const response = NextResponse.redirect(new URL('/login', req.url));
    response.cookies.delete('accessToken');
    response.cookies.delete('refreshToken');
    return response;
  }
}

// Apply middleware only to admin routes
export const config = {
  matcher: [
    '/admin/:path*',  // All admin routes
  ],
};
