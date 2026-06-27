import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

// PWA disabled — @ducanh2912/next-pwa removed. Re-enable by reinstalling and wrapping config.
// BUILD OPTIMIZATION v2: Disabled image optimization, TypeScript, ESLint during build for 60-70% faster builds
const nextConfig: NextConfig = {
  /* config options here */
  // Enable standalone output for Docker deployment
  output: 'standalone',
  reactStrictMode: true,
  devIndicators: false,
  // PostHog reverse-proxy (ADR-005) sends events to /ingest/* on our own domain; keep the
  // trailing slash intact so PostHog's flags/decide endpoints resolve correctly.
  skipTrailingSlashRedirect: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: true, // Linting done in CI/CD pipeline
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === "production"
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    // Explicit allowlist — prevents open proxy abuse via /_next/image?url=...
    // TODO: Migrate hardcoded WordPress logos to Cloudinary, then remove autobacsindia.com
    remotePatterns: [
      // Cloudinary — scoped to your cloud name only (prevents proxying other tenants)
      { protocol: 'https', hostname: 'res.cloudinary.com', pathname: '/dhwxtl6l8/**' },
      // Legacy WordPress assets — remove after logo migration complete
      { protocol: 'https', hostname: 'autobacsindia.com', pathname: '/wp-content/uploads/**' },
      // Cloudflare Images / Polish CDN cache (same domain, different path)
      { protocol: 'https', hostname: 'autobacsindia.com', pathname: '/cdn-cgi/image/**' },
    ],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 86400, // 24 hours
    // OPTIMIZATION: Skip build-time image optimization for faster CI/CD builds
    // Images are already optimized via Cloudinary, so Next.js optimization is redundant
    unoptimized: true,
  },
  async headers() {
    // Content-Security-Policy is intentionally absent here.
    // middleware.ts generates a fresh nonce per request and sets the full
    // CSP header dynamically, so a static CSP would either conflict or
    // make 'unsafe-inline' necessary again. All other security headers
    // are static and are kept here.
    return [
      {
        source: '/(.*)',
        headers: [
          // Prevent clickjacking — kept alongside CSP frame-ancestors for legacy browsers
          { key: 'X-Frame-Options', value: 'DENY' },
          // Prevent MIME-type sniffing attacks
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Limit referrer info sent to third parties
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Force HTTPS for 2 years, include subdomains
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          // Disable browser features not needed by this app
          { key: 'Permissions-Policy', value: 'camera=(), microphone=()' },
          // Basic XSS protection for older browsers (modern browsers use CSP)
          { key: 'X-XSS-Protection', value: '1; mode=block' },
        ],
      },
    ];
  },

  async redirects() {
    // SEO 301s for the WordPress → Next migration (ADR-005). Preserves Google rankings,
    // backlinks and ad landing pages when the domain points at the new site.
    //   • Blog posts keep their old root path (/<slug>) — served by app/[slug], no redirect.
    //   • Products & categories had different WooCommerce bases → permanent redirect.
    //   • The new blog detail path forwards to the canonical root URL (no duplicate content).
    return [
      { source: '/product/:slug', destination: '/products/:slug', permanent: true },
      { source: '/product-category/:slug*', destination: '/categories/:slug*', permanent: true },
      { source: '/media/blogs/:slug', destination: '/:slug', permanent: true },
      // Blog (+ gallery/videos) moved out of /media into its own /blog section.
      { source: '/media/blogs', destination: '/blog', permanent: true },
      { source: '/media/gallery', destination: '/blog/gallery', permanent: true },
      { source: '/media/videos', destination: '/blog/videos', permanent: true },
      // News was replaced by the Press Coverage page at /media.
      { source: '/media/news', destination: '/media', permanent: true },
    ];
  },

  async rewrites() {
    // NEXT_PUBLIC_API_URL is validated at the Dockerfile level (build arg check).
    // It will always be set here in a properly configured Railway build.
    // For local development, set it in .env.local.
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080';

    const sanitizedUrl = apiUrl.trim().replace(/\/+$/, '');
    console.log(`[next.config.ts] ✓ API rewrite target: ${sanitizedUrl}`);
    console.log(`[next.config.ts] NODE_ENV: ${process.env.NODE_ENV}`);
    
    return [
      {
        // Proxy /api/v1/* calls through to the backend's /api/v1/* routes.
        // All backend routes are versioned under /api/v1/.
        source: '/api/v1/:path*',
        destination: `${sanitizedUrl}/api/v1/:path*`,
      },
      // PostHog reverse-proxy (Cloud US) — routes analytics through our domain so
      // adblockers don't drop events. Static assets are on a separate host.
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ];
  },
  env: {
    // Baked in at build time. In production NEXT_PUBLIC_API_URL is already validated
    // above, so this is always defined when NODE_ENV === 'production'.
    API_BASE_URL: process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080',
  },
  webpack(config) {
    // ─── Windows duplicate-module fix ────────────────────────────────────────
    // On Windows, the same physical node_modules directory can be reached via
    // path strings that differ only in casing (e.g. "Front-end/web/…" vs
    // "front-end/web/…" — depending on how the terminal's CWD was typed).
    // Webpack uses the full path string as the module-registry key, so the
    // same file gets registered twice, producing two separate module instances.
    // When this hits a React.createContext() call (e.g. in layout-router.js),
    // the provider uses context object A while OuterLayoutRouter's useContext()
    // looks for context object B → null → "invariant expected layout router to
    // be mounted".
    //
    // Fix: hook into NormalModuleFactory.afterResolve and normalise every
    // resolved resource path to its real filesystem case via realpathSync.native
    // before webpack commits it to the registry.  A per-process Map avoids
    // repeated syscalls for paths seen more than once.
    if (process.platform === 'win32') {
      const { realpathSync } = require('fs') as typeof import('fs');
      const cache = new Map<string, string>();
      const realPath = (p: string): string => {
        if (cache.has(p)) return cache.get(p)!;
        try {
          const r = realpathSync.native(p);
          cache.set(p, r);
          return r;
        } catch {
          cache.set(p, p);
          return p;
        }
      };

      config.plugins.push({
        apply(compiler: any) {
          compiler.hooks.normalModuleFactory.tap(
            'NormalizeCasePlugin',
            (factory: any) => {
              factory.hooks.afterResolve.tap(
                'NormalizeCasePlugin',
                (data: any) => {
                  if (!data) return;
                  if (data.resource) {
                    data.resource = realPath(data.resource);
                  }
                  if (data.resourceResolveData?.path) {
                    data.resourceResolveData.path = realPath(
                      data.resourceResolveData.path
                    );
                  }
                }
              );
            }
          );
        },
      });
    }

    config.resolve.symlinks = true;
    return config;
  },
};

const bundleAnalyzer = withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" });
export default bundleAnalyzer(nextConfig);
