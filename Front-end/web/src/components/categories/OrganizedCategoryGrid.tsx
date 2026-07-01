'use client';

import { Category } from '@/lib/types';
import CategoryCard from '@/components/categories/CategoryCard';
import { CATEGORY_HIERARCHY, findCategoryFlexible, findSubcategories } from '@/lib/categoryMapping';

interface OrganizedCategoryGridProps {
  categories: Category[];
}

export default function OrganizedCategoryGrid({ categories }: OrganizedCategoryGridProps) {
  return (
    <div className="space-y-12">
      {CATEGORY_HIERARCHY.map((mainCategory) => {
        const category = findCategoryFlexible(mainCategory.slug, categories);
        
        // If main category doesn't exist, skip it
        if (!category) return null;
        
        // Get subcategories
        const subcategories = mainCategory.subcategories 
          ? mainCategory.subcategories
              .map(sub => findCategoryFlexible(sub.slug, categories))
              .filter((sub): sub is Category => sub !== null)
          : findSubcategories(category._id, categories);
        
        return (
          <div key={category._id} className="space-y-6">
            {/* Main Category */}
            <div className="border-b border-hairline pb-4">
              <h2 className="text-2xl font-bold text-ink">{mainCategory.name}</h2>
              {mainCategory.description && (
                <p className="text-ink-muted mt-1">{mainCategory.description}</p>
              )}
            </div>
            
            {/* Category Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Main Category Card */}
              <div className="sm:col-span-1 lg:col-span-1">
                <CategoryCard category={category} />
              </div>
              
              {/* Subcategories */}
              {subcategories.length > 0 && (
                <div className="sm:col-span-1 lg:col-span-2">
                  <h3 className="text-lg font-semibold text-ink mb-4">Subcategories</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {subcategories.map((subCategory) => (
                      <CategoryCard key={subCategory._id} category={subCategory} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}