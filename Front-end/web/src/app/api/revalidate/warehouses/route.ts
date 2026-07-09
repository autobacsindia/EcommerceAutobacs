import { revalidateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

// Same auth model as revalidate/home: allow a same-origin request (the admin UI) OR
// an explicit REVALIDATE_SECRET (external callers); deny everything else in production.
// Prevents an unauthenticated cross-origin cache-invalidation DoS. (FE-1)
function isSameOrigin(req: NextRequest): boolean {
  const allowed = new Set([req.nextUrl.origin]);
  if (process.env.NEXT_PUBLIC_APP_URL) allowed.add(process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, ''));
  const origin = req.headers.get('origin');
  if (origin && allowed.has(origin.replace(/\/$/, ''))) return true;
  const referer = req.headers.get('referer');
  if (referer) {
    try {
      if (allowed.has(new URL(referer).origin)) return true;
    } catch { /* malformed referer → not same-origin */ }
  }
  return false;
}

function authorize(req: NextRequest): boolean {
  const expected = process.env.REVALIDATE_SECRET;
  if (expected) {
    const provided =
      req.nextUrl.searchParams.get('secret') ?? req.headers.get('x-revalidate-secret');
    if (provided === expected) return true;
  }
  if (isSameOrigin(req)) return true;
  return process.env.NODE_ENV !== 'production';
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ revalidated: false, message: 'Unauthorized' }, { status: 401 });
  }
  revalidateTag('warehouses');
  return NextResponse.json({ revalidated: true });
}
