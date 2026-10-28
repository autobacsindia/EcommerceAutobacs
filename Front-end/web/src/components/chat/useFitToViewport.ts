'use client';

import { useLayoutEffect, type RefObject } from 'react';

/** Below this width chat shows one pane at a time (Tailwind `lg`). */
export const ONE_PANE_BELOW = 1024;
const MIN_HEIGHT = 320;

/**
 * Sizes the chat box to end exactly at the bottom of what is visible, on phones
 * and tablets. Two things a fixed `calc(100dvh - …)` gets wrong there:
 *  - whatever sits above the box (the "pop-ups are blocked" banner) pushes the
 *    composer below the fold, so the page scrolls instead of the messages;
 *  - the on-screen keyboard: iOS overlays it without shrinking `dvh`, so the
 *    composer hides behind it. `visualViewport.height` does shrink.
 * From `ONE_PANE_BELOW` up the inline height is cleared and the CSS height applies.
 */
export function useFitToViewport(ref: RefObject<HTMLElement | null>, enabled = true) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const vv = window.visualViewport;
    let frame = 0;

    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (window.innerWidth >= ONE_PANE_BELOW) {
          el.style.height = '';
          return;
        }
        const top = el.getBoundingClientRect().top + window.scrollY;
        const visible = vv?.height ?? window.innerHeight;
        el.style.height = `${Math.max(MIN_HEIGHT, Math.floor(visible - top))}px`;
      });
    };

    fit();
    window.addEventListener('resize', fit);
    vv?.addEventListener('resize', fit);
    // Content above the box changing height (a banner dismissed) moves its top.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    observer?.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', fit);
      vv?.removeEventListener('resize', fit);
      observer?.disconnect();
      el.style.height = '';
    };
  }, [ref, enabled]);
}
