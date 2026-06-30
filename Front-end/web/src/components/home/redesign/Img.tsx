'use client';

/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';

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
 */
export default function Img({
  src,
  alt,
  className,
  draggable,
}: {
  src?: string;
  alt: string;
  className?: string;
  draggable?: boolean;
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

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      draggable={draggable}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
