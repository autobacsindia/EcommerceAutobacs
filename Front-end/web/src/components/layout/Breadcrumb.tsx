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
    <nav className="bg-gray-50 py-4">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <ol className="flex items-center space-x-2 text-sm">
          {items.map((item, index) => (
            <li key={index} className="flex items-center">
              {index < items.length - 1 ? (
                <>
                  <Link 
                    href={item.href} 
                    className="text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    {item.label}
                  </Link>
                  <ChevronRight className="h-4 w-4 text-gray-400 mx-2" />
                </>
              ) : (
                <span className="text-gray-500 truncate max-w-xs md:max-w-md">
                  {item.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}