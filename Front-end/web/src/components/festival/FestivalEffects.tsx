'use client';

import { useEffect } from 'react';
import { useFestival } from './FestivalThemeContext';
import { loadEngine, prefersReducedMotion, stopEngine } from './loadEngine';
import { CART_ADD_INTENT_EVENT } from '@/lib/festival/events';

/** A tap this recent is taken as the origin of an add-to-cart. */
const POINTER_FRESH_MS = 1500;

/**
 * Primary actions that get a 0.5s tap sparkle: product links and tiles,
 * category tiles, and anything opted in with data-festive-tap (Buy now).
 */
const TAP_SELECTOR = '[data-festive-tap], a.st-tile, a[href^="/products/"], a[href^="/categories/"]';

/**
 * Wires the festival's interaction effects. Renders nothing.
 *
 * This file is tiny on purpose and is all that ships in the main bundle: it
 * remembers where the last tap was, and the engine itself is imported only
 * after the browser goes idle (and only while a festival is live, outside the
 * checkout/admin routes — useFestival() already returns null there).
 */
export default function FestivalEffects() {
  const festival = useFestival();
  const tokens = festival?.tokens ?? null;

  useEffect(() => {
    if (!tokens || prefersReducedMotion()) return;

    let lastTap: { x: number; y: number; at: number } | null = null;
    let cancelled = false;

    // Warm the chunk once the page is idle, so the first add is instant.
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const warm = () => { if (!cancelled) void loadEngine(tokens); };
    const hasIdle = typeof w.requestIdleCallback === 'function';
    const idleId = hasIdle ? w.requestIdleCallback!(warm, { timeout: 4000 }) : window.setTimeout(warm, 2000);

    const onPointerDown = (e: PointerEvent) => {
      lastTap = { x: e.clientX, y: e.clientY, at: Date.now() };
      const target = e.target as Element | null;
      if (target?.closest?.(TAP_SELECTOR)) {
        void loadEngine(tokens).then((engine) => engine?.sparkle(e.clientX, e.clientY));
      }
    };

    const onCartAdd = () => {
      // Never animate over a payment sheet.
      if (document.querySelector('.razorpay-container')) return;
      const tap = lastTap && Date.now() - lastTap.at < POINTER_FRESH_MS ? lastTap : null;
      if (!tap) return; // a programmatic add (merge, "buy again" link) gets no effect
      void loadEngine(tokens).then((engine) => {
        if (!engine || cancelled) return;
        engine.burst(tap.x, tap.y);
        void engine.flyToCart(tap.x, tap.y);
      });
    };

    document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
    window.addEventListener(CART_ADD_INTENT_EVENT, onCartAdd);
    return () => {
      cancelled = true;
      stopEngine();
      if (hasIdle) w.cancelIdleCallback?.(idleId);
      else window.clearTimeout(idleId);
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener(CART_ADD_INTENT_EVENT, onCartAdd);
    };
  }, [tokens]);

  return null;
}
