import { revalidateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

// Same auth model as revalidate/home: require REVALIDATE_SECRET, fail closed in
// production when it's unset (prevents an unauthenticated cache-invalidation DoS),
// open only outside production for local convenience. (FE-1)
function authorize(req: NextRequest): boolean {
  const expected = process.env.REVALIDATE_SECRET;
  if (!expected) return process.env.NODE_ENV !== 'production';
  const provided =
    req.nextUrl.searchParams.get('secret') ?? req.headers.get('x-revalidate-secret');
  return provided === expected;
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ revalidated: false, message: 'Unauthorized' }, { status: 401 });
  }
  revalidateTag('warehouses');
  return NextResponse.json({ revalidated: true });
}
