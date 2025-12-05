'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';

interface BrandLogoProps {
  variant?: 'full' | 'compact';
  className?: string;
}

export default function BrandLogo({ variant = 'full', className = '' }: BrandLogoProps) {
  const logoSrc = 'https://autobacsindia.com/wp-content/uploads/elementor/thumbs/Powered-By-Autobacs-India_W-rct5j6nyasgbfkiut06tthjrlw9nwcdky6he1x7g92.png.webp';
  const logoAlt = 'Roavion - Powered by AutoBacs India';
  
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
      />
    </Link>
  );
}
