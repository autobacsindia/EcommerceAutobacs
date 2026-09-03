'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';

interface BrandLogoProps {
  variant?: 'full' | 'compact';
  theme?: 'light' | 'dark';
  className?: string;
}

export default function BrandLogo({ variant = 'full', theme = 'dark', className = '' }: BrandLogoProps) {
  // Match the home hero lockup (see homeContent.ts `brand.logo`).
  const logoSrc = 'https://img.autobacsindia.com/autobacs/site/roavion-primary-trimmed.png';
  const logoAlt = 'Roavion';
  
  // Use inline style for filter to ensure it works regardless of Tailwind config
  const imageStyle = theme === 'light' ? { filter: 'invert(1)' } : undefined;
  
  if (variant === 'compact') {
    return (
      <Link href="/" className={`relative block ${className}`}>
        <Image
          src={logoSrc}
          alt={logoAlt}
          width={775}
          height={309}
          priority
          className="object-contain h-24 w-auto"
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
        width={775}
        height={309}
        priority
        className="object-contain h-28 w-auto"
        style={imageStyle}
      />
    </Link>
  );
}
