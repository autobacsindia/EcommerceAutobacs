/**
 * The ONE place that loads posthog-js, and it loads it on demand.
 *
 * Why: a static `import posthog from 'posthog-js'` put the whole library (225 KB of
 * JavaScript, 75 KB over the wire — the biggest file on every storefront page) into
 * the first-load bundle. Measured on the live site 2026-11-28: it was downloaded and
 * parsed before the page became usable, even though PostHog itself only STARTS after
 * the page has loaded (or 4 s, see PostHogProvider). Now the file is fetched at that
 * same moment instead, so a phone on 4G spends its first seconds on the page's own
 * pictures and code.
 *
 * Nothing else may import 'posthog-js' as a value — a single static import anywhere
 * would pull the library back into the first-load bundle. Type-only imports are fine.
 */
import type { PostHog } from 'posthog-js';

let instance: PostHog | null = null;
let loading: Promise<PostHog> | null = null;

/** Fetch the library (once). A failed fetch can be retried by calling again. */
export function loadPostHog(): Promise<PostHog> {
  if (!loading) {
    loading = import('posthog-js')
      .then((mod) => {
        instance = mod.default;
        return instance;
      })
      .catch((err: unknown) => {
        loading = null; // e.g. a flaky network: let the next caller try again
        throw err;
      });
  }
  return loading;
}

/** The PostHog client once it is fetched AND initialised; otherwise null. */
export function readyPostHog(): PostHog | null {
  return instance && instance.__loaded ? instance : null;
}

/** Test-only: forget the fetched module between tests. */
export function __resetPostHogLoader(): void {
  instance = null;
  loading = null;
}
