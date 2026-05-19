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
      // Dev placeholders
      { protocol: 'https', hostname: 'via.placeholder.com', pathname: '/**' },
    ],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 86400, // 24 hours
    // OPTIMIZATION: Skip build-time image optimization for faster CI/CD builds
    // Images are already optimized via Cloudinary, so Next.js optimization is redundant
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Prevent clickjacking — no iframing of any page
          { key: 'X-Frame-Options', value: 'DENY' },
          // Prevent MIME-type sniffing attacks
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Limit referrer info sent to third parties
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Force HTTPS for 2 years, include subdomains
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          // Disable browser features not needed by this app
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          // Basic XSS protection for older browsers (modern browsers use CSP)
          { key: 'X-XSS-Protection', value: '1; mode=block' },
        ],
      },
    ];
  },

  async rewrites() {
    // CRITICAL: Railway provides env vars at build time for NEXT_PUBLIC_ variables
    // We must use the correct production URL here
    // Fallback to production URL if not set (Railway doesn't pass env vars during build)
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://ecommerceautobacs-production.up.railway.app';
    
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
    ];
  },
  env: {
    // This makes process.env.API_BASE_URL available in the browser/server code
    // It will be baked in at build time if not careful, but NEXT_PUBLIC_ variables are generally safer.
    // Ideally, use publicRuntimeConfig or just NEXT_PUBLIC_ prefixes.
    API_BASE_URL: process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:5000'),
  },
};

const bundleAnalyzer = withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" });
export default bundleAnalyzer(nextConfig);
