'use client';

import { useEffect, useState } from 'react';

/**
 * Live `matchMedia` subscription as a hook.
 *
 * Hydration-safe by construction: the server has no media query to evaluate, so
 * the first client render MUST agree with the server or React discards the
 * markup. We therefore always start at `false` and correct in an effect — the
 * correction lands in the same commit as hydration, so there is no visible
 * flash, and no SSR/client mismatch (a recurring bug class in this codebase).
 *
 * Consequence for callers: `false` means "no, or not measured yet". Only use
 * this to ADD capability (hover zoom, motion), never to gate essential content
 * — a feature that only exists when this returns `true` is invisible for one
 * frame, and invisible entirely if JS fails. Breakpoint layout switching should
 * stay in CSS (`lg:hidden`) for the same reason.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;

    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    sync();

    // `addEventListener` on MediaQueryList is unavailable on Safari < 14, which
    // still ships on locked iOS 13 devices; fall back to the legacy listener API
    // rather than throwing and taking the whole component down.
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', sync);
      return () => mq.removeEventListener('change', sync);
    }
    mq.addListener(sync);
    return () => mq.removeListener(sync);
  }, [query]);

  return matches;
}

/** True when the user has asked the OS to minimise animation. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/**
 * True only for a real pointing device that can hover — a mouse or trackpad.
 *
 * Both halves matter. `hover: hover` alone still matches some hybrid laptops and
 * Android tablets whose *primary* pointer is coarse; `pointer: fine` alone
 * matches a stylus that cannot hover. Gating on both keeps hover-only affordances
 * (the PDP magnifier) off touch devices, where a synthetic `pointerenter` fired
 * by a tap would otherwise leave the zoom stuck on with no way to dismiss it.
 */
export function useCanHover(): boolean {
  return useMediaQuery('(hover: hover) and (pointer: fine)');
}
