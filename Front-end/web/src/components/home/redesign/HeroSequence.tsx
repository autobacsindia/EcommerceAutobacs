'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import Img from './Img';
import {
  hero,
  heroSequence,
  heroSequenceMobile,
  type HeroSequenceConfig,
} from './homeContent';

/** Must match the breakpoint that switches the pinned-hero layout in home-redesign.css. */
export const DESKTOP_MEDIA_QUERY = '(min-width: 769px)';

/**
 * Set on the pin wrapper once the sequence is actually running. Everything that
 * only makes sense while scrubbing — the tall scroll track, the sticky hero, the
 * canvas itself — hangs off this class, so a device that opts out (reduced
 * motion, data saver, tiny RAM) keeps the plain stacked hero instead of a dead
 * pin with a blank canvas in it.
 */
export const ACTIVE_CLASS = 'hero-seq-active';

/**
 * Below this the URL bar collapsing/expanding is assumed to be the cause of an
 * `innerHeight` change, not a real viewport change. Mobile browsers resize the
 * visual viewport by ~60-100px mid-scroll; feeding that into the scrub distance
 * makes the animation jump under the user's thumb.
 */
const URL_BAR_TOLERANCE_PX = 140;

/** Parallel frame fetches. Enough to saturate a connection, few enough to not stampede HTTP/1.1. */
const CONCURRENCY = 6;

export type DeviceSignals = {
  isDesktop: boolean;
  reducedMotion: boolean;
  saveData: boolean;
  /** navigator.deviceMemory in GB; undefined outside Chromium — don't penalize. */
  deviceMemory?: number;
};

/**
 * Which frame set to scrub, or `null` to stay on the static image.
 *
 * Pure so it can be unit-tested; the effect only supplies the signals. Phones
 * get their own decimated set rather than the desktop one — see the memory note
 * on `heroSequenceMobile`.
 */
export function pickSequence(signals: DeviceSignals): HeroSequenceConfig | null {
  if (signals.reducedMotion) return null;
  if (signals.saveData) return null;
  const mem = signals.deviceMemory;
  if (typeof mem === 'number' && mem > 0 && mem < 2) return null;
  return signals.isDesktop ? heroSequence : heroSequenceMobile;
}

export function readDeviceSignals(win: Window): DeviceSignals {
  const nav = win.navigator as Navigator & {
    connection?: { saveData?: boolean };
    deviceMemory?: number;
  };
  return {
    isDesktop: win.matchMedia(DESKTOP_MEDIA_QUERY).matches,
    reducedMotion: win.matchMedia('(prefers-reduced-motion: reduce)').matches,
    saveData: nav.connection?.saveData === true,
    deviceMemory: nav.deviceMemory,
  };
}

/**
 * Scroll-driven hero animation. Renders a <canvas> that scrubs through a WebP
 * frame sequence based on how far the user has scrolled past the hero (frame 0
 * at the top, last frame as the pinned hero releases).
 *
 * Production guard rails:
 *   - Mobile runs a SEPARATE, decimated frame set (49 x 720x404 instead of
 *     145 x 1440x808). Every decoded frame is held for the life of the section,
 *     so the desktop set would sit at ~674 MB of ImageBitmap memory — past what
 *     iOS Safari kills a tab over. The mobile set is ~57 MB and ~0.64 MB on the
 *     wire.
 *   - Reduced-motion, data-saver and sub-2 GB devices never fetch a frame; CSS
 *     keeps the static `hero.image` because the ACTIVE_CLASS is never applied.
 *   - Frames are preloaded with bounded concurrency (the first frame alone
 *     first, so the LCP paint isn't queued behind five others), decoded off the
 *     main thread as ImageBitmaps, and missing frames fall back to the nearest
 *     loaded one so the canvas is never blank.
 *   - Scroll is sampled inside a single rAF, the canvas is sized to a capped
 *     devicePixelRatio, the viewport height is cached against URL-bar chrome,
 *     and the scroll listener is only attached while the hero is near screen.
 */
