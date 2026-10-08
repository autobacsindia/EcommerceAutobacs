'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
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
 * Set on the pin wrapper when the device WILL run the sequence — the pinned
 * LAYOUT, as opposed to ACTIVE_CLASS's canvas swap. Decided before the first
 * paint (HERO_LAYOUT_SCRIPT, rendered by Hero.tsx), so the hero is drawn in its
 * final layout from the start.
 *
 * It used to share ACTIVE_CLASS, which lands only once frame 0 is decoded: the
 * stacked hero painted first and the whole stage then jumped. Measured on the
 * live home page (412px, 4x CPU): CLS 0.44-0.77, the largest single cost in the
 * mobile Lighthouse score.
 */
export const LAYOUT_CLASS = 'hero-seq-layout';

/**
 * Runs during HTML parse, as the first child of .hero-pin, before anything in the
 * hero is painted. Mirrors pickSequence()'s opt-outs exactly (both layouts are
 * pinned, so the breakpoint does not matter here) — HeroSequence.test.tsx runs
 * this string against every signal combination to hold the two together.
 *
 * Plain ES5 in a try/catch: if it fails or is blocked, the layout effect below
 * still applies the class, merely after hydration (the old behaviour).
 */
export const HERO_LAYOUT_SCRIPT =
  "(function(){try{var s=document.currentScript,p=s&&s.parentElement;if(!p)return;"
  + "var w=window,n=w.navigator,c=n.connection,m=n.deviceMemory;"
  + "if(w.matchMedia&&w.matchMedia('(prefers-reduced-motion: reduce)').matches)return;"
  + "if(c&&c.saveData===true)return;"
  + "if(typeof m==='number'&&m>0&&m<2)return;"
  + `p.classList.add('${LAYOUT_CLASS}')}catch(e){}})();`;

/**
 * Playback rate. Desktop plays its 145 frames in ~4.8 s; phones play their
 * decimated 49 in ~3 s — the same motion, slightly brisker on the smaller set.
 */
const DESKTOP_FPS = 30;
const MOBILE_FPS = 16;

/** Pause after the page's `load` before the car starts moving. */
const START_DELAY_MS = 300;

/** How long the fully exploded build is held before it reassembles. */
const EXPLODED_HOLD_MS = 900;

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
 * Puts the pinned-layout class on the pin wrapper before paint, on every render
 * path: on a client-side navigation (where the inline script never runs — React
 * does not execute scripts it inserts), and it removes the class if the inline
 * script and pickSequence() ever disagree. A layout effect, so neither case paints
 * the wrong layout first.
 *
 * ⚠ Call it from the component that OWNS the wrapper's ref (Hero), not from
 * HeroSequence. Layout effects run child-first, and a parent element's ref is
 * attached after its children's layout effects — so inside HeroSequence the ref is
 * still null on mount and this would silently do nothing. A test pins this.
 */
export function useHeroLayoutClass(pinRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const pin = pinRef.current;
    if (!pin) return;
    if (pickSequence(readDeviceSignals(window))) pin.classList.add(LAYOUT_CLASS);
    else pin.classList.remove(LAYOUT_CLASS);
  }, [pinRef]);
}

