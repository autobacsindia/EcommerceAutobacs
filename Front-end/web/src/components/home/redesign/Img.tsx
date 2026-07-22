'use client';

/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';
import { cloudinarySrcSet } from '@/lib/cloudinarySrcSet';

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
 * opt a Cloudinary-hosted image into a responsive `srcSet` — the plain-<img>
 * equivalent of what next/image gives its optimized images. Without it the
 * <img> ships a single fixed width to every device. Callers that omit `sizes`
 * are unchanged. Non-Cloudinary URLs never get a srcSet (helper returns
 * undefined), so Unsplash placeholders keep their own `?w=` sizing.
 */
export default function Img({
  src,
  alt,
  className,
  draggable,
  priority = false,
  sizes,
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

  const srcSet = sizes ? cloudinarySrcSet(src) : undefined;

  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      className={className}
      draggable={draggable}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
