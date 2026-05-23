'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

interface BreadcrumbItem {
  label: string;
  href: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export default function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav className="bg-[#0E0E0E] border-b border-[#252525] py-3">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <ol className="flex items-center space-x-2 text-sm">
          {items.map((item, index) => (
            <li key={index} className="flex items-center">
              {index < items.length - 1 ? (
                <>
                  <Link href={item.href} className="text-[#3B9EE8] hover:text-white transition-colors font-body">
                    {item.label}
                  </Link>
                  <ChevronRight className="h-4 w-4 text-[#555555] mx-2" />
                </>
              ) : (
                <span className="text-[#C4C4C4] font-body truncate max-w-xs md:max-w-md">{item.label}</span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
