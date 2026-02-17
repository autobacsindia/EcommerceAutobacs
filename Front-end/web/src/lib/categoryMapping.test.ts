
import {
  findCategoryFlexible,
  findSubcategories,
  getMainCategory,
  CATEGORY_HIERARCHY,
} from './categoryMapping';
import { Category } from './types';

describe('Category Mapping Utilities', () => {
  const mockCategories: Category[] = [
    {
      _id: '1',
      name: 'Accessories',
      slug: 'accessories',
      isActive: true,
      order: 0,
    },
    {
      _id: '2',
      name: 'Exterior',
      slug: 'exterior',
      isActive: true,
      order: 1,
    },
    {
      _id: '3',
      name: 'Body Kits',
      slug: 'bodykit',
      parent: '2',
      isActive: true,
      order: 2,
    },
    {
      _id: '4',
      name: 'Lights',
      slug: 'lights',
      parent: '2',
      isActive: true,
      order: 3,
    },
    {
      _id: '5',
      name: 'Audio Systems',
      slug: 'audio',
      isActive: true,
      order: 4,
    },
  ];

  describe('findCategoryFlexible', () => {
    it('finds category by exact slug', () => {
      const result = findCategoryFlexible('accessories', mockCategories);
      expect(result).toBeDefined();
      expect(result?.slug).toBe('accessories');
    });

    it('finds category by exact name', () => {
      const result = findCategoryFlexible('Exterior', mockCategories);
      expect(result).toBeDefined();
      expect(result?.slug).toBe('exterior');
    });

    it('finds category by direct mapping', () => {
      const result = findCategoryFlexible('Lighting', mockCategories);
      expect(result).toBeDefined();
      expect(result?.slug).toBe('lights');
    });

    it('finds category by pattern matching', () => {
      const result = findCategoryFlexible('Performance Parts', mockCategories);
      // Assuming 'Performance' is in pattern list but not in mockCategories directly?
      // Wait, mockCategories doesn't have 'performance'.
      // The function looks up the slug from the rule in the categories array.
      // So if I search for 'Performance Parts', it matches /perform/i -> category: 'performance'.
      // But 'performance' slug is NOT in mockCategories. So it should return null or undefined if the slug is not found.
      
      // Let's test with something that exists.
      // 'Audio Systems' has slug 'audio'. Pattern /audio|sound/i maps to 'audio'.
      const resultAudio = findCategoryFlexible('Car Sound', mockCategories);
      expect(resultAudio).toBeDefined();
      expect(resultAudio?.slug).toBe('audio');
    });

    it('finds category by partial match', () => {
      const result = findCategoryFlexible('Body', mockCategories);
      expect(result).toBeDefined();
      expect(result?.slug).toBe('bodykit');
    });

    it('returns null for non-existent category', () => {
      const result = findCategoryFlexible('NonExistent', mockCategories);
      expect(result).toBeNull();
    });

    it('returns null for empty input', () => {
      const result = findCategoryFlexible('', mockCategories);
      expect(result).toBeNull();
    });
  });

  describe('findSubcategories', () => {
    it('finds subcategories for a given parent', () => {
      const result = findSubcategories('2', mockCategories);
      expect(result).toHaveLength(2);
      expect(result.map(c => c.slug)).toContain('bodykit');
      expect(result.map(c => c.slug)).toContain('lights');
    });

    it('returns empty array if no subcategories found', () => {
      const result = findSubcategories('1', mockCategories);
      expect(result).toHaveLength(0);
    });
  });

  describe('getMainCategory', () => {
    // getMainCategory uses a hardcoded priority list
    // 'bodykit', 'suspension', 'audio', 'lights', ...
    
    it('returns highest priority category', () => {
      const productCategories: Category[] = [
        mockCategories[0], // accessories (low priority)
        mockCategories[2], // bodykit (high priority)
      ];
      const result = getMainCategory(productCategories);
      expect(result?.slug).toBe('bodykit');
    });

    it('returns null for empty categories', () => {
      const result = getMainCategory([]);
      expect(result).toBeNull();
    });
  });

  describe('CATEGORY_HIERARCHY', () => {
    it('is defined and has structure', () => {
      expect(CATEGORY_HIERARCHY).toBeInstanceOf(Array);
      expect(CATEGORY_HIERARCHY.length).toBeGreaterThan(0);
      expect(CATEGORY_HIERARCHY[0]).toHaveProperty('name');
      expect(CATEGORY_HIERARCHY[0]).toHaveProperty('slug');
    });
  });
});
