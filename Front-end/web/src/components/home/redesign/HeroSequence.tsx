'use client';

import { useEffect, useRef, type RefObject } from 'react';
import Img from './Img';
import { hero, heroSequence } from './homeContent';

/**
 * Scroll-driven hero animation. Renders a <canvas> that scrubs through the
 * `heroSequence` WebP frames based on how far the user has scrolled past the
 * hero (frame 0 at the top, last frame as the hero leaves the viewport).
 *
 * Production guard rails:
 *   - Desktop + motion only. On mobile or `prefers-reduced-motion` we bail out
 *     of the effect entirely (no frame fetching) and CSS shows the static
 *     `hero.image` fallback instead — phones never pay for the sequence.
 *   - Frames are preloaded with bounded concurrency so we don't open 145
 *     connections at once (matters on HTTP/1.1); the first frame is drawn as
 *     soon as it arrives, and missing frames fall back to the nearest loaded
 *     one so the canvas is never blank.
 *   - Scroll is sampled inside a single rAF (coalesced), the canvas is sized to
 *     a capped devicePixelRatio, and the scroll listener is only attached while
 *     the hero is on/near screen (IntersectionObserver).
 */
export default function HeroSequence({
  sectionRef,
}: {
  sectionRef: RefObject<HTMLElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    const sectionEl = sectionRef.current;
    if (!canvasEl || !sectionEl) return;
    // Non-null aliases: TS doesn't preserve the guard narrowing inside the
    // closures below, so pin the types here once.
    const canvas: HTMLCanvasElement = canvasEl;
    const section: HTMLElement = sectionEl;

    // Desktop + motion only — keep this in sync with the CSS breakpoint that
    // toggles .hero-seq / .hero-seq-fallback in home-redesign.css.
    if (
      !window.matchMedia('(min-width: 769px)').matches ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    const ctx: CanvasRenderingContext2D = ctx2d;

    const { dir, prefix, ext, count, pad } = heroSequence;
    const frameUrl = (i: number) =>
      `${dir}/${prefix}${String(i + 1).padStart(pad, '0')}.${ext}`;

    // ImageBitmaps are decoded off the main thread (see loadNext), so drawing a
    // frame never triggers a synchronous WebP decode inside the scroll frame —
    // that sync decode was the source of the first-scroll stutter.
    const images: (ImageBitmap | null)[] = new Array(count).fill(null);
    let currentIndex = -1;
    let targetIndex = 0;
    let cancelled = false;

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

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssWidth = canvas.clientWidth || heroSequence.naturalWidth;
      const cssHeight =
        cssWidth * (heroSequence.naturalHeight / heroSequence.naturalWidth);
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      const img = nearestLoaded(currentIndex < 0 ? 0 : currentIndex);
      if (img) drawCover(img);
    }

    function computeTarget() {
      // `section` is the tall pin wrapper; the hero sticks for its full height.
      // The scrub distance is therefore wrapper height minus one viewport — the
      // frames reach the last one exactly as the sticky hero releases.
      const rect = section.getBoundingClientRect();
      const distance = Math.max(section.offsetHeight - window.innerHeight, 1);
      const scrolled = Math.min(Math.max(-rect.top, 0), distance);
      const progress = scrolled / distance;
      targetIndex = Math.min(count - 1, Math.round(progress * (count - 1)));
    }

    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        computeTarget();
        if (targetIndex !== currentIndex) render();
      });
    }

    // --- bounded-concurrency progressive preload ---------------------------
    // fetch → blob → createImageBitmap decodes each frame OFF the main thread,
    // so by the time it lands in `images[]` it's a ready-to-blit bitmap and
    // drawCover never forces a synchronous decode during scroll.
    let nextToLoad = 0;
    const CONCURRENCY = 6;
    const abort = new AbortController();
    async function loadNext(): Promise<void> {
      if (cancelled) return;
      const i = nextToLoad++;
      if (i >= count) return;
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
        if (i === targetIndex || currentIndex < 0) render();
      } catch {
        // Network/decode error or aborted teardown — skip this frame; render()
        // falls back to the nearest loaded one.
      }
      return loadNext();
    }

    resize();
    computeTarget();
    for (let k = 0; k < CONCURRENCY; k++) loadNext();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    let scrollBound = false;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !scrollBound) {
          window.addEventListener('scroll', onScroll, { passive: true });
          scrollBound = true;
          onScroll();
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
      resizeObserver.disconnect();
      io.disconnect();
      if (scrollBound) window.removeEventListener('scroll', onScroll);
      // Release decoded-bitmap memory eagerly instead of waiting for GC.
      for (const bmp of images) bmp?.close();
    };
  }, [sectionRef]);

  return (
    <>
      <canvas ref={canvasRef} className="hero-seq" aria-hidden="true" />
      {/* Mobile / reduced-motion fallback — toggled via CSS, not JS, so SSR is
          deterministic and the canvas path never affects hydration. */}
      <Img src={hero.image} alt={hero.imageAlt} className="hero-seq-fallback" priority />
    </>
  );
}
