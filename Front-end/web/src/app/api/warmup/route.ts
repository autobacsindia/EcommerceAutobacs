import { NextResponse } from 'next/server';
import { SITE_URL as BASE_URL } from '@/lib/siteUrl';

// Railway health-check endpoint that also pre-warms the sitemap cache.
// Set RAILWAY_HEALTHCHECK_PATH=/api/warmup (or call it from your deploy script).
// Returns 200 immediately; sitemap fetches run in the background so the
// health check itself never times out waiting for a cold backend.
export async function GET() {
  // Fire-and-forget — intentionally not awaited
  Promise.allSettled([
    fetch(`${BASE_URL}/sitemap/0.xml`, { signal: AbortSignal.timeout(60000) }),
    fetch(`${BASE_URL}/sitemap/1.xml`, { signal: AbortSignal.timeout(60000) }),
  ]).catch(() => {
    // Swallow — warmup failures must not affect health check status
  });

  return NextResponse.json({ status: 'ok' });
}
