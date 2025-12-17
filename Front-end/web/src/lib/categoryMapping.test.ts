import { findCategoryFlexible, getMainCategory, getCategoryHierarchy } from './categoryMapping';
import { Category } from '@/lib/types';

// Mock category data
const mockCategories: Category[] = [
  {
    _id: '1',
    name: 'Accessories',
    slug: 'accessories',
    description: 'General automotive accessories',
    isActive: true,
    order: 1
  },
  {
    _id: '2',
    name: 'Exterior',
    slug: 'exterior',
    description: 'Exterior styling parts',
    isActive: true,
    order: 2
  },
  {
    _id: '3',
    name: 'Body Kits',
    slug: 'bodykit',
    description: 'Complete body kits',
    parent: '2',
    isActive: true,
    order: 1
  },
  {
    _id: '4',
    name: 'Lights',
    slug: 'lights',
    description: 'Lighting accessories',
    parent: '2',
    isActive: true,
    order: 2
  },
  {
    _id: '5',
    name: 'Interior',
    slug: 'interior',
    description: 'Interior upgrades',
    isActive: true,
    order: 3
  },
  {
    _id: '6',
    name: 'Audio',
    slug: 'audio',
    description: 'Car audio systems',
    parent: '5',
    isActive: true,
    order: 1
  },
  {
    _id: '7',
    name: 'Performance',
    slug: 'performance',
    description: 'Performance upgrades',
    isActive: true,
    order: 4
  },
  {
    _id: '8',
    name: 'Suspension',
    slug: 'suspension',
    description: 'Suspension systems',
    parent: '7',
    isActive: true,
    order: 1
  }
];

describe('Category Mapping Utility', () => {
  test('should find category by exact slug match', () => {
    const category = findCategoryFlexible('accessories', mockCategories);
    expect(category).toBeDefined();
    expect(category?._id).toBe('1');
    expect(category?.name).toBe('Accessories');
  });

  test('should find category by pattern matching', () => {
    const category = findCategoryFlexible('lighting', mockCategories);
    expect(category).toBeDefined();
    expect(category?._id).toBe('4');
    expect(category?.name).toBe('Lights');
  });

  test('should find main category from product categories', () => {
    const productCategories = [
      mockCategories[2], // Body Kits
      mockCategories[1]  // Exterior
    ];
    
    const mainCategory = getMainCategory(productCategories);
    expect(mainCategory).toBeDefined();
    expect(mainCategory?._id).toBe('3'); // Body Kits should be prioritized
  });

  test('should return first category if no main nav match', () => {
    const productCategories = [
      {
        _id: '999',
        name: 'Custom Category',
        slug: 'custom',
        description: 'Custom products',
        isActive: true,
        order: 1
      } as Category
    ];
    
    const mainCategory = getMainCategory(productCategories);
    expect(mainCategory).toBeDefined();
    expect(mainCategory?._id).toBe('999');
  });

  test('should organize categories in hierarchy', () => {
    const hierarchy = getCategoryHierarchy(mockCategories);
    expect(hierarchy).toHaveLength(4); // ACCESSORIES, EXTERIOR, INTERIOR, PERFORMANCE
    
    // Check that EXTERIOR has subcategories
    const exterior = hierarchy.find(cat => cat.slug === 'exterior');
    expect(exterior).toBeDefined();
    expect(exterior?.subcategories).toHaveLength(2);
    
    // Check that INTERIOR has subcategories
    const interior = hierarchy.find(cat => cat.slug === 'interior');
    expect(interior).toBeDefined();
    expect(interior?.subcategories).toHaveLength(1);
    expect(interior?.subcategories?.[0].name).toBe('AUDIO');
    
    // Check that PERFORMANCE has subcategories
    const performance = hierarchy.find(cat => cat.slug === 'performance');
    expect(performance).toBeDefined();
    expect(performance?.subcategories).toHaveLength(1);
    expect(performance?.subcategories?.[0].name).toBe('SUSPENSION');
  });
});