'use client';

import CuratedCollectionCarousel from './CuratedCollectionCarousel';

interface CollectionConfig {
  title: string;
  subtitle?: string;
  searchKeyword: string;
  viewAllLink?: string;
  badge?: string;
  badgeColor?: string;
}

interface CuratedCollectionsProps {
  collections: CollectionConfig[];
  productsPerCollection?: number;
  className?: string;
}

export default function CuratedCollections({
  collections,
  productsPerCollection = 10,
  className = ''
}: CuratedCollectionsProps) {
  return (
    <div className={`bg-gray-50 py-6 ${className}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
        {collections.map((collection, index) => (
          <CuratedCollectionCarousel
            key={index}
            collection={collection}
            productsLimit={productsPerCollection}
          />
        ))}
      </div>
    </div>
  );
}
