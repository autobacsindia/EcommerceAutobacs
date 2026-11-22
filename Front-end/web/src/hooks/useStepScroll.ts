'use client';

import { useEffect, useRef } from 'react';

/**
 * On every step change of a multi-step flow (checkout: Cart → Shipping → Payment →
 * Review, and back), bring the step's top into view and move keyboard/screen-reader
 * focus to the new step's heading.
 *
 * Without it the page kept the previous step's scroll position — 370–500px down, at the
 * footer — so a shopper tapping "Continue" saw no change and often thought it failed.
 *
 * - Not on first render: landing on checkout should not jump.
 * - Smooth scroll only when the user has not asked for reduced motion.
 * - The heading needs tabIndex={-1} to be focusable; focus uses preventScroll so it
 *   does not fight the scroll above. Give the container a scroll-margin-top so a sticky
 *   header does not cover it.
 */
export function useStepScroll<C extends HTMLElement = HTMLDivElement, H extends HTMLElement = HTMLHeadingElement>(
  step: string,
) {
  const containerRef = useRef<C | null>(null);
  const headingRef = useRef<H | null>(null);
  const previous = useRef(step);

  useEffect(() => {
    if (previous.current === step) return;
    previous.current = step;
    if (typeof window === 'undefined') return;
    const reduced = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    const behavior: ScrollBehavior = reduced ? 'auto' : 'smooth';
    const container = containerRef.current;
    if (container?.scrollIntoView) container.scrollIntoView({ behavior, block: 'start' });
    else window.scrollTo?.({ top: 0, behavior });
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  return { containerRef, headingRef };
}
