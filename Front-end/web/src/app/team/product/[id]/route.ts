import type { NextRequest } from 'next/server';
import { getServerApiBase, internalApiHeaders } from '@/lib/server-api';
import { isObjectId } from '@/lib/productLink';
import { productUrl } from '@/lib/types';

/**
 * GET /team/product/<id>[?variant=<id>] — "open this product on the website",
 * for links in the admin and team panels (components/staff/ProductLink.tsx).
 *
 * Panel data holds product ids; the storefront only serves slugs. The public
 * backend route GET /products/:id already answers exactly the question we need:
 * a 301 to the slug for a LIVE product, and a 404 for a draft or a deleted one
 * (it never discloses a draft's slug). So this asks it, follows nothing, reads
 * the slug from the redirect, and sends the browser to the product page.
 *
 * Lives under /team so middleware lets in only signed-in staff and admins, and
 * robots.ts already keeps crawlers off it. Never cached: a product can be
 * switched off at any time.
 */

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

/** The slug inside the backend's `Location: /api/v1/products/slug/<slug>`. */
function slugFrom(location: string | null): string | null {
  const m = /\/products\/slug\/([^/?#]+)\/?$/.exec(location || '');
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

function message(status: number, title: string, body: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef1f0;color:#0f1111;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px;box-sizing:border-box}main{max-width:420px;background:#fff;border:1px solid #dfe3e2;border-radius:12px;padding:24px}h1{font-size:18px;margin:0 0 8px}p{margin:0;color:#5f6363}</style>
</head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE } });
}

const notOnWebsite = () => message(
  404,
  'This product is not on the website',
  'It may be switched off (a draft) or removed, so it has no page customers can see. You can close this tab.',
);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isObjectId(id)) return notOnWebsite();

  let res: Response;
  try {
    res = await fetch(`${getServerApiBase()}/products/${id}`, {
      redirect: 'manual',
      cache: 'no-store',
      headers: internalApiHeaders(),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return message(503, 'Could not open the product', 'The website did not answer. Please try again in a moment.');
  }

  if (res.status >= 300 && res.status < 400) {
    const path = productUrl({ slug: slugFrom(res.headers.get('location')) });
    if (!path) return notOnWebsite();
    const variant = request.nextUrl.searchParams.get('variant');
    // Re-encoded: a header may only carry ASCII, and a slug can hold "–" or "é".
    const target = encodeURI(isObjectId(variant) ? `${path}?variant=${variant}` : path);
    // A relative Location: the browser resolves it against the panel's own host,
    // so this works on every domain the site runs on without knowing which.
    return new Response(null, { status: 307, headers: { Location: target, ...NO_STORE } });
  }
  // 404 = draft or deleted. A 200 is a live product with no slug — the
  // storefront has no page for it either.
  if (res.status === 404 || res.ok) return notOnWebsite();
  return message(503, 'Could not open the product', 'The website is busy right now. Please try again in a moment.');
}
