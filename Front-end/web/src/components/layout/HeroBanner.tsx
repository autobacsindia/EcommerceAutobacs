'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';

interface BannerProps {
  className?: string;
}

export default function HeroBanner({ className = '' }: BannerProps) {
  return (
    <Link href="/offers" className={`relative w-full block cursor-pointer hover:opacity-95 transition-opacity ${className}`}>
      <div className="relative w-full">
        <Image
          src="https://autobacsindia.com/wp-content/uploads/2025/10/banner-new.jpg"
          alt="Autobacs India - Premium Automotive Accessories - Click to view offers"
          width={1600}
          height={264}
          priority
          className="w-full h-auto object-contain"
          sizes="100vw"
        />
      </div>
    </Link>
  );
}
