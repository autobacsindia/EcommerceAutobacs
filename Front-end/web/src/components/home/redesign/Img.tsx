'use client';

/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';
import { cloudinarySrcSet } from '@/lib/cloudinarySrcSet';
import { r2SrcSet } from '@/lib/r2SrcSet';

/**
 * Plain <img> with graceful degradation for the redesign.
 *
 * Assets are user-supplied and may not exist yet (see homeContent.ts). If the
 * `src` is empty or fails to load, we render a subtle gradient placeholder that
 * keeps the layout intact instead of a broken-image icon.
 *
 * We use a native <img> (not next/image) on purpose: these are decorative,
 * swappable placeholders, and it sidesteps next.config remote-host allowlisting
 * while the real artwork is still being sourced.
 *
 * RESPONSIVE: pass `sizes` (the CSS width the image occupies, e.g. "100vw") to
 * opt an R2- or Cloudinary-hosted image into a responsive `srcSet` — the
 * plain-<img> equivalent of what next/image gives its optimized images. Without
 * it the <img> ships a single fixed width to every device. Callers that omit
 * `sizes` are unchanged. URLs on neither host never get a srcSet (both helpers
 * return undefined), so Unsplash placeholders keep their own `?w=` sizing.
 *
 * ⚠ R2 is tried FIRST and is the live path — the catalog has moved there, and
 * `cloudinarySrcSet` returns undefined for an R2 URL. That silent miss is why
 * the nav logo shipped a 254 KB PNG into a 125x48 box (its w128 AVIF variant is
 * 5.8 KB) and became the home page's LCP element. Cloudinary stays as the
 * second branch for as long as any document still holds a legacy URL.
 *
 * ⚠ srcSet is still gated on `sizes` being passed, deliberately. React 19 hoists
 * a <link rel=preload> for a `priority` image from its `src`; emitting a srcSet
 * the preload does not know about risks the browser fetching one width and
 * painting another. Opting in per call site keeps that decision explicit.
 */
export default function Img({
  src,
  alt,
  className,
  draggable,
  priority = false,
  sizes,
  width,
  height,
}: {
  src?: string;
  alt: string;
  className?: string;
  draggable?: boolean;
  /**
   * Above-the-fold / LCP image: load eagerly with high fetch priority instead of
   * the default lazy. Use for the hero — a lazy-loaded LCP element is a top cause
   * of poor mobile LCP.
   */
  priority?: boolean;
  /**
   * CSS width the image renders at (the `sizes` attribute, e.g. "100vw" for a
   * full-bleed image). Presence enables a responsive Cloudinary `srcSet` so the
   * browser downloads a variant matched to the viewport × DPR instead of one
   * fixed width. No-op for non-Cloudinary sources.
   */
  sizes?: string;
  /**
   * INTRINSIC pixel dimensions of the source file — not the rendered size.
   *
   * Supplying both lets the browser derive an aspect-ratio and reserve the right
   * box before the bytes arrive, instead of collapsing to zero height and
   * reflowing on load (Lighthouse `unsized-images`; a CLS source). CSS still
   * decides the rendered size, so `.logo-img { height: 48px; width: auto }`
   * keeps winning — these only supply the ratio.
   */
  width?: number;
  height?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={className}
        role="img"
        aria-label={alt}
        style={{
          background:
            'linear-gradient(135deg, #1a1c1c 0%, #222524 50%, #15211f 100%)',
        }}
      />
    );
  }

  const srcSet = sizes ? (r2SrcSet(src) ?? cloudinarySrcSet(src)) : undefined;

  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      width={width}
      height={height}
      className={className}
      draggable={draggable}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
