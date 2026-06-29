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
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/admin',
        '/api/',
        '/cart',
        '/checkout',
        '/profile',
        '/orders',
        '/wishlist',
        '/auth/',
        '/login',
        '/register',
        '/reset-password',
        '/forgot-password',
        '/verify-email',
        '/claim-order',
        '/integration-tests',
        '/_next/static/',
      ],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  }
}
