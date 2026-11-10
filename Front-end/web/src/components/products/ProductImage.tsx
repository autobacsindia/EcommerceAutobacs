'use client';

import EnhancedImage from '@/components/layout/EnhancedImage';
import { useState, useEffect } from 'react';

interface ProductImageProps {
  src: string | null | undefined;
  alt: string;
  width?: number;
  height?: number;
  priority?: boolean;
  className?: string;
  /** How wide the picture shows, so the browser picks the right file. */
  sizes?: string;
}

export default function ProductImage({ 
  src, 
  alt, 
  width, 
  height, 
  priority = false,
  className = '',
  sizes
}: ProductImageProps) {
  return (
    <EnhancedImage
      src={src}
      alt={alt}
      width={width}
      height={height}
      priority={priority}
      className={className}
      sizes={sizes}
      context="product"
    />
  );
}