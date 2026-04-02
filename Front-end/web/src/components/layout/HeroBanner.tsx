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
      {/* Banner image */}
      <Link href="/offers" className="relative w-full block cursor-pointer hover:opacity-95 transition-opacity">
        <div className="relative w-full">
          <Image
            src={`/images/Hero_Banner3.jpeg?v=${IMAGE_VERSION}`}
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
      <div className="bg-gradient-to-r from-gray-900 via-gray-900 to-red-950 border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-center sm:text-left">
            <p className="text-white font-bold text-sm sm:text-base">
              🔥 Want a personalised performance upgrade plan?
            </p>
            <p className="text-gray-400 text-xs sm:text-sm">
              Our experts will build a spec sheet for your exact car — free consultation.
            </p>
          </div>
          <Link
            href="/consultation"
            className="flex-shrink-0 flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-sm transition-all shadow-lg shadow-red-600/25 group"
          >
            <Zap className="h-4 w-4" />
            Get Free Consultation
          </Link>
        </div>
      </div>
    </div>
  );
}