/**
 * Hero animation. Renders a <canvas> that plays a WebP frame sequence ONCE, on
 * its own, after the page has loaded: forward (the car comes apart), a short hold,
 * then in reverse (it reassembles), resting on the complete car. It never
 * listens to scroll: the page scrolls normally the whole time (see "Playback"
 * below for why it stopped being scroll-scrubbed).
 *
 * Production guard rails:
 *   - Mobile runs a SEPARATE, decimated frame set (49 x 720x404 instead of
 *     145 x 1440x808). Every decoded frame is held for the life of the section,
 *     so the desktop set would sit at ~674 MB of ImageBitmap memory — past what
 *     iOS Safari kills a tab over. The mobile set is ~57 MB and ~0.64 MB on the
 *     wire.
 *   - Reduced-motion, data-saver and sub-2 GB devices never fetch a frame; CSS
 *     keeps the static `hero.image` because the classes are never applied.
 *   - Frame 0 is fetched alone and early (it replaces the still photo); the rest
 *     wait for the page's `load`, then load with bounded concurrency, decoded off
 *     the main thread as ImageBitmaps.
 *   - Playback buffers on a frame that has not arrived, skips one that failed,
 *     and pauses while the hero is off screen.
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

    // ImageBitmaps are decoded off the main thread (see loadOne), so drawing a
    // frame never forces a synchronous WebP decode inside an animation frame.
    const images: (ImageBitmap | null)[] = new Array(count).fill(null);
    // A frame that failed for good (404, decode error). Playback steps over it
    // rather than waiting for it forever.
    const failed: boolean[] = new Array(count).fill(false);
    let currentIndex = -1;
    let cancelled = false;

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

    function show(i: number) {
      const img = images[i];
      if (!img) return;
      drawCover(img);
      currentIndex = i;
    }

    // Swap the still photo for the canvas only once a real frame is on it, so
    // the stage is never blank — and a failed fetch degrades to the photo.
    let activated = false;
    function activate() {
      if (activated) return;
      activated = true;
      section.classList.add(LAYOUT_CLASS);
      section.classList.add(ACTIVE_CLASS);
      setShowFallback(false);
      // The canvas was display:none until the class landed, so it had no box to
      // measure; size it against the real one now and repaint.
      resize();
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssWidth = canvas.clientWidth || config.naturalWidth;
      const cssHeight = cssWidth * (config.naturalHeight / config.naturalWidth);
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      if (currentIndex >= 0) show(currentIndex);
    }

    // --- bounded-concurrency progressive preload ---------------------------
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
        if (currentIndex < 0) {
          show(i);
          activate();
        }
      } catch {
        if (cancelled) return;
        failed[i] = true;
        // Frame 0 is different: the pinned layout went on before the first paint
        // on the promise of a sequence. If its first frame cannot arrive, fall back
        // to the stacked hero rather than an empty stage. (One shift, on a failure
        // path only; a later frame that does land re-applies it via activate().)
        if (i === 0 && !activated) section.classList.remove(LAYOUT_CLASS);
      }
    }
    async function loadNext(): Promise<void> {
      if (cancelled) return;
      const i = nextToLoad++;
      if (i >= count) return;
      await loadOne(i);
      return loadNext();
    }

    /*
      ── Playback: time-driven, never scroll-driven ─────────────────────────────
      This used to scrub the frames against scroll position inside a 300vh (180vh on
      phones) sticky track, so the page stopped moving under the visitor's scroll
      while the car played. Customers read that as the site being stuck.

      Now the sequence plays ONCE on its own, like a short video: the car comes
      apart (frame 0 → last), holds on the exploded build, then reassembles (last →
      frame 0) and rests on the complete car. The page scrolls normally the whole
      time; nothing here listens to scroll at all. It advances only onto frames that have arrived (a slow link
      buffers instead of skipping to a blank), steps over frames that failed for
      good, and pauses while the hero is off screen so it never burns CPU unseen.
    */
    const fps = signals.isDesktop ? DESKTOP_FPS : MOBILE_FPS;
    const step = 1000 / fps;
    // Position along the forward-then-back path: 0..lastIdx is the car coming
    // apart, lastIdx..2*lastIdx is it coming back together.
    const lastIdx = count - 1;
    const endPos = 2 * lastIdx;
    const frameAt = (p: number) => (p <= lastIdx ? p : endPos - p);
    let pos = 0;
    let frame = 0;
    let holdUntil = 0;
    let last = 0;
    let raf = 0;
    let visible = true;
    let started = false;
    let finished = false;

    /** Next position whose frame did not fail for good (endPos + 1 = done). */
    const nextPlayable = (from: number) => {
      let p = from + 1;
      while (p <= endPos && failed[frameAt(p)]) p += 1;
      return p;
    };

    function tick(now: number) {
      raf = 0;
      if (cancelled || finished || !visible) return;
      // A long gap (tab in the background, a slow frame) must not fast-forward
      // through dozens of frames in one go.
      if (!last || now - last > step * 4) last = now - step;
      // Pause on the fully exploded build before it comes back together.
      if (holdUntil) {
        if (now < holdUntil) {
          raf = requestAnimationFrame(tick);
          return;
        }
        holdUntil = 0;
        last = now - step;
      }
      while (now - last >= step) {
        const p = nextPlayable(pos);
        if (p > endPos) {
          finished = true;
          break;
        }
        const n = frameAt(p);
        if (!images[n]) {
          last = now; // buffering: hold the clock until the frame arrives
          break;
        }
        pos = p;
        frame = n;
        last += step;
        if (pos === lastIdx) {
          holdUntil = now + EXPLODED_HOLD_MS;
          break;
        }
      }
      if (frame !== currentIndex) show(frame);
      if (!finished) raf = requestAnimationFrame(tick);
    }
    function play() {
      if (cancelled || finished || raf || !visible || !started) return;
      last = 0;
      raf = requestAnimationFrame(tick);
    }
    function pause() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    // Start after the page's own load, so the frames never compete with the
    // HTML, CSS, JS and product images for the first paint.
    function start() {
      if (cancelled || started) return;
      started = true;
      for (let k = 0; k < CONCURRENCY; k++) void loadNext();
      timeoutHandle = window.setTimeout(play, START_DELAY_MS);
    }
    let timeoutHandle = 0;

    resize();
    // Frame 0 alone first: it is what activate() hangs off.
    nextToLoad = 1;
    void loadOne(0);
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    // Pause while the hero is off screen; resume (from where it was) on return.
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) play();
      else pause();
    });
    io.observe(section);

    return () => {
      cancelled = true;
      abort.abort();
      pause();
      window.removeEventListener('load', start);
      if (timeoutHandle) window.clearTimeout(timeoutHandle);
      resizeObserver.disconnect();
      io.disconnect();
      section.classList.remove(ACTIVE_CLASS);
      section.classList.remove(LAYOUT_CLASS);
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
