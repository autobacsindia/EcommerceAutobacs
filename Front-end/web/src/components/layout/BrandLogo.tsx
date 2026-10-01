'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { brand } from '@/components/home/redesign/homeContent';

interface BrandLogoProps {
  variant?: 'full' | 'compact';
  theme?: 'light' | 'dark';
  className?: string;
}

export default function BrandLogo({ variant = 'full', theme = 'dark', className = '' }: BrandLogoProps) {
  // Same asset as the site header (homeContent.ts `brand.logo`), so the two can't drift.
  const logoSrc = brand.logo;
  const logoAlt = 'Roavion';
  
  // Use inline style for filter to ensure it works regardless of Tailwind config
  const imageStyle = theme === 'light' ? { filter: 'invert(1)' } : undefined;
  
  if (variant === 'compact') {
    return (
      <Link href="/" className={`relative block ${className}`}>
        <Image
          src={logoSrc}
          alt={logoAlt}
          width={960}
          height={255}
          priority
          className="object-contain h-16 w-auto"
          style={imageStyle}
        />
      </Link>
    );
  }

  return (
    <Link href="/" className={`relative block ${className}`}>
      <Image
        src={logoSrc}
        alt={logoAlt}
        width={960}
        height={255}
        priority
        className="object-contain h-20 w-auto"
        style={imageStyle}
      />
    </Link>
  );
}
