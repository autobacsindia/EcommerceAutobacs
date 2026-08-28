import { MetadataRoute } from 'next'
import { SITE_URL as BASE_URL } from '@/lib/siteUrl'

/**
 * Dynamic robots.txt (env-driven host). Allows crawling of public content so
 * Google can read per-page `noindex` tags, and blocks only private/system
 * paths. Points crawlers at the dynamic sitemap.
 *
 * NOTE: this replaces the former static public/robots.txt, which hard-coded a
 * Railway preview domain and shadowed this route.
 */
// Private/system paths no crawler should walk. Shared by every rule below so a
// path can never be blocked for one agent and left open for another.
const DISALLOW = [
  '/admin',
  '/api/',
  '/cart',
  '/checkout',
  '/profile',
  '/order',
  '/orders',
  // The customer's own ticket list — private, and never in the sitemap.
  '/support',
  '/wishlist',
  '/auth/',
  '/login',
  '/register',
  '/reset-password',
  '/forgot-password',
  '/verify-email',
  '/claim-order',
  // Private campaign landing pages — reached only by the QR printed on a
  // thank-you card. Never indexed, never in the sitemap.
  '/festive',
  // The in-store Onam offer — the printed counter QR is the only route in.
  '/onam',
  // Dev-only visual harnesses. They 404 in production; this is the second line of
  // defence for preview/test tiers, which are publicly reachable.
  '/dev',
  '/integration-tests',
  '/_next/static/',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: DISALLOW },

      // AdsBot-Google DELIBERATELY IGNORES `User-agent: *`.
      //
      // Google documents this: the AdsBot crawlers obey only rules that name them
      // explicitly, so an advertiser cannot accidentally block the landing-page
      // quality check that their ad spend depends on. The practical effect here was
      // that AdsBot walked straight past the `/api/` and `/cart` disallow above and
      // hammered `/api/v1/cart` — one logged rate-limit block showed attemptCount
      // 534 from a single AdsBot IP.
      //
      // These rules re-state the SAME disallow list for the AdsBot agents. Note
      // `allow: '/'` is kept: AdsBot must still reach real landing pages or Google
      // reports "destination not working" and ad quality suffers. This blocks the
      // API and private routes only — it does not block the ads crawler from the
      // storefront.
      { userAgent: 'AdsBot-Google', allow: '/', disallow: DISALLOW },
      { userAgent: 'AdsBot-Google-Mobile', allow: '/', disallow: DISALLOW },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  }
}
