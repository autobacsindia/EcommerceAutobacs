'use client';

import Image from 'next/image';
import { useState, useEffect, useRef } from 'react';

interface EnhancedImageProps extends Omit<React.ComponentProps<typeof Image>, 'src' | 'alt'> {
  src: string | null | undefined;
  alt: string;
  fallbackSrc?: string;
  context?: 'product' | 'category' | 'profile' | 'generic';
}

export default function EnhancedImage({
  src,
  alt,
  width,
  height,
  priority = false,
  className = '',
  fallbackSrc,
  context = 'generic',
  ...props
}: EnhancedImageProps) {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Reset error state when src changes
  useEffect(() => {
    setImageError(false);
    setImageLoaded(false);
  }, [src]);

  // Get appropriate fallback image based on context
  const getDefaultFallback = (): string => {
    switch (context) {
      case 'product':
        return '/images/fallback-product.png';
      case 'category':
        return '/images/fallback-category.png';
      case 'profile':
        return '/images/fallback-profile.png';
      default:
        return '/images/fallback-generic.png';
    }
  };

  // Validate if the image source is valid
  const isValidImageSource = (source: string | null | undefined): boolean => {
    // Check if source is null, undefined, or empty string
    if (!source || source === '') {
      return false;
    }

    // Check if it's a placeholder/example URL
    if (source.includes('example.com') || source.includes('placeholder')) {
      return false;
    }

    // Basic URL validation
    try {
      const urlObj = new URL(source.startsWith('http') ? source : `http://example.com${source}`);
      // Reject non-HTTP(S) protocols (data:, blob:, file:, etc.)
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return false;
      }
      return true;
    } catch {
      // If it's not a valid URL, it might be a relative path which is okay
      return source.trim().length > 0;
    }
  };

  // Determine the final source to use
  const getImageSource = (): string => {
    // If explicit fallback is provided, use it
    if (fallbackSrc && !isValidImageSource(src)) {
      return fallbackSrc;
    }

    // If src is valid, use it
    if (isValidImageSource(src)) {
      return src as string;
    }

    // Use context-appropriate fallback
    return getDefaultFallback();
  };

  const finalSrc = getImageSource();

  // When the resolved source changes on an already-mounted <img>, the ref
  // callback won't re-run, so reconcile against the live element here too.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete) {
      if (img.naturalWidth === 0) {
        setImageError(true);
      } else {
        setImageLoaded(true);
      }
    }
  }, [finalSrc]);

  // If we don't have a valid source even after fallback, don't render the image
  if (!finalSrc || finalSrc === '') {
    return (
      <div 
        className={`flex items-center justify-center bg-obsidian-raised ${className}`}
        style={{ width: width || 200, height: height || 200 }}
      >
        <span className="text-ink-muted text-sm">No image</span>
      </div>
    );
  }

  // For invalid URLs or when image fails to load, show fallback UI
  if (imageError) {
    return (
      <div 
        className={`flex items-center justify-center bg-obsidian-raised ${className}`}
        style={{ width: width || 200, height: height || 200 }}
      >
        <span className="text-ink-muted text-sm">Image unavailable</span>
      </div>
    );
  }

  // Ensure we always have width and height for Next.js Image component unless fill is used
  const isFill = props.fill === true;
  const imageWidth = !isFill ? (width || 200) : undefined;
  const imageHeight = !isFill ? (height || 200) : undefined;

  // Sharpness on high-DPR (Retina/4K/scaled) displays — WITHOUT over-fetching.
  //
  // Two very different cases share this component:
  //
  //   (a) CSS-STRETCHED images: the caller passes no width/height (we fall back
  //       to a nominal 200×200) or uses `fill`, and CSS (`object-cover w-full
  //       h-full`) stretches the image to fill a card/grid cell. Here next/image
  //       with a fixed width + NO `sizes` emits only a 1x/2x srcset (w_200 +
  //       w_400). On a 2x/3x monitor a ~300px card needs ~600–900 real px, so it
  //       downloads the too-small w_400 and looks blurry — while a 1x monitor
  //       looks fine. Same page, different DPR = different result. These NEED a
  //       responsive `sizes` so next builds a width-based srcset from
  //       `deviceSizes` and each browser picks the right width for its own DPR.
  //
  //   (b) TRULY FIXED-SIZE images: the caller passes explicit width/height for a
  //       small box that is displayed at that exact size (cart 96px thumb,
  //       avatar). Here next's native 1x/2x srcset is already correct and LEAN —
  //       forcing a viewport-relative `sizes` would make a 96px thumbnail fetch
  //       a ~640px variant (≈6× the bytes) for no visible gain. Leave these
  //       alone (sizes = undefined).
  //
  // Heuristic: apply the responsive default ONLY to the case-(a) fallback path —
  // non-`fill`, no dimensions given (the nominal 200×200 CSS-stretched card).
  //
  // We deliberately do NOT touch `fill` here. A `fill` image sizes to whatever
  // its container is — which can be a full-bleed hero (100vw) just as easily as
  // a small grid cell. next/image already defaults `fill` to `sizes="100vw"`,
  // which is sharp everywhere (at worst it over-fetches a tiny fill, and those
  // callers should pass their own tight `sizes`). Forcing 25vw here would make a
  // full-bleed fill fetch a quarter-width variant and render blurry — the exact
  // bug this whole change exists to prevent. An explicit caller `sizes` always
  // wins in every case.
  const callerGaveDimensions = width != null || height != null;
  const resolvedSizes =
    (props.sizes as string | undefined) ??
    (!isFill && !callerGaveDimensions
      ? '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw'
      : undefined);

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    setImageLoaded(true);
    if (props.onLoad) {
      props.onLoad(e);
    }
  };

  // Browser-cached images can finish loading before React attaches `onLoad`
  // (especially during hydration), so the load event never reaches us and the
  // image stays stuck at opacity-0. Reconcile against the actual DOM element on
  // mount / when the source changes so cached images become visible.
  const reconcileLoaded = (img: HTMLImageElement | null) => {
    imgRef.current = img;
    if (img && img.complete) {
      if (img.naturalWidth === 0) {
        setImageError(true);
      } else {
        setImageLoaded(true);
      }
    }
  };

  return (
    <Image
      ref={reconcileLoaded}
      src={finalSrc}
      alt={alt}
      width={imageWidth}
      height={imageHeight}
      priority={priority}
      className={`${className} ${imageLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
      onError={() => setImageError(true)}
      {...props}
      sizes={resolvedSizes}
      onLoad={handleLoad}
    />
  );
}