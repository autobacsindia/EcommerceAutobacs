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
  const logoSrc = 'https://res.cloudinary.com/dhwxtl6l8/image/upload/v1775543920/Roavion-Logo_xwqbx9.png';
  const logoAlt = 'Roavion';
  
  // Use inline style for filter to ensure it works regardless of Tailwind config
  const imageStyle = theme === 'light' ? { filter: 'invert(1)' } : undefined;
  
  if (variant === 'compact') {
    return (
      <Link href="/" className={`relative block ${className}`}>
        <Image
          src={logoSrc}
          alt={logoAlt}
          width={120}
          height={40}
          priority
          className="object-contain"
          style={{ ...imageStyle, maxWidth: '120px', maxHeight: '40px' }}
        />
      </Link>
    );
  }

  return (
    <Link href="/" className={`relative block ${className}`}>
      <Image
        src={logoSrc}
        alt={logoAlt}
        width={150}
        height={50}
        priority
        className="object-contain"
        style={{ ...imageStyle, maxWidth: '150px', maxHeight: '50px' }}
      />
    </Link>
  );
}
