import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";
import withPWA from "@ducanh2912/next-pwa";

const pwaConfig = withPWA({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: true, // process.env.NODE_ENV === "development",
  workboxOptions: {
    disableDevLogs: true,
    runtimeCaching: [
      {
        urlPattern: /^https:\/\/fonts\.(?:gstatic)\.com\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'google-fonts-webfonts',
          expiration: {
            maxEntries: 4,
            maxAgeSeconds: 365 * 24 * 60 * 60, // 365 days
          },
        },
      },
      {
        urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'google-fonts-stylesheets',
          expiration: {
            maxEntries: 4,
            maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
          },
        },
      },
      {
        urlPattern: /\.(?:eot|otf|ttc|ttf|woff|woff2|font.css)$/i,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'static-font-assets',
          expiration: {
            maxEntries: 4,
            maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
          },
        },
      },
      {
        urlPattern: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'static-image-assets',
          expiration: {
            maxEntries: 64,
            maxAgeSeconds: 24 * 60 * 60, // 24 hours
          },
        },
      },
      {
        urlPattern: /\/_next\/image\?url=.+$/i,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'next-image',
          expiration: {
            maxEntries: 64,
            maxAgeSeconds: 24 * 60 * 60, // 24 hours
          },
        },
      },
      {
        urlPattern: /\/api\/products/i,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'api-products',
          expiration: {
            maxEntries: 32,
            maxAgeSeconds: 24 * 60 * 60, // 24 hours
          },
          networkTimeoutSeconds: 10,
        },
      },
      {
        urlPattern: /\/api\/categories/i,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'api-categories',
          expiration: {
            maxEntries: 32,
            maxAgeSeconds: 24 * 60 * 60, // 24 hours
          },
        },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  /* config options here */
  output: 'standalone',
  // Disable standalone mode for now as it's causing path resolution issues in Docker
  // output: 'standalone',
  reactStrictMode: false,
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === "production"
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60,
   unoptimized: process.env.NODE_ENV === 'production', // Disable optimization in production to fix 400 errors
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
      // Fallback to production URL if env var not set during build
      apiUrl = 'https://ecommerceautobacs-production.up.railway.app';
     console.warn('Using fallback production API URL:', apiUrl);
    }
    
    if (!apiUrl) {
     console.warn('WARNING: NEXT_PUBLIC_API_URL is not defined. Using localhost for development.');
      apiUrl = 'http://localhost:8080';
    } else {
     console.log('✓ Rewriting API requests to:', apiUrl);
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
export default bundleAnalyzer(pwaConfig(nextConfig));
