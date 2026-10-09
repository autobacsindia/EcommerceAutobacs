'use client';

import Link from 'next/link';
import EnhancedImage from '@/components/layout/EnhancedImage';
import { Category } from '@/lib/types';

interface CategoryCardProps {
  category: Category;
}

/** A category as a picture tile (`.sp-tile` in store.css), same look as the vehicle tiles. */
export default function CategoryCard({ category }: CategoryCardProps) {
  return (
    <Link href={`/categories/${category.slug}`} className="sp-tile">
      <div className="sp-tile-media">
        {category.image?.url ? (
          <EnhancedImage
            src={category.image.url}
            alt={category.image.alt || category.name}
            width={400}
            height={300}
            className="h-full w-full object-cover"
            context="category"
          />
        ) : (
          <div className="sp-vph" aria-hidden="true">
            <span className="sp-vph-make">{category.name}</span>
          </div>
        )}
      </div>
      <div className="sp-tile-body">
        <div>
          <p className="sp-tile-name">{category.name}</p>
          <p className="sp-tile-sub">Shop now</p>
        </div>
        <span className="sp-tile-go" aria-hidden="true">›</span>
      </div>
    </Link>
  );
}
