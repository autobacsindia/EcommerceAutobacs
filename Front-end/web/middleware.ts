import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose'; // Lightweight JWT verification (edge-compatible)

/**
 * Next.js Middleware - Protected Route Authentication
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
 * Protected Routes:
 * - /admin/* - Admin only (JWT verification + role check)
 * - /account/* - Authenticated users (JWT verification)
 * - /orders/* - Authenticated users (JWT verification)
 * - /checkout/* - Authenticated users (JWT verification)
 * 
 * Security:
 * - JWT signature verification using jose library
 * - Token expiry validation
 * - Role-based access control for admin routes
 * - Automatic token cleanup on expiry/invalid
 */

// JWT secret for token verification
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production';

// Define protected routes
const PROTECTED_ROUTES = [
  '/account',
  '/orders',
  '/checkout',
];

const ADMIN_ROUTES = [
  '/admin',
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  
  // UX: Redirect authenticated users away from /login
  if (pathname === '/login') {
    const accessToken = req.cookies.get('accessToken');
    if (accessToken?.value) {
      try {
        const secret = new TextEncoder().encode(JWT_SECRET);
        await jwtVerify(accessToken.value, secret);
        // User is authenticated → redirect to home or dashboard
        return NextResponse.redirect(new URL('/', req.url));
      } catch {
        // Token invalid → allow access to /login
      }
    }
  }
  
  // Check if route is protected
  const isProtectedRoute = PROTECTED_ROUTES.some(route => pathname.startsWith(route));
  const isAdminRoute = ADMIN_ROUTES.some(route => pathname.startsWith(route));
  
  // Not a protected route → allow
  if (!isProtectedRoute && !isAdminRoute) {
    return NextResponse.next();
  }
  
  // Get access token from httpOnly cookie
  const accessToken = req.cookies.get('accessToken');
  
  // No token → redirect to login with return URL
  if (!accessToken || !accessToken.value) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }
  
  try {
    // CRITICAL: Verify JWT signature with issuer/audience checks
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(accessToken.value, secret, {
      issuer: process.env.JWT_ISSUER || 'autobacs-ecommerce',
      audience: process.env.JWT_AUDIENCE || 'autobacs-users',
    });
    
    // Admin routes: Defensive role check (handles missing role)
    if (isAdminRoute) {
      if (!payload || payload.role !== 'admin') {
        console.warn(
          `[Middleware] Non-admin access attempt to ${pathname} | User: ${payload?.sub || 'unknown'}`
        );
        return NextResponse.redirect(new URL('/', req.url));
      }
    }
    
    // Valid token → allow request to proceed
    return NextResponse.next();
    
  } catch (error) {
    // Invalid/expired token → redirect to login with return URL
    console.error(
      `[Middleware] Invalid token for ${pathname} | Error: ${error instanceof Error ? error.message : 'Unknown'}`
    );
    
    // Clear invalid cookies and redirect with return URL
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('redirect', pathname);
    
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete('accessToken');
    response.cookies.delete('refreshToken');
    return response;
  }
}

// Apply middleware to protected routes
export const config = {
  matcher: [
    '/account/:path*',
    '/orders/:path*',
    '/checkout/:path*',
    '/admin/:path*',
  ],
};
