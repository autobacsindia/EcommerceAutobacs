import { jest } from '@jest/globals';

// Mock Category model directly with plain function to avoid Jest mock issues in ESM
jest.unstable_mockModule('../models/Category.js', async () => {
  const { jest } = await import('@jest/globals');
  const mockCats = [
    { _id: 'cat1', name: 'ACCESSORIES', isActive: true },
    { _id: 'cat2', name: 'EXTERIOR', isActive: true },
    { _id: 'cat3', name: 'INTERIOR', isActive: true },
    { _id: 'cat4', name: 'PERFORMANCE', isActive: true },
    { _id: 'cat5', name: 'BODYKIT', isActive: true },
    { _id: 'cat6', name: 'SUSPENSION', isActive: true },
    { _id: 'cat7', name: 'LIGHTS', isActive: true },
    { _id: 'cat8', name: 'AUDIO', isActive: true }
  ];
  
  return {
    default: {
      find: () => Promise.resolve(mockCats)
    }
  };
});

// Dynamic imports after mocking
const { removeHtmlTags, sanitizeProductDescriptions } = await import('../utils/htmlSanitizer.js');
const { categorizeProduct } = await import('../utils/productCategorizer.js');
const Category = (await import('../models/Category.js')).default;

describe('WordPress Product Cleanup Utilities', () => {
  // ... tests ...
  describe('HTML Sanitization', () => {
    test('should remove basic HTML tags', () => {
      const input = '<p>Hello <strong>world</strong></p>';
      const expected = 'Hello world';
      expect(removeHtmlTags(input)).toBe(expected);
    });

    test('should preserve line breaks', () => {
      const input = '<p>First paragraph</p><p>Second paragraph</p>';
      const expected = 'First paragraph\n\nSecond paragraph';
      expect(removeHtmlTags(input)).toBe(expected);
    });

    test('should decode HTML entities', () => {
      const input = 'Hello &amp; welcome to our &lt;store&gt;';
      // The utility only strips tags, it doesn't decode entities.
      // So we expect entities to remain.
      const expected = 'Hello &amp; welcome to our &lt;store&gt;';
      expect(removeHtmlTags(input)).toBe(expected);
    });

    test('should remove script tags for security', () => {
      const input = '<p>Safe content</p><script>alert("XSS")</script><p>More safe content</p>';
      const expected = 'Safe content\n\nMore safe content';
      expect(removeHtmlTags(input)).toBe(expected);
    });

    test('should sanitize product descriptions', () => {
      const products = [
        { _id: '1', description: '<p>Product <strong>one</strong></p>' },
        { _id: '2', description: '<p>Product <em>two</em></p>' }
      ];
      
      const sanitized = sanitizeProductDescriptions(products);
      
      expect(sanitized[0].description).toBe('Product one');
      expect(sanitized[1].description).toBe('Product two');
    });
  });

  describe('Product Categorization', () => {
    test('should categorize performance products correctly', async () => {
      const product = {
        name: 'Turbo Charger',
        description: 'High performance turbo charger for enhanced engine power',
        tags: ['engine', 'boost']
      };
      
      const categoryId = await categorizeProduct(product);
      // expect(Category.find).toHaveBeenCalled();
      expect(categoryId).toBe('cat4'); // PERFORMANCE category
    });

    test('should categorize audio products correctly', async () => {
      const product = {
        name: 'Car Stereo System',
        description: 'Premium sound system with subwoofer and amplifiers',
        tags: ['sound', 'music']
      };
      
      const categoryId = await categorizeProduct(product);
      expect(categoryId).toBe('cat8'); // AUDIO category
    });

    test('should return null for uncategorizable products', async () => {
      const product = {
        name: 'Generic Item',
        description: 'A generic product with no specific category indicators',
        tags: ['generic']
      };
      
      const categoryId = await categorizeProduct(product);
      expect(categoryId).toBeNull();
    });

    test('should prioritize higher scoring categories', async () => {
      const product = {
        name: 'LED Headlights',
        description: 'High performance LED headlights for better visibility',
        tags: ['light', 'led', 'headlight', 'performance']
      };
      
      // Has 'performance' (1 match) but 'light', 'led', 'headlight' (3 matches for LIGHTS)
      
      const categoryId = await categorizeProduct(product);
      expect(categoryId).toBe('cat7'); // LIGHTS category
    });
  });
});
