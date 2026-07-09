import { revalidateTag, revalidatePath } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';

// On-demand revalidation for the home page's DB-backed sections. The home page is
// ISR (revalidate = 300) and each section's server fetch is tagged `home:*`
// (see components/home/redesign/homeData.ts). Call this after a data change
// (e.g. toggling a category's featured flag) to refresh `/` immediately instead
// of waiting out the ISR window or redeploying.
//
// Usage:
//   curl -X POST https://<host>/api/revalidate/home            # all home sections
//   curl -X POST "https://<host>/api/revalidate/home?tag=home:categories"  # one section
//
// Security: callers must pass REVALIDATE_SECRET as `?secret=` or the
// `x-revalidate-secret` header. FAIL CLOSED in production — if the env var is
// unset there, the route denies all callers (prevents an unauthenticated
// cache-stampede DoS). Outside production it stays open for local convenience. (FE-1)

const HOME_TAGS = [
  'home:categories',
  'home:products',
  'home:testimonials',
  'home:journal',
  'home:brands',
] as const;

function authorize(req: NextRequest): boolean {
  const expected = process.env.REVALIDATE_SECRET;
  if (!expected) {
    // Fail closed in prod (deny); open only in non-prod for local convenience.
    return process.env.NODE_ENV !== 'production';
  }
  const provided =
    req.nextUrl.searchParams.get('secret') ?? req.headers.get('x-revalidate-secret');
  return provided === expected;
}

function handle(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ revalidated: false, message: 'Unauthorized' }, { status: 401 });
  }

  // Optional single-tag targeting; must be one of the known home tags.
  const requested = req.nextUrl.searchParams.get('tag');
  if (requested && !HOME_TAGS.includes(requested as (typeof HOME_TAGS)[number])) {
    return NextResponse.json(
      { revalidated: false, message: `Unknown tag "${requested}"`, allowed: HOME_TAGS },
      { status: 400 }
    );
  }
  const tags = requested ? [requested] : [...HOME_TAGS];

  for (const tag of tags) revalidateTag(tag);
  // Also nudge the route itself so the page shell regenerates on next hit.
  revalidatePath('/');

  return NextResponse.json({ revalidated: true, tags, now: Date.now() });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

// GET convenience so it can be triggered from a browser/uptime check too.
export async function GET(req: NextRequest) {
  return handle(req);
}
