'use client';

import Link from 'next/link';

// Define the Category interface inline to avoid import issues
interface Category {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  parent?: any;
  image?: {
    url: string;
    alt?: string;
  };
  isActive: boolean;
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

interface CategoryBreadcrumbsProps {
  category: Category;
  className?: string;
}

export default function CategoryBreadcrumbs({ category, className = '' }: CategoryBreadcrumbsProps) {
  // For now, we'll implement a simple breadcrumb that shows the current category
  // In a more advanced implementation, we would fetch parent categories and show the full hierarchy
  
  return (
    <nav className={`flex items-center space-x-2 text-sm ${className}`} aria-label="Breadcrumb">
      <Link href="/" className="text-gray-500 hover:text-blue-600">
        Home
      </Link>
      <span className="text-gray-400">/</span>
      <Link href="/categories" className="text-gray-500 hover:text-blue-600">
        Categories
      </Link>
      <span className="text-gray-400">/</span>
      <span className="text-gray-900 truncate max-w-xs" title={category.name}>
        {category.name}
      </span>
    </nav>
  );
}