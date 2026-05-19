import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose'; // Lightweight JWT verification (edge-compatible)

/**
 * Next.js Middleware - Protected Route Authentication
 *
 * Protection Layers:
 * 1. Middleware (this file) - Early blocking, prevents HTML rendering
 * 2. Server Components - Additional check before HTML sent
 * 3. Backend API - REAL security (RBAC enforcement)
 * 4. Client redirect - UX fallback (now redundant)
 *
 * Protected Routes:
 * - /admin/*    - Admin only (JWT verification + role check)
 * - /account/*  - Authenticated users (JWT verification)
 * - /orders/*   - Authenticated users (JWT verification)
 * - /checkout/* - Authenticated users (JWT verification)
 *
 * Token refresh:
 * When the access token is expired, middleware attempts a silent refresh via
 * POST /api/v1/auth/refresh before redirecting to login. This prevents forcing
 * users to re-authenticate every 30 minutes while they are actively browsing.
 */

// JWT secret for token verification.
// No fallback — a missing secret means all protected routes silently use a known
// string, allowing anyone to forge admin tokens. Fail hard at startup instead.
if (!process.env.JWT_SECRET) {
  throw new Error('[middleware] JWT_SECRET environment variable is not set');
}
const JWT_SECRET = process.env.JWT_SECRET;

const PROTECTED_ROUTES = ['/account', '/orders', '/checkout'];
const ADMIN_ROUTES = ['/admin'];

const JWT_OPTIONS = {
  issuer:   process.env.JWT_ISSUER   || 'autobacs-ecommerce',
  audience: process.env.JWT_AUDIENCE || 'autobacs-users',
} as const;

async function verifyToken(token: string): Promise<{ valid: boolean; role?: string }> {
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, JWT_OPTIONS);
    return { valid: true, role: payload.role as string | undefined };
  } catch {
    return { valid: false };
  }
}

/**
 * Attempt a silent token refresh by forwarding the refreshToken cookie to the
 * backend. Returns a NextResponse with new cookies forwarded if successful, or
 * null if the refresh token is missing/expired/invalid.
 */
async function silentRefresh(
  req: NextRequest
): Promise<{ response: NextResponse; role?: string } | null> {
  const refreshToken = req.cookies.get('refreshToken');
  if (!refreshToken?.value) return null;

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) return null;

  try {
    const refreshRes = await fetch(`${apiUrl}/api/v1/auth/refresh`, {
      method:  'POST',
      headers: {
        'Cookie':       `refreshToken=${refreshToken.value}`,
        'Content-Type': 'application/json',
      },
      // Edge fetch must not follow redirects silently
      redirect: 'error',
    });

    if (!refreshRes.ok) return null;

    // Forward all Set-Cookie headers from the backend to the browser so the new
    // accessToken and refreshToken cookies are persisted on the client.
    const response = NextResponse.next();
    const setCookies: string[] =
      typeof refreshRes.headers.getSetCookie === 'function'
        ? refreshRes.headers.getSetCookie()
        : (refreshRes.headers.get('set-cookie') ?? '').split(/,(?=\s*\w+=)/).filter(Boolean);

    for (const cookie of setCookies) {
      response.headers.append('Set-Cookie', cookie);
    }

    // Extract the new access token value so we can do a role check for admin
    // routes without an extra network call.
    const newAccessToken = setCookies
      .find(c => c.trimStart().startsWith('accessToken='))
      ?.split(';')[0]
      ?.replace(/^\s*accessToken=/, '');

    const { role } = newAccessToken
      ? await verifyToken(newAccessToken)
      : { role: undefined };

    return { response, role };
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // UX: redirect already-authenticated users away from /login
  if (pathname === '/login') {
    const accessToken = req.cookies.get('accessToken');
    if (accessToken?.value) {
      const { valid } = await verifyToken(accessToken.value);
      if (valid) return NextResponse.redirect(new URL('/', req.url));
    }
    return NextResponse.next();
  }

  const isProtectedRoute = PROTECTED_ROUTES.some(r => pathname.startsWith(r));
  const isAdminRoute     = ADMIN_ROUTES.some(r => pathname.startsWith(r));

  if (!isProtectedRoute && !isAdminRoute) return NextResponse.next();

  const loginUrl = () => {
    const url = new URL('/login', req.url);
    url.searchParams.set('redirect', pathname);
    return url;
  };

  const accessToken = req.cookies.get('accessToken');

  // ── Path A: access token present — verify it ────────────────────────────────
  if (accessToken?.value) {
    const { valid, role } = await verifyToken(accessToken.value);

    if (valid) {
      if (isAdminRoute && role !== 'admin') {
        console.warn(`[Middleware] Non-admin blocked from ${pathname}`);
        return NextResponse.redirect(new URL('/', req.url));
      }
      return NextResponse.next();
    }
  }

  // ── Path B: access token missing or expired — attempt silent refresh ─────────
  const refreshed = await silentRefresh(req);

  if (refreshed) {
    if (isAdminRoute && refreshed.role !== 'admin') {
      console.warn(`[Middleware] Non-admin blocked from ${pathname} after refresh`);
      return NextResponse.redirect(new URL('/', req.url));
    }
    // Let the request through; new cookies are already set on the response
    return refreshed.response;
  }

  // ── Path C: both tokens invalid — send to login ──────────────────────────────
  const response = NextResponse.redirect(loginUrl());
  response.cookies.delete('accessToken');
  response.cookies.delete('refreshToken');
  return response;
}

export const config = {
  matcher: [
    '/account/:path*',
    '/orders/:path*',
    '/checkout/:path*',
    '/admin/:path*',
  ],
};
