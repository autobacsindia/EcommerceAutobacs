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
  // White wordmark on dark backgrounds, black wordmark on light ones. (No CSS
  // invert: that would turn the green bar and tagline pink.)
  const logoSrc = theme === 'light' ? brand.logoOnLight : brand.logo;
  const logoAlt = brand.logoAlt;
  
  if (variant === 'compact') {
    return (
      <Link href="/" className={`relative block ${className}`}>
        <Image
          src={logoSrc}
          alt={logoAlt}
          width={960}
          height={226}
          priority
          className="object-contain h-16 w-auto"
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
        height={226}
        priority
        className="object-contain h-20 w-auto"
      />
    </Link>
  );
}
