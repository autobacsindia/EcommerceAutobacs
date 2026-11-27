import type { ComponentType } from 'react';
import { reportClientError } from './reportClientError';

/**
 * Lazy-load an OPTIONAL component's chunk without ever letting a failed download
 * take the page down.
 *
 * Why this exists (production incident, 2026-11): `next/dynamic` re-throws a
 * failed chunk fetch as a render error. In the ROOT layout there is no error
 * boundary between that throw and React's root, so one missing 3 KB file — the
 * festive sparkle effects — replaced every page, /careers included, with Next's
 * bare "Application error: a client-side exception has occurred". A chunk fetch
 * fails for ordinary reasons on phones: patchy mobile data, a DNS/ad blocker, a
 * tab that outlived a deploy. Decoration must not be able to cost us a page.
 *
 * So: retry a couple of times (most mobile blips are transient), then resolve to
 * a component that renders nothing. Use this ONLY for components the page works
 * without (effects, nice-to-haves). Anything the user needs should fail loudly
 * into an error boundary instead of silently vanishing.
 */
export interface OptionalChunkOptions {
  /** Extra attempts after the first failure. */
  retries?: number;
  /** Wait before each retry, in ms (multiplied by the attempt number). */
  retryDelayMs?: number;
  /** Called once when every attempt failed — for logging. Never throws. */
  onGiveUp?: (error: unknown) => void;
}

const RenderNothing: ComponentType<never> = () => null;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function loadOptionalChunk<P>(
  loader: () => Promise<{ default: ComponentType<P> }>,
  { retries = 2, retryDelayMs = 1500, onGiveUp }: OptionalChunkOptions = {},
): () => Promise<{ default: ComponentType<P> }> {
  return async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await wait(retryDelayMs * attempt);
      try {
        return await loader();
      } catch (err) {
        lastError = err;
      }
    }
    try {
      onGiveUp?.(lastError);
    } catch {
      /* a logging failure must not resurrect the error we just contained */
    }
    // The page still works (it renders nothing here), so a warning, not an error —
    // but a run of these is how the 2026-11 careers outage started.
    reportClientError({ feature: 'script', step: 'optional-chunk', level: 'warning', error: lastError });
    return { default: RenderNothing as ComponentType<P> };
  };
}
