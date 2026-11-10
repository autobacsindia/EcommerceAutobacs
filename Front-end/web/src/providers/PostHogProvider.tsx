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
const ANALYTICS_START_MAX_WAIT_MS = 4000;

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return; // disabled until configured

    if (posthog.__loaded) return;

    let cancelled = false;
    let started = false;
    let idleId: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;

    const clearPending = () => {
      window.removeEventListener('load', startWhenIdle);
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      if (timer) clearTimeout(timer);
      if (deadline) clearTimeout(deadline);
    };

    const start = () => {
      if (cancelled || started) return;
      started = true;
      clearPending();
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
    // Ad and tracking scripts can hold the load event back for 8-10 seconds, so the
    // wait is capped: otherwise anyone leaving before then would never be counted.
    function startWhenIdle() {
      if (cancelled || started) return;
      if ('requestIdleCallback' in window) idleId = window.requestIdleCallback(start, { timeout: 3000 });
      else timer = setTimeout(start, 1500);
    }
    deadline = setTimeout(start, ANALYTICS_START_MAX_WAIT_MS);
    if (document.readyState === 'complete') startWhenIdle();
    else window.addEventListener('load', startWhenIdle, { once: true });

    return () => {
      cancelled = true;
      clearPending();
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
