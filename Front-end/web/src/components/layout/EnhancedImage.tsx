'use client';

import Image from 'next/image';
import { useState, useEffect } from 'react';

interface EnhancedImageProps {
  src: string | null | undefined;
  alt: string;
  width?: number;
  height?: number;
  priority?: boolean;
  className?: string;
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
  context = 'generic'
}: EnhancedImageProps) {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

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

  // If we don't have a valid source even after fallback, don't render the image
  if (!finalSrc || finalSrc === '') {
    return (
      <div 
        className={`flex items-center justify-center bg-gray-100 ${className}`}
        style={{ width: width || 200, height: height || 200 }}
      >
        <span className="text-gray-400 text-sm">No image</span>
      </div>
    );
  }

  // For invalid URLs or when image fails to load, show fallback UI
  if (imageError) {
    return (
      <div 
        className={`flex items-center justify-center bg-gray-100 ${className}`}
        style={{ width: width || 200, height: height || 200 }}
      >
        <span className="text-gray-400 text-sm">Image unavailable</span>
      </div>
    );
  }

  // Ensure we always have width and height for Next.js Image component
  const imageWidth = width || 200;
  const imageHeight = height || 200;

  return (
    <Image
      src={finalSrc}
      alt={alt}
      width={imageWidth}
      height={imageHeight}
      priority={priority}
      className={`${className} ${imageLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
      onError={() => setImageError(true)}
      onLoad={() => setImageLoaded(true)}
      unoptimized={true} // Allow external images without optimization
    />
  );
}