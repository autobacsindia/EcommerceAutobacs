import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Generic on-demand revalidation endpoint, called server-to-server by the
 * backend (services/frontendRevalidator.js) after a data write. It refreshes the
 * Next.js Data Cache entries tagged by the affected entity so the storefront
 * updates within seconds instead of waiting out each fetch's `revalidate`
 * window.
 *
 * Auth: requires the shared REVALIDATE_SECRET (header `x-revalidate-secret`).
 * FAIL CLOSED in production — if the secret is unset there, every caller is
 * denied (prevents an unauthenticated revalidation-storm DoS). The sibling
 * /api/revalidate/home route keeps its same-origin path for the browser admin
 * flow; this route is machine-to-machine only, so it is secret-only.
 *
 * Body: { tags: string[] } — each tag must start with an allowlisted prefix.
 */

const ALLOWED_PREFIXES = ['home:', 'product:', 'category:', 'nav:', 'seo:', 'blog:'];
const MAX_TAGS = 20;

function authorize(req: NextRequest): boolean {
  const expected = process.env.REVALIDATE_SECRET;
  if (expected) {
    return req.headers.get('x-revalidate-secret') === expected;
  }
  // No secret configured: allow in dev for convenience, deny in prod.
  return process.env.NODE_ENV !== 'production';
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ revalidated: false, message: 'Unauthorized' }, { status: 401 });
  }

  let body: { tags?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ revalidated: false, message: 'Invalid JSON' }, { status: 400 });
  }

  const requested = Array.isArray(body.tags) ? body.tags : [];
  const tags = requested
    .filter((t): t is string => typeof t === 'string')
    .filter((t) => ALLOWED_PREFIXES.some((p) => t.startsWith(p)))
    .slice(0, MAX_TAGS);

  if (!tags.length) {
    return NextResponse.json(
      { revalidated: false, message: 'No valid tags', allowedPrefixes: ALLOWED_PREFIXES },
      { status: 400 }
    );
  }

  for (const tag of tags) revalidateTag(tag);
  return NextResponse.json({ revalidated: true, tags, now: Date.now() });
}
