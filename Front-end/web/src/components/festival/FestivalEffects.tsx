'use client';

import { useEffect } from 'react';
import { useFestival, useFestivalCursor } from './FestivalThemeContext';
import { loadEngine, prefersReducedMotion, stopEngine } from './loadEngine';
import type { FestivalEngine } from './effects/engine';
import { CART_ADD_INTENT_EVENT } from '@/lib/festival/events';

/** A tap this recent is taken as the origin of an add-to-cart. */
const POINTER_FRESH_MS = 1500;

/**
 * Primary actions that get a 0.5s tap sparkle: product links and tiles,
 * category tiles, and anything opted in with data-festive-tap (Buy now).
 */
const TAP_SELECTOR = '[data-festive-tap], a.st-tile, a[href^="/products/"], a[href^="/categories/"]';

/** The trail sheds sparks only after the mouse has moved this far (px)… */
const TRAIL_MIN_DISTANCE = 9;
/** …and at most once per this many ms (about one frame), whatever the mouse rate. */
const TRAIL_MIN_INTERVAL_MS = 16;

/** A real mouse — not a phone, tablet or pen, where a trail would only follow taps. */
export function hasFineHoverPointer(): boolean {
  try {
    return !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
  } catch {
    return false;
  }
}

/**
 * Pages style their own clickable things with a plain `cursor: pointer` (the
 * careers role cards, any Tailwind `cursor-pointer` div), and an element's own
 * cursor beats the diya it would otherwise inherit from <html>. Rather than
 * chase every page's CSS, tag the element the mouse is over with what the page
 * meant — 'hand' or 'base' — and let the festive CSS swap in the matching diya.
 *
 * Cheap: called on pointerover, which fires once per element entered, not per
 * move; a tagged element is skipped, and the CSS only applies under
 * html[data-festival], so stale tags are inert once the festival ends.
 */
export function tagPlainCursor(target: EventTarget | null): void {
  if (!(target instanceof Element)) return;
  const el = target as HTMLElement | SVGElement;
  if (!el.dataset || el.dataset.fxCursor) return;
  const cursor = window.getComputedStyle(el).cursor;
  if (cursor === 'pointer') el.dataset.fxCursor = 'hand';
  else if (cursor === 'default') el.dataset.fxCursor = 'base';
}

/**
 * Wires the festival's interaction effects. Renders nothing.
 *
 * This file is tiny on purpose and is all that ships in the main bundle: it
 * remembers where the last tap was, and the engine itself is imported only
 * after the browser goes idle (and only while a festival is live, outside the
 * checkout/sign-in routes). The staff panels get the cursor and its trail only:
 * useFestival() is null there, so tap sparkles and cart effects stay off.
 */
export default function FestivalEffects() {
  const tokens = useFestivalCursor();
  const fullEffects = useFestival() !== null;

  // The diya cursor is still, not motion, so it ignores reduced-motion — but it
  // is mouse-only, so phones and tablets never attach this listener.
  useEffect(() => {
    if (!tokens || !hasFineHoverPointer()) return;
    const onPointerOver = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') tagPlainCursor(e.target);
    };
    document.addEventListener('pointerover', onPointerOver, { capture: true, passive: true });
    return () => document.removeEventListener('pointerover', onPointerOver, { capture: true });
  }, [tokens]);

  useEffect(() => {
    if (!tokens || prefersReducedMotion()) return;

    let lastTap: { x: number; y: number; at: number } | null = null;
    let cancelled = false;
    // The loaded engine, once warm. The cursor trail never waits for the chunk:
    // until it arrives, mouse moves simply shed nothing.
    let engine: FestivalEngine | null = null;
    const trailOn = hasFineHoverPointer();
    let trailX = Number.NaN;
    let trailY = Number.NaN;
    let trailAt = 0;

    // Warm the chunk once the page is idle, so the first add is instant.
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const warm = () => {
      if (cancelled) return;
      void loadEngine(tokens).then((e) => { if (!cancelled) engine = e; });
    };
    const hasIdle = typeof w.requestIdleCallback === 'function';
    const idleId = hasIdle ? w.requestIdleCallback!(warm, { timeout: 4000 }) : window.setTimeout(warm, 2000);

    const onPointerDown = (e: PointerEvent) => {
      lastTap = { x: e.clientX, y: e.clientY, at: Date.now() };
      const target = e.target as Element | null;
      if (target?.closest?.(TAP_SELECTOR)) {
        void loadEngine(tokens).then((engine) => engine?.sparkle(e.clientX, e.clientY));
      }
    };

    // Cursor sparkle trail: throttled by distance and time, so a fast mouse
    // costs at most one tiny particle push per frame. Passive, never blocks.
    const onPointerMove = (e: PointerEvent) => {
      if (!engine || e.pointerType !== 'mouse') return;
      const dx = e.clientX - trailX;
      const dy = e.clientY - trailY;
      if (e.timeStamp - trailAt < TRAIL_MIN_INTERVAL_MS) return;
      if (dx * dx + dy * dy < TRAIL_MIN_DISTANCE * TRAIL_MIN_DISTANCE) return;
      trailX = e.clientX;
      trailY = e.clientY;
      trailAt = e.timeStamp;
      engine.trail(e.clientX, e.clientY);
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

    if (fullEffects) {
      document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
      window.addEventListener(CART_ADD_INTENT_EVENT, onCartAdd);
    }
    if (trailOn) document.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      cancelled = true;
      stopEngine();
      if (hasIdle) w.cancelIdleCallback?.(idleId);
      else window.clearTimeout(idleId);
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
      document.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener(CART_ADD_INTENT_EVENT, onCartAdd);
    };
  }, [tokens, fullEffects]);

  return null;
}
