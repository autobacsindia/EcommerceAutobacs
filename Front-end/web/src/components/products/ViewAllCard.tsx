'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

interface ViewAllCardProps {
  href: string;
  title: string;
  subtitle?: string;
  gradient?: string;
  className?: string;
}

export default function ViewAllCard({
  href,
  title,
  subtitle = 'View all',
  gradient = 'from-orange-500 to-red-600',
  className = ''
}: ViewAllCardProps) {
  return (
    <Link 
      href={href}
      className={`group block ${className}`}
    >
      <div className={`
        bg-gradient-to-br ${gradient}
        rounded-lg shadow-md overflow-hidden
        hover:shadow-xl hover:scale-105
        transition-all duration-300
        h-full flex flex-col items-center justify-center
        p-6 min-h-[400px]
      `}>
        <div className="text-white text-center">
          {/* Arrow Icon */}
          <div className="mb-4 flex items-center justify-center">
            <div className="bg-white/20 rounded-full p-4 group-hover:bg-white/30 transition-all duration-300">
              <ChevronRight className="h-12 w-12 text-white group-hover:translate-x-1 transition-transform duration-300" />
            </div>
          </div>
          
          {/* Title */}
          <h3 className="text-xl font-bold mb-2 group-hover:scale-110 transition-transform duration-300">
            {title}
          </h3>
          
          {/* Subtitle */}
          {subtitle && (
            <p className="text-sm text-white/90">
              {subtitle}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
