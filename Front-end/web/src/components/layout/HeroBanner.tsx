'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Zap } from 'lucide-react';

interface BannerProps {
  className?: string;
}

export default function HeroBanner({ className = '' }: BannerProps) {
  // Cache busting: Update version number when image changes
  const IMAGE_VERSION = 'v4'; // Change this to force refresh: v1, v2, v3, etc.
  
  return (
    <div className={`relative w-full ${className}`}>
      {/* Banner image - OPTIMIZED WebP format */}
      <Link href="/offers" className="relative w-full block cursor-pointer hover:opacity-95 transition-opacity">
        <div className="relative w-full">
          <Image
            src={`/images/Hero_Banner3_optimized.webp?v=${IMAGE_VERSION}`}
            alt="Autobacs India - Drive Beyond Limit"
            width={1600}
            height={264}
            priority
            className="w-full h-auto object-contain"
            sizes="100vw"
          />
        </div>
      </Link>

      {/* Consultation CTA strip */}
      <div className="bg-[#0E0E0E] border-t border-[#252525]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-center sm:text-left">
            <p className="text-white font-condensed font-bold text-sm sm:text-base uppercase tracking-wide">
              Want a personalised performance upgrade plan?
            </p>
            <p className="text-[#C4C4C4] text-xs sm:text-sm font-body">
              Our experts will build a spec sheet for your exact car — free consultation.
            </p>
          </div>
          <Link
            href="/consultation"
            className="flex-shrink-0 flex items-center gap-2 px-5 py-2.5 bg-[#3B9EE8] hover:bg-[#1A6FB5] text-white font-condensed font-bold rounded-sm text-sm transition-all uppercase tracking-widest group"
          >
            <Zap className="h-4 w-4" />
            Get Free Consultation
          </Link>
        </div>
      </div>
    </div>
  );
}
