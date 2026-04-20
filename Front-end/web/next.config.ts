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
  // BUILD OPTIMIZATION: Skip type checking during build (run separately)
  typescript: {
    ignoreBuildErrors: true, // Type checking done in CI/CD pipeline
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
  async rewrites() {
    // Production: Must have NEXT_PUBLIC_API_URL set in Railway Dashboard
    // Development: Falls back to localhost if not set
    let apiUrl = process.env.NEXT_PUBLIC_API_URL;
    
    if (apiUrl) {
      // Sanitize the URL: remove whitespace and trailing slashes
      apiUrl = apiUrl.trim().replace(/\/+$/, '');
    }

    if (!apiUrl && process.env.NODE_ENV === 'production') {
      // No silent hardcoded fallback — force the env var to be set explicitly.
      // A missing NEXT_PUBLIC_API_URL in production must be caught at deploy time.
      throw new Error(
        '[next.config.ts] NEXT_PUBLIC_API_URL is required in production. Set it in Railway Dashboard.'
      );
    }

    if (!apiUrl) {
      console.warn('[next.config.ts] NEXT_PUBLIC_API_URL not set — using http://localhost:8080 for development.');
      apiUrl = 'http://localhost:8080';
    } else {
      console.log('[next.config.ts] ✓ API rewrite target:', apiUrl);
    }
    
    const targetUrl = apiUrl;
    
    // Log the final target URL for debugging
    console.log(`[NextConfig] Environment: ${process.env.NODE_ENV}`);
    console.log(`[NextConfig] API Rewrite Target: ${targetUrl}`);

    return [
      {
        // Proxy /api/v1/* calls through to the backend's /api/v1/* routes.
        // All backend routes are versioned under /api/v1/.
        source: '/api/v1/:path*',
        destination: `${targetUrl}/api/v1/:path*`,
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
