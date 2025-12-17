// Category mapping utility for flexible category assignment
import { Category } from '@/lib/types';

// Define the category hierarchy structure
export interface CategoryHierarchy {
  name: string;
  slug: string;
  description: string;
  subcategories?: CategoryHierarchy[];
}

// Define category mapping rules
const CATEGORY_MAPPING_RULES = {
  // Direct mappings
  exact: {
    'Accessories': 'accessories',
    'Exterior': 'exterior',
    'Interior': 'interior',
    'Performance': 'performance',
    'Suspension': 'suspension',
    'Lighting': 'lights',
    'Lights': 'lights',
    'Body Kits': 'bodykit',
    'Body Kit': 'bodykit',
    'Audio': 'audio',
    'Sound System': 'audio',
    'Protection Kit': 'protection-kit',
    'Roof Top': 'roof-top',
    'Portable Fridge': 'portable-fridge',
    'Winch': 'winch',
    'X-JACK': 'x-jack'
  } as Record<string, string>,
  
  // Pattern-based mappings
  patterns: [
    { pattern: /light/i, category: 'lights' },
    { pattern: /audio|sound/i, category: 'audio' },
    { pattern: /perform/i, category: 'performance' },
    { pattern: /suspens/i, category: 'suspension' },
    { pattern: /exterior/i, category: 'exterior' },
    { pattern: /interior/i, category: 'interior' },
    { pattern: /access/i, category: 'accessories' },
    { pattern: /body.*kit/i, category: 'bodykit' },
    { pattern: /protect/i, category: 'protection-kit' },
    { pattern: /roof/i, category: 'roof-top' }
  ] as { pattern: RegExp; category: string }[]
};

// Define the desired category hierarchy for the frontend
export const CATEGORY_HIERARCHY: CategoryHierarchy[] = [
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
        name: "BODY KITS",
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

/**
 * Find a category by various matching strategies
 * @param categoryName - The name of the category to find
 * @param categories - Array of all available categories
 * @returns The matched category or null
 */
export function findCategoryFlexible(categoryName: string, categories: Category[]): Category | null {
  if (!categoryName || typeof categoryName !== 'string') {
    return null;
  }

  const lowerName = categoryName.toLowerCase().trim();
  
  // 1. Exact match by slug
  let category = categories.find(cat => cat.slug?.toLowerCase() === lowerName);
  
  if (category) {
    return category;
  }
  
  // 2. Exact match by name (case insensitive)
  category = categories.find(cat => cat.name?.toLowerCase() === lowerName);
  
  if (category) {
    return category;
  }
  
  // 3. Check direct mappings from config
  const directMappingSlug = CATEGORY_MAPPING_RULES.exact[categoryName];
  if (directMappingSlug) {
    category = categories.find(cat => cat.slug?.toLowerCase() === directMappingSlug.toLowerCase());
    if (category) {
      return category;
    }
  }
  
  // 4. Pattern-based matching
  for (const rule of CATEGORY_MAPPING_RULES.patterns) {
    if (rule.pattern.test(lowerName)) {
      category = categories.find(cat => cat.slug?.toLowerCase() === rule.category.toLowerCase());
      if (category) {
        return category;
      }
    }
  }
  
  // 5. Partial matching (find categories that contain the search term)
  for (const cat of categories) {
    if (cat.name?.toLowerCase().includes(lowerName) || cat.slug?.toLowerCase().includes(lowerName)) {
      return cat;
    }
  }
  
  // No match found
  return null;
}

/**
 * Find subcategories of a parent category
 * @param parentId - The ID of the parent category
 * @param categories - Array of all available categories
 * @returns Array of subcategories
 */
export function findSubcategories(parentId: string, categories: Category[]): Category[] {
  return categories.filter(cat => 
    cat.parent && 
    typeof cat.parent === 'string' && 
    cat.parent === parentId
  );
}

/**
 * Get the main category for a product based on its categories
 * @param productCategories - Array of categories assigned to a product
 * @returns The main category or null if none found
 */
export function getMainCategory(productCategories: Category[]): Category | null {
  if (!productCategories || productCategories.length === 0) {
    return null;
  }
  
  // Define priority order for main navigation categories
  // Categories earlier in the array have higher priority
  const mainNavPriority = [
    'bodykit',
    'suspension',
    'audio',
    'lights',
    'performance',
    'interior',
    'exterior',
    'accessories'
  ];
  
  // Check categories in priority order
  for (const slug of mainNavPriority) {
    const category = productCategories.find(cat => cat.slug === slug);
    if (category) {
      return category;
    }
  }
  
  // If no direct match, return the first category
  return productCategories[0];
}

/**
 * Get the category hierarchy for display
 * @param categories - Array of all available categories
 * @returns Organized hierarchy of categories
 */
export function getCategoryHierarchy(categories: Category[]): CategoryHierarchy[] {
  return CATEGORY_HIERARCHY.map(mainCategory => {
    // Find the actual category data
    const category = findCategoryFlexible(mainCategory.slug, categories);
    
    if (!category) {
      return mainCategory;
    }
    
    // If there are subcategories defined in the hierarchy, map them to actual data
    if (mainCategory.subcategories) {
      const subcategories = mainCategory.subcategories.map(sub => {
        const subCategory = findCategoryFlexible(sub.slug, categories);
        return subCategory ? {
          name: subCategory.name.toUpperCase(),
          slug: subCategory.slug,
          description: subCategory.description || sub.description
        } : sub;
      }).filter(sub => sub !== null) as CategoryHierarchy[];
      
      return {
        ...mainCategory,
        name: category.name.toUpperCase(),
        description: category.description || mainCategory.description,
        subcategories
      };
    }
    
    // For categories without predefined subcategories, find actual subcategories
    const actualSubcategories = findSubcategories(category._id, categories);
    if (actualSubcategories.length > 0) {
      const subcategories = actualSubcategories.map(sub => ({
        name: sub.name.toUpperCase(),
        slug: sub.slug,
        description: sub.description || ''
      }));
      
      return {
        ...mainCategory,
        name: category.name.toUpperCase(),
        description: category.description || mainCategory.description,
        subcategories
      };
    }
    
    return {
      ...mainCategory,
      name: category.name.toUpperCase(),
      description: category.description || mainCategory.description
    };
  });
}