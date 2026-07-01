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
    <nav className="bg-obsidian border-b border-hairline py-3">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <ol className="flex items-center space-x-2 text-sm">
          {items.map((item, index) => (
            <li key={index} className="flex items-center">
              {index < items.length - 1 ? (
                <>
                  <Link href={item.href} className="text-gold hover:text-ink transition-colors font-display">
                    {item.label}
                  </Link>
                  <ChevronRight className="h-4 w-4 text-ink-muted mx-2" />
                </>
              ) : (
                <span className="text-ink/70 font-display truncate max-w-xs md:max-w-md">{item.label}</span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
