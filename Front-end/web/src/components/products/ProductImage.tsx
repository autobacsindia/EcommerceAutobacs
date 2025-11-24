'use client';

import Image from 'next/image';
import { useState, useEffect } from 'react';

interface ProductImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  priority?: boolean;
  className?: string;
}

export default function ProductImage({ 
  src, 
  alt, 
  width, 
  height, 
  priority = false,
  className = ''
}: ProductImageProps) {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  
  // Reset error state when src changes
  useEffect(() => {
    setImageError(false);
    setImageLoaded(false);
  }, [src]);

  // Check if the image URL is valid
  const isValidImageUrl = (url: string) => {
    if (!url) return false;
    
    // Check if it's a placeholder/example URL
    if (url.includes('example.com') || url.includes('placeholder')) {
      return false;
    }
    
    // Basic URL validation
    try {
      const urlObj = new URL(url);
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
      return false;
    }
  };

  // Check if it's a placeholder URL
  const isPlaceholderUrl = (url: string) => {
    return url.includes('example.com') || url.includes('placeholder');
  };

  // If we have an invalid image URL, show fallback
  if (!isValidImageUrl(src) || imageError) {
    // Special handling for placeholder URLs - show a default product image
    if (isPlaceholderUrl(src)) {
      return (
        <div className={`relative ${className}`} style={{ width: width || '100%', height: height || '100%' }}>
          {/* Simple SVG placeholder for product images */}
          <div className="w-full h-full bg-gray-200 flex items-center justify-center">
            <svg 
              className="w-16 h-16 text-gray-400" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24" 
              xmlns="http://www.w3.org/2000/svg"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={1.5} 
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <div className="absolute bottom-2 left-2 bg-white bg-opacity-80 px-2 py-1 rounded text-xs text-gray-600">
            Sample Product
          </div>
        </div>
      );
    }
    
    // General fallback for other invalid URLs
    return (
      <div 
        className={`flex items-center justify-center bg-gray-100 ${className}`}
        style={{ width: width || '100%', height: height || '100%' }}
      >
        <span className="text-gray-400 text-sm">No image available</span>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      priority={priority}
      className={`${className} ${imageLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
      onError={() => setImageError(true)}
      onLoad={() => setImageLoaded(true)}
      unoptimized={true} // Allow external images without optimization
    />
  );
}