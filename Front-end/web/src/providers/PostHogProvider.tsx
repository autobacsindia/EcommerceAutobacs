'use client';

import { useEffect, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';

/**
 * PostHog Provider — forward-looking product/behavioral analytics (ADR-005).
 *
 * Captures pageviews + the e-commerce funnel (see src/lib/analytics.ts). Requests are
 * reverse-proxied through /ingest (next.config rewrites) so adblockers don't drop events.
 *
 * Setup:
 *   1. Create a project at https://us.posthog.com
 *   2. Add NEXT_PUBLIC_POSTHOG_KEY (Project API Key) to env (Railway + .env.local)
 *   3. (optional) NEXT_PUBLIC_POSTHOG_UI_HOST — defaults to https://us.posthog.com
 *
 * No key → no-op (analytics simply disabled), so local/dev runs are unaffected.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return; // disabled until configured

    if (!posthog.__loaded) {
      posthog.init(key, {
        // Reverse-proxy through our own domain (see next.config.ts rewrites).
        api_host: '/ingest',
        ui_host: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST || 'https://us.posthog.com',
        capture_pageview: false,      // handled manually below (App Router SPA navigation)
        capture_pageleave: true,
        persistence: 'localStorage+cookie',
      });
    }
  }, []);

  return (
    <>
      <Suspense fallback={null}>
        <PostHogPageview />
      </Suspense>
      {children}
    </>
  );
}

/** Manual $pageview on every App Router navigation (incl. query changes). */
function PostHogPageview() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY || !posthog.__loaded) return;
    const qs = searchParams?.toString();
    posthog.capture('$pageview', {
      $current_url: window.location.origin + pathname + (qs ? `?${qs}` : ''),
    });
  }, [pathname, searchParams]);

  return null;
}
