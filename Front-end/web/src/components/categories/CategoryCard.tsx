'use client';

import Link from 'next/link';
import EnhancedImage from '@/components/layout/EnhancedImage';
import { Category } from '@/lib/types';

interface CategoryCardProps {
  category: Category;
}

export default function CategoryCard({ category }: CategoryCardProps) {
  // Convert category name to uppercase for consistent display
  const displayName = category.name.toUpperCase();

  return (
    <Link 
      href={`/categories/${category.slug}`}
      className="group block bg-obsidian rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-shadow"
    >
      {/* Category Image */}
      <div className="h-48 bg-linear-to-br from-gold to-gold relative overflow-hidden">
        {category.image?.url ? (
          <EnhancedImage
            src={category.image.url}
            alt={category.image.alt || category.name}
            width={300}
            height={192}
            className="w-full h-full object-cover"
            context="category"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-16 h-16 text-ink opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
            </svg>
          </div>
        )}
      </div>
      
      {/* Category Info */}
      <div className="p-6">
        <h2 className="text-xl font-semibold text-ink mb-2 group-hover:text-gold transition-colors">
          {displayName}
        </h2>
        {category.description && (
          <p className="text-ink-muted mb-4 line-clamp-2">
            {category.description}
          </p>
        )}
        <div className="flex items-center text-gold font-medium">
          <span>Explore products</span>
          <svg className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path>
          </svg>
        </div>
      </div>
    </Link>
  );
}