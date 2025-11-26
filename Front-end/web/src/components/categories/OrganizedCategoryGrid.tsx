'use client';

import { Category } from '@/lib/types';
import CategoryCard from '@/components/categories/CategoryCard';

interface OrganizedCategoryGridProps {
  categories: Category[];
}

export default function OrganizedCategoryGrid({ categories }: OrganizedCategoryGridProps) {
  // Define the desired category organization
  const categoryHierarchy = [
    {
      name: "ACCESSORIES",
      slug: "accessories",
      description: "General automotive accessories and parts"
    },
    {
      name: "EXTERIOR",
      slug: "exterior",
      description: "Exterior styling and body parts",
      subcategories: [
        {
          name: "BODYKIT",
          slug: "bodykit",
          description: "Complete body kits and styling packages"
        },
        {
          name: "LIGHTS",
          slug: "lights",
          description: "Headlights, taillights, and lighting accessories"
        }
      ]
    },
    {
      name: "INTERIOR",
      slug: "interior",
      description: "Interior styling and comfort upgrades",
      subcategories: [
        {
          name: "AUDIO",
          slug: "audio",
          description: "Car audio systems and sound enhancement"
        }
      ]
    },
    {
      name: "PERFORMANCE",
      slug: "performance",
      description: "Performance upgrades and tuning parts",
      subcategories: [
        {
          name: "SUSPENSION",
          slug: "suspension",
          description: "Suspension systems and handling upgrades"
        }
      ]
    }
  ];

  // Find categories by slug
  const findCategoryBySlug = (slug: string) => {
    return categories.find(cat => cat.slug?.toLowerCase() === slug.toLowerCase());
  };

  // Find subcategories of a parent category
  const findSubcategories = (parentId: string) => {
    return categories.filter(cat => 
      cat.parent && 
      typeof cat.parent === 'string' && 
      cat.parent === parentId
    );
  };

  return (
    <div className="space-y-12">
      {categoryHierarchy.map((mainCategory) => {
        const category = findCategoryBySlug(mainCategory.slug);
        
        // If main category doesn't exist, skip it
        if (!category) return null;
        
        // Get subcategories
        const subcategories = mainCategory.subcategories 
          ? mainCategory.subcategories
              .map(sub => findCategoryBySlug(sub.slug))
              .filter((sub): sub is Category => sub !== undefined)
          : findSubcategories(category._id);
        
        return (
          <div key={category._id} className="space-y-6">
            {/* Main Category */}
            <div className="border-b border-gray-200 pb-4">
              <h2 className="text-2xl font-bold text-gray-900">{mainCategory.name}</h2>
              {mainCategory.description && (
                <p className="text-gray-600 mt-1">{mainCategory.description}</p>
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
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Subcategories</h3>
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
      
      {/* Uncategorized Categories */}
      {categories.length > 0 && (
        <div className="space-y-6">
          <div className="border-b border-gray-200 pb-4">
            <h2 className="text-2xl font-bold text-gray-900">Other Categories</h2>
            <p className="text-gray-600 mt-1">Additional product categories</p>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {categories
              .filter(cat => {
                // Filter out categories that are already displayed in the hierarchy
                const slugs = categoryHierarchy.flatMap(cat => [
                  cat.slug,
                  ...(cat.subcategories?.map(sub => sub.slug) || [])
                ]);
                return !slugs.includes(cat.slug || '');
              })
              .map((category) => (
                <CategoryCard key={category._id} category={category} />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}