import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose'; // Lightweight JWT verification (edge-compatible)

/**
 * Next.js Middleware — single edge entrypoint for the whole app.
 *
 * Next loads exactly ONE middleware file; with a `src/` directory it must live at
 * `src/middleware.ts` (a sibling `middleware.ts` at the project root is ignored).
 * Both responsibilities therefore live here:
 *
 *   1. CSP + per-request nonce — applied to every page response.
 *   2. Protected-route authentication — JWT verification + silent refresh.
 *
 * Protection layers (auth is defence-in-depth; the backend RBAC is the real gate):
 *   1. Middleware (this file) — early blocking, prevents HTML rendering.
 *   2. Server Components — additional check before HTML is sent.
 *   3. Backend API — REAL security (RBAC enforcement).
 *   4. Client redirect — UX fallback.
 *
 * Protected routes:
 *   - /admin/*    — Admin only (JWT verification + role check)
 *   - /account/*  — Authenticated users (JWT verification)
 *   - /orders/*   — Authenticated users (JWT verification)
 *   - /checkout/* — Authenticated users (JWT verification)
 *
 * Token refresh: when the access token is expired, middleware attempts a silent
 * refresh via POST /api/v1/auth/refresh before redirecting to login, so actively
 * browsing users are not forced to re-authenticate every 30 minutes.
 */

const PROTECTED_ROUTES = ['/account', '/orders', '/checkout'];
const ADMIN_ROUTES = ['/admin'];

// Verification options must match how the backend SIGNS tokens
// (Back-end/server/utils/sessionManager.js → signToken with only { expiresIn }).
// The backend issues HS256 tokens with NO `iss`/`aud` claims and verifies with
// `algorithms: ['HS256']` only. jose would reject a token if we required issuer/
// audience here, so we lock the algorithm (prevents alg-confusion) and nothing
// else. The backend remains the real gate (sessionVersion revocation, RBAC).
const JWT_OPTIONS = {
  algorithms: ['HS256'],
};

// JWT secret for token verification. No fallback — a missing secret would let
// anyone forge admin tokens against a known string. We fail HARD, but only on the
// auth path: this middleware now runs on every route (for CSP), so a missing
// secret must not take down public pages — it throws only when an auth-relevant
// route actually needs to verify a token.
function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('[middleware] JWT_SECRET environment variable is not set');
  }
  return new TextEncoder().encode(secret);
}

async function verifyToken(
  token: string,
  secret: Uint8Array,
): Promise<{ valid: boolean; role?: string }> {
  try {
    const { payload } = await jwtVerify(token, secret, JWT_OPTIONS);
    return { valid: true, role: payload.role as string | undefined };
  } catch {
    return { valid: false };
  }
}

/**
 * Attempt a silent token refresh by forwarding the refreshToken cookie to the
 * backend. Returns the backend's Set-Cookie headers (to forward to the browser)
 * and the new role, or null if the refresh token is missing/expired/invalid.
 */
async function silentRefresh(
  req: NextRequest,
  secret: Uint8Array,
): Promise<{ setCookies: string[]; role?: string } | null> {
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

    const setCookies: string[] =
      typeof refreshRes.headers.getSetCookie === 'function'
        ? refreshRes.headers.getSetCookie()
        : (refreshRes.headers.get('set-cookie') ?? '').split(/,(?=\s*\w+=)/).filter(Boolean);

    // Extract the new access token so we can role-check admin routes without an
    // extra network call.
    const newAccessToken = setCookies
      .find(c => c.trimStart().startsWith('accessToken='))
      ?.split(';')[0]
      ?.replace(/^\s*accessToken=/, '');

    const { role } = newAccessToken
      ? await verifyToken(newAccessToken, secret)
      : { role: undefined };

    return { setCookies, role };
  } catch {
    return null;
  }
}

// ── CSP construction ──────────────────────────────────────────────────────────
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== 'production';

  // script-src:
  //   'nonce-{n}'      — only scripts carrying this nonce may execute inline.
  //   'strict-dynamic' — trust propagates to scripts loaded by a nonce'd script,
  //                      so Razorpay can load its own sub-scripts. Domain
  //                      allow-lists below are a fallback for browsers without it.
  //   'unsafe-eval'    — dev only, for React Fast Refresh (HMR).
  //   'wasm-unsafe-eval' — allows WebAssembly.instantiate (the Draco glTF
  //                      decoder that powers the home 3D car) WITHOUT permitting
  //                      general eval(); required in prod where 'unsafe-eval' is
  //                      stripped. Without it the .glb never decodes → blank canvas.
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "'wasm-unsafe-eval'",
    ...(isDev ? ["'unsafe-eval'"] : []),
    'https://checkout.razorpay.com',
    // Affordability/EMI widget on the PDP (RazorpayAffordabilitySuite).
    'https://cdn.razorpay.com',
    'https://maps.googleapis.com',
  ].join(' ');

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // 'unsafe-inline' is required for style-src: the CSP spec does not support
    // nonces on style="" attributes, only on <style> elements. React libraries
    // (react-hot-toast, next/font, Tailwind utilities) emit inline style
    // attributes that cannot be nonce'd. CSS-injection risk is low; the
    // meaningful gain is script-src keeping its strict nonce policy.
    "style-src 'self' 'unsafe-inline'",
    // images.unsplash.com = temporary home-redesign placeholder imagery; safe to
    // remove once all artwork is hosted on Cloudinary (res.cloudinary.com).
    // cdn.razorpay.com serves the EMI widget's bank/lender logos.
    "img-src 'self' data: blob: https://res.cloudinary.com https://images.unsplash.com https://*.gstatic.com https://*.googleapis.com https://cdn.razorpay.com",
    "font-src 'self' data:",
    // blob: for LogRocket session-replay web workers spawned by the npm SDK
    "worker-src blob: 'self'",
    "connect-src 'self' https://*.ingest.sentry.io https://r.lr-ingest.io https://api.razorpay.com https://cdn.razorpay.com https://lumberjack.razorpay.com https://maps.googleapis.com",
    // Razorpay renders its payment UI (checkout) and the EMI affordability
    // widget's "View plans" modal inside iframes.
    "frame-src https://api.razorpay.com https://checkout.razorpay.com https://cdn.razorpay.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://api.razorpay.com",
    "upgrade-insecure-requests",
  ].join('; ');
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── API proxy routes ────────────────────────────────────────────────────────
  // Strip the Origin header so the Express backend treats the proxied request as
  // server-to-server and skips the CORS origin check. No CSP/nonce on API calls.
  if (pathname.startsWith('/api/v1/')) {
    const apiHeaders = new Headers(req.headers);
    apiHeaders.delete('origin');
    return NextResponse.next({ request: { headers: apiHeaders } });
  }

  // Per-request nonce + CSP, attached to whichever response proceeds.
  // crypto.randomUUID() is available in the Edge runtime (Web Crypto API).
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce);

  // Build a "proceed" response that forwards the nonce to server components via
  // the x-nonce request header and sets the CSP response header. Optionally
  // appends Set-Cookie headers (from a silent refresh).
  const proceed = (extraSetCookies?: string[]) => {
    const pageHeaders = new Headers(req.headers);
    pageHeaders.set('x-nonce', nonce);
    const res = NextResponse.next({ request: { headers: pageHeaders } });
    res.headers.set('Content-Security-Policy', csp);
    if (extraSetCookies) {
      for (const cookie of extraSetCookies) res.headers.append('Set-Cookie', cookie);
    }
    return res;
  };

  const isProtectedRoute = PROTECTED_ROUTES.some(r => pathname.startsWith(r));
  const isAdminRoute     = ADMIN_ROUTES.some(r => pathname.startsWith(r));
  const isLogin          = pathname === '/login';

  // Public, non-login route — nothing to authenticate; just apply CSP.
  if (!isProtectedRoute && !isAdminRoute && !isLogin) {
    return proceed();
  }

  // From here the route touches auth — a JWT secret is mandatory (fails loud).
  const secret = getJwtSecret();
  const accessToken = req.cookies.get('accessToken');

  // ── UX: redirect already-authenticated users away from /login ────────────────
  if (isLogin) {
    if (accessToken?.value) {
      const { valid } = await verifyToken(accessToken.value, secret);
      if (valid) return NextResponse.redirect(new URL('/', req.url));
    }
    return proceed();
  }

  const loginUrl = () => {
    const url = new URL('/login', req.url);
    url.searchParams.set('redirect', pathname);
    return url;
  };

  // ── Path A: access token present — verify it ─────────────────────────────────
  if (accessToken?.value) {
    const { valid, role } = await verifyToken(accessToken.value, secret);
    if (valid) {
      if (isAdminRoute && role !== 'admin') {
        console.warn(`[middleware] Non-admin blocked from ${pathname}`);
        return NextResponse.redirect(new URL('/', req.url));
      }
      return proceed();
    }
  }

  // ── Path B: token missing or expired — attempt silent refresh ────────────────
  const refreshed = await silentRefresh(req, secret);
  if (refreshed) {
    if (isAdminRoute && refreshed.role !== 'admin') {
      console.warn(`[middleware] Non-admin blocked from ${pathname} after refresh`);
      return NextResponse.redirect(new URL('/', req.url));
    }
    // Let the request through; new cookies + CSP + nonce ride on the response.
    return proceed(refreshed.setCookies);
  }

  // ── Path C: both tokens invalid — send to login and clear cookies ────────────
  const response = NextResponse.redirect(loginUrl());
  response.cookies.delete('accessToken');
  response.cookies.delete('refreshToken');
  return response;
}

export const config = {
  matcher: [
    // API proxy routes — Origin header removal.
    '/api/v1/:path*',
    // All page routes — CSP/nonce (+ auth on protected routes). Exclude Next.js
    // internals and static assets so the Edge function does not run on every
    // static file request.
    '/((?!_next/static|_next/image|favicon\\.ico).*)',
  ],
};