export default function HeroSequence({
  sectionRef,
}: {
  sectionRef: RefObject<HTMLElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Starts true so SSR and the first client render always include the static
  // image (no hydration mismatch, and it is the paint until frame 1 lands).
  // Dropped once a real frame is on the canvas, which also cancels its download
  // on the mobile path where it would otherwise be pure waste behind display:none.
  const [showFallback, setShowFallback] = useState(true);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    const sectionEl = sectionRef.current;
    if (!canvasEl || !sectionEl) return;
    // Non-null aliases: TS doesn't preserve the guard narrowing inside the
    // closures below, so pin the types here once.
    const canvas: HTMLCanvasElement = canvasEl;
    const section: HTMLElement = sectionEl;

    const signals = readDeviceSignals(window);
    const picked = pickSequence(signals);
    if (!picked) return;
    const config: HeroSequenceConfig = picked;

    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    const ctx: CanvasRenderingContext2D = ctx2d;

    const { dir, prefix, ext, count, pad } = config;
    const frameUrl = (i: number) =>
      `${dir}/${prefix}${String(i + 1).padStart(pad, '0')}.${ext}`;

    // ImageBitmaps are decoded off the main thread (see loadNext), so drawing a
    // frame never triggers a synchronous WebP decode inside the scroll frame —
    // that sync decode was the source of the first-scroll stutter.
    const images: (ImageBitmap | null)[] = new Array(count).fill(null);
    let currentIndex = -1;
    let targetIndex = 0;
    let cancelled = false;
    // Cached so URL-bar chrome can't rewrite the scrub distance mid-scroll.
    let viewportHeight = window.innerHeight;
    const viewportTolerance = signals.isDesktop ? 0 : URL_BAR_TOLERANCE_PX;

    function nearestLoaded(i: number): ImageBitmap | null {
      if (images[i]) return images[i];
      for (let d = 1; d < count; d++) {
        if (i - d >= 0 && images[i - d]) return images[i - d];
        if (i + d < count && images[i + d]) return images[i + d];
      }
      return null;
    }

    function drawCover(img: ImageBitmap) {
      const cw = canvas.width;
      const ch = canvas.height;
      const imgRatio = img.width / img.height;
      const canvasRatio = cw / ch;
      let dw: number;
      let dh: number;
      if (imgRatio > canvasRatio) {
        dh = ch;
        dw = ch * imgRatio;
      } else {
        dw = cw;
        dh = cw / imgRatio;
      }
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    }

    function render() {
      const img = nearestLoaded(targetIndex);
      if (img) {
        drawCover(img);
        currentIndex = targetIndex;
      }
    }

    // Switch the layout on only once a real frame is on the canvas. Doing it
    // earlier (on mount, or in a media query) leaves a blank canvas over the
    // whole first paint and, if the frames never arrive at all, forever — this
    // way a failed fetch degrades to the static hero instead of an empty stage.
    let activated = false;
    function activate() {
      if (activated) return;
      activated = true;
      section.classList.add(ACTIVE_CLASS);
      setShowFallback(false);
      // The canvas was display:none until the class landed, so it had no box to
      // measure; size it against the real one now and repaint.
      resize();
      computeTarget();
      render();
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssWidth = canvas.clientWidth || config.naturalWidth;
      const cssHeight = cssWidth * (config.naturalHeight / config.naturalWidth);
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      const img = nearestLoaded(currentIndex < 0 ? 0 : currentIndex);
      if (img) drawCover(img);
    }

    function computeTarget() {
      // `section` is the tall pin wrapper; the hero sticks for its full height.
      // The scrub distance is therefore wrapper height minus one viewport — the
      // frames reach the last one exactly as the sticky hero releases. Uses the
      // cached viewport height, NOT window.innerHeight, so a collapsing mobile
      // URL bar doesn't shift the distance out from under an in-progress scrub.
      const rect = section.getBoundingClientRect();
      const distance = Math.max(section.offsetHeight - viewportHeight, 1);
      const scrolled = Math.min(Math.max(-rect.top, 0), distance);
      const progress = scrolled / distance;
      targetIndex = Math.min(count - 1, Math.round(progress * (count - 1)));
    }

    let ticking = false;

    /*
      Recompute which frame the current scroll position calls for, throttled to
      one rAF. Deliberately does NOT touch the preload: the IntersectionObserver
      below calls this once on attach to prime the first frame, and the hero is
      on screen at load, so anything triggered from here effectively runs at
      mount. Wiring the preload into this path is exactly what made the 5 s
      mobile delay a no-op — all 49 frames still began inside 300 ms.
    */
    function syncToScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        computeTarget();
        if (targetIndex !== currentIndex) render();
      });
    }

    /* Real scroll events only — a genuine signal that the user is scrubbing, so
       the remaining frames are wanted NOW rather than after the idle delay. */
    function onScroll() {
      startBulkPreload();
      syncToScroll();
    }

    // Adopt a genuinely new viewport (rotation, desktop window resize) but
    // ignore the browser-chrome-sized changes a mobile scroll produces.
    function onViewportChange(force = false) {
      const h = window.innerHeight;
      if (!force && Math.abs(h - viewportHeight) <= viewportTolerance) return;
      viewportHeight = h;
      computeTarget();
      render();
    }
    const onWindowResize = () => onViewportChange(false);
    const onOrientationChange = () => onViewportChange(true);

    // --- bounded-concurrency progressive preload ---------------------------
    // fetch → blob → createImageBitmap decodes each frame OFF the main thread,
    // so by the time it lands in `images[]` it's a ready-to-blit bitmap and
    // drawCover never forces a synchronous decode during scroll.
    let nextToLoad = 0;
    const abort = new AbortController();
    async function loadOne(i: number): Promise<void> {
      try {
        const res = await fetch(frameUrl(i), { signal: abort.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bitmap = await createImageBitmap(await res.blob());
        if (cancelled) {
          bitmap.close();
          return;
        }
        images[i] = bitmap;
        // Draw immediately if this is the frame we currently want (or the very
        // first frame to arrive), so the hero is never blank.
        if (i === targetIndex || currentIndex < 0) {
          render();
          activate();
        }
      } catch {
        // Network/decode error or aborted teardown — skip this frame; render()
        // falls back to the nearest loaded one.
      }
    }
    async function loadNext(): Promise<void> {
      if (cancelled) return;
      const i = nextToLoad++;
      if (i >= count) return;
      await loadOne(i);
      return loadNext();
    }

    resize();
    computeTarget();
    // The first frame is the hero's first paint, so fetch it on its own before
    // opening the other lanes — otherwise LCP waits behind five frames nobody
    // can see yet.
    nextToLoad = 1;

    /*
      ── The other 144 frames wait for the page to finish its own work ─────────
      Frame 0 stays eager: it is what activate() hangs off, so deferring it would
      delay the pin/sticky layout switching on and widen the window where an
      early scroll behaves like a plain stacked hero.

      The REST used to open all six lanes the instant frame 0 resolved. On the
      desktop set that is ~4.87 MB of WebP plus 144 createImageBitmap decodes
      fired during the exact window the page is still fetching its own CSS, JS
      and product imagery — measured on the live home page as 4.92 MB / 145
      requests in a Lighthouse run that never scrolled a single pixel.

      Nothing above the fold needs them: the canvas shows frame 0 until the user
      starts scrolling. So they now start at whichever comes first —
        • the browser going idle after `load`, or
        • the first scroll, so a user who scrolls immediately is never starved.
      `nearestLoaded()` already covers a not-yet-arrived frame by drawing the
      closest one it has, so an in-progress preload degrades to a slightly
      coarser scrub rather than a blank canvas.
    */
    let bulkStarted = false;
    function startBulkPreload() {
      if (bulkStarted || cancelled) return;
      bulkStarted = true;
      for (let k = 0; k < CONCURRENCY; k++) void loadNext();
    }

    const idleWin = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let idleHandle = 0;
    let timeoutHandle = 0;

    /*
      Hanging the preload straight off `load` + requestIdleCallback was not
      enough. On a fast connection `load` fires early and the page is instantly
      idle, so the callback ran almost immediately — measured on the mobile
      profile, the frames still began at 229 ms and were the single largest
      payload on the page (745 KB, more than images, scripts and fonts
      combined). "Idle" is not the same thing as "the hero has finished".

      So the speculative fetch is now held for a fixed window after `load`. The
      user-driven path is unaffected: onScroll calls startBulkPreload() directly,
      so anyone who actually scrubs gets the frames at once; this delay only
      governs the fetch for someone still sitting at the top of the page.

      Mobile waits considerably longer. Its link is the scarce resource, its
      frame set is already decimated to 49, and a phone visitor who never
      scrolls should not spend ~745 KB of their data on an animation they never
      saw.
    */
    const bulkPreloadDelayMs = signals.isDesktop ? 2000 : 5000;
    function scheduleBulkPreload() {
      if (cancelled || bulkStarted) return;
      timeoutHandle = window.setTimeout(() => {
        if (cancelled || bulkStarted) return;
        // Idle is a nicety on top of the delay, never a substitute for it;
        // `timeout` guarantees it still runs on a page that never goes idle.
        if (typeof idleWin.requestIdleCallback === 'function') {
          idleHandle = idleWin.requestIdleCallback(startBulkPreload, { timeout: 3000 });
        } else {
          startBulkPreload();
        }
      }, bulkPreloadDelayMs);
    }

    void loadOne(0);
    if (document.readyState === 'complete') {
      scheduleBulkPreload();
    } else {
      window.addEventListener('load', scheduleBulkPreload, { once: true });
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    window.addEventListener('resize', onWindowResize, { passive: true });
    window.addEventListener('orientationchange', onOrientationChange);

    let scrollBound = false;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !scrollBound) {
          window.addEventListener('scroll', onScroll, { passive: true });
          scrollBound = true;
          // Prime the canvas at the current offset WITHOUT counting as a scroll.
          syncToScroll();
        } else if (!entry.isIntersecting && scrollBound) {
          window.removeEventListener('scroll', onScroll);
          scrollBound = false;
        }
      },
      { rootMargin: '100px' }
    );
    io.observe(section);

    return () => {
      cancelled = true;
      abort.abort();
      // Drop the deferred preload if the section unmounts before it fires.
      window.removeEventListener('load', scheduleBulkPreload);
      if (idleHandle && typeof idleWin.cancelIdleCallback === 'function') {
        idleWin.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle) window.clearTimeout(timeoutHandle);
      resizeObserver.disconnect();
      io.disconnect();
      window.removeEventListener('resize', onWindowResize);
      window.removeEventListener('orientationchange', onOrientationChange);
      if (scrollBound) window.removeEventListener('scroll', onScroll);
      section.classList.remove(ACTIVE_CLASS);
      // Release decoded-bitmap memory eagerly instead of waiting for GC.
      for (const bmp of images) bmp?.close();
    };
  }, [sectionRef]);

  return (
    <>
      <canvas ref={canvasRef} className="hero-seq" aria-hidden="true" />
      {/* Static hero until a real frame is drawn — and permanently for anyone
          the sequence opted out of, since ACTIVE_CLASS never lands there.

          ⚠ Intentionally the ONE <Img> on this page with no `sizes` — do not
          "fix" it for consistency. `priority` makes React 19 hoist a
          <link rel=preload> built from `src`; adding `sizes` would emit a
          srcSet that preload does not describe, so the browser can fetch the
          preloaded original AND a variant, paying for the hero twice on the
          most LCP-sensitive image we have. The source is already a 47 KB JPEG,
          so there is little to win and a double-download to lose. */}
      {showFallback && (
        <Img src={hero.image} alt={hero.imageAlt} className="hero-seq-fallback" priority />
      )}
    </>
  );
}
