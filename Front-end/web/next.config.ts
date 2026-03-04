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
  reactStrictMode: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  reactCompiler: true,
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
  },
  async rewrites() {
    // When running in standalone mode, process.env might not be populated from .env files
    // in the same way. However, for client-side calls, we rely on NEXT_PUBLIC_API_URL.
    // For server-side rewrites (if any), we use the environment variable directly.
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    
    if (!apiUrl) {
      console.warn('WARNING: NEXT_PUBLIC_API_URL is not defined! API requests will fail in production.');
    } else {
      console.log('Rewriting API requests to:', apiUrl);
    }
    
    // Fallback to localhost ONLY if not in production, otherwise use the provided URL or fail explicitly
    const targetUrl = apiUrl || (process.env.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:5000');

    if (process.env.NODE_ENV === 'production' && !targetUrl) {
       console.error('CRITICAL: Production build missing API URL. Please set NEXT_PUBLIC_API_URL.');
    }
    
    // Log the final target URL for debugging
    console.log(`[NextConfig] Environment: ${process.env.NODE_ENV}`);
    console.log(`[NextConfig] API Rewrite Target: ${targetUrl || '(empty - will fail)'}`);

    return [
      {
        source: '/api/:path*',
        destination: `${targetUrl}/:path*`,
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
