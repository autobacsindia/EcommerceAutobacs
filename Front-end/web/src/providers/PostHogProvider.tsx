'use client';

import { useEffect, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';
import { flushWaitingAnalytics, whenAnalyticsReady } from '@/lib/analytics';

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

    if (posthog.__loaded) return;

    const start = () => {
      posthog.init(key, {
        // Reverse-proxy through our own domain (see next.config.ts rewrites).
        api_host: '/ingest',
        ui_host: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST || 'https://us.posthog.com',
        capture_pageview: false,      // handled manually below (App Router SPA navigation)
        capture_pageleave: true,
        // Real-user Core Web Vitals (LCP/INP/CLS/FCP) — the free replacement for
        // Vercel Speed Insights. Shows up under Web Analytics / Web Vitals in the
        // PostHog dashboard, no extra dependency or cost.
        capture_performance: { web_vitals: true },
        persistence: 'localStorage+cookie',
        loaded: flushWaitingAnalytics,
      });
    };

    // PostHog pulls in about 60 KB more while it starts up. On a phone on 4G that
    // competed with the page's own pictures, so it waits until the page has loaded.
    let cancelled = false;
    let idleId: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startWhenIdle = () => {
      if (cancelled) return;
      if ('requestIdleCallback' in window) idleId = window.requestIdleCallback(start, { timeout: 3000 });
      else timer = setTimeout(start, 1500);
    };
    if (document.readyState === 'complete') startWhenIdle();
    else window.addEventListener('load', startWhenIdle, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener('load', startWhenIdle);
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      if (timer) clearTimeout(timer);
    };
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
    const qs = searchParams?.toString();
    const url = window.location.origin + pathname + (qs ? `?${qs}` : '');
    whenAnalyticsReady(() => posthog.capture('$pageview', { $current_url: url }));
  }, [pathname, searchParams]);

  return null;
}
