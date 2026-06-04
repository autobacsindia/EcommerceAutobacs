import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── API proxy routes ────────────────────────────────────────────────────────
  // Strip the Origin header so the Express backend treats the proxied request as
  // server-to-server and skips the CORS origin check that requires FRONTEND_URL.
  if (pathname.startsWith('/api/v1/')) {
    const apiHeaders = new Headers(request.headers);
    apiHeaders.delete('origin');
    return NextResponse.next({ request: { headers: apiHeaders } });
  }

  // ── All page routes — generate nonce and set CSP ────────────────────────────
  // crypto.randomUUID() is available in both Node.js ≥15.6 and the Edge runtime
  // (Web Crypto API). Base64-encoding it produces a compact, URL-safe string.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV !== 'production';

  // Build the script-src directive:
  //   'nonce-{n}'      — only scripts carrying this nonce may execute inline.
  //   'strict-dynamic' — trust propagates to scripts loaded by a nonce'd script,
  //                      so Razorpay can load its own sub-scripts without being
  //                      individually allow-listed.  Domain allow-lists below
  //                      serve as a fallback for browsers without strict-dynamic.
  //   'unsafe-eval'    — needed only in development for React Fast Refresh (HMR).
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(isDev ? ["'unsafe-eval'"] : []),
    'https://checkout.razorpay.com',
    'https://maps.googleapis.com',
  ].join(' ');

  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob: https://res.cloudinary.com https://autobacsindia.com https://*.gstatic.com https://*.googleapis.com",
    "font-src 'self' data:",
    // blob: for LogRocket session-replay web workers spawned by the npm SDK
    "worker-src blob: 'self'",
    "connect-src 'self' https://*.ingest.sentry.io https://r.lr-ingest.io https://api.razorpay.com https://lumberjack.razorpay.com https://maps.googleapis.com",
    // Razorpay renders its payment UI inside an iframe
    "frame-src https://api.razorpay.com https://checkout.razorpay.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://api.razorpay.com",
    "upgrade-insecure-requests",
  ].join('; ');

  // Forward the nonce to server components via a request header so that
  // layout.tsx can read it with headers() and pass it to <Script nonce>.
  const pageHeaders = new Headers(request.headers);
  pageHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: pageHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    // API proxy routes — Origin header removal
    '/api/v1/:path*',
    // All page routes — nonce + CSP. Exclude Next.js internals and static assets
    // so the Edge function does not run on every static file request.
    '/((?!_next/static|_next/image|favicon\\.ico).*)',
  ],
};
