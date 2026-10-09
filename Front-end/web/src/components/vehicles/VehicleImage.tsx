'use client';

import { useEffect, useRef, useState } from 'react';
import { cloudinarySrcSet, CARD_WIDTHS } from '@/lib/cloudinarySrcSet';

/**
 * A vehicle photo, or — when the vehicle has none, or it fails to load — a branded
 * placeholder (car outline + make), never the browser's broken-image icon.
 *
 * Why the effect: an <img> that errors before React hydrates never fires our
 * onError, so a server-rendered or cached failure would stay broken. Checking
 * `complete && naturalWidth === 0` after mount catches that case.
 */
export default function VehicleImage({
  src,
  alt,
  make,
  sizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw',
  className = '',
}: {
  src?: string | null;
  alt: string;
  make?: string;
  sizes?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setFailed(false);
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);

  if (!src || failed) {
    return (
      <div className="sp-vph" role="img" aria-label={alt}>
        <svg viewBox="0 0 120 56" width="62%" aria-hidden="true">
          <path
            d="M10 40h100M14 40l6-14c1.5-3.5 4-5 7.5-5h29c3 0 5.5 1.2 7.6 3.4L76 26h18c6 0 10.5 3 12 8l2 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="32" cy="41" r="7" fill="#fff" stroke="currentColor" strokeWidth="3" />
          <circle cx="88" cy="41" r="7" fill="#fff" stroke="currentColor" strokeWidth="3" />
        </svg>
        {make && <span className="sp-vph-make">{make}</span>}
        <span className="sp-vph-note">Photo coming soon</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src}
      srcSet={cloudinarySrcSet(src, CARD_WIDTHS)}
      sizes={sizes}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
