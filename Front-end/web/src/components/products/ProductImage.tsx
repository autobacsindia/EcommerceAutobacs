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
}

export default function ProductImage({ 
  src, 
  alt, 
  width, 
  height, 
  priority = false,
  className = ''
}: ProductImageProps) {
  return (
    <EnhancedImage
      src={src}
      alt={alt}
      width={width}
      height={height}
      priority={priority}
      className={className}
      context="product"
    />
  );
}