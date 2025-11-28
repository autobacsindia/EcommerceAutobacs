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

  // Find categories by slug, name, or variations
  const findCategoryFlexible = (slug: string, name: string) => {
    // First try to find by slug
    let category = categories.find(cat => cat.slug?.toLowerCase() === slug.toLowerCase());
    
    // If not found by slug, try to find by exact name match (case insensitive)
    if (!category) {
      category = categories.find(cat => cat.name?.toUpperCase() === name.toUpperCase());
    }
    
    // If still not found, try to find by partial name match for body kits
    if (!category && name.toUpperCase() === "BODYKIT") {
      category = categories.find(cat => {
        const categoryName = cat.name?.toUpperCase() || "";
        return categoryName.includes("BODY") && categoryName.includes("KIT");
      });
    }
    
    // If still not found, try alternative spellings for body kit
    if (!category && name.toUpperCase() === "BODYKIT") {
      category = categories.find(cat => {
        const categoryName = cat.name?.toUpperCase() || "";
        return categoryName === "BODY KIT" || categoryName === "BODY-KIT" || categoryName === "BODY_KIT";
      });
    }
    
    return category;
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
        const category = findCategoryFlexible(mainCategory.slug, mainCategory.name);
        
        // If main category doesn't exist, skip it
        if (!category) return null;
        
        // Get subcategories
        const subcategories = mainCategory.subcategories 
          ? mainCategory.subcategories
              .map(sub => findCategoryFlexible(sub.slug, sub.name))
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
    </div>
  );
}