import { removeHtmlTags, sanitizeProductDescriptions } from '../utils/htmlSanitizer.js';
import { categorizeProduct, CATEGORY_KEYWORDS } from '../utils/productCategorizer.js';

// Mock category data for testing
const mockCategories = [
  { _id: 'cat1', name: 'ACCESSORIES', isActive: true },
  { _id: 'cat2', name: 'EXTERIOR', isActive: true },
  { _id: 'cat3', name: 'INTERIOR', isActive: true },
  { _id: 'cat4', name: 'PERFORMANCE', isActive: true },
  { _id: 'cat5', name: 'BODYKIT', isActive: true },
  { _id: 'cat6', name: 'SUSPENSION', isActive: true },
  { _id: 'cat7', name: 'LIGHTS', isActive: true },
  { _id: 'cat8', name: 'AUDIO', isActive: true }
];

// Mock Category model
jest.mock('../models/Category.js', () => ({
  find: jest.fn().mockResolvedValue(mockCategories)
}));

describe('WordPress Product Cleanup Utilities', () => {
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
      const expected = 'Hello & welcome to our <store>';
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
      
      // This product has keywords for both LIGHTS and PERFORMANCE
      // But LIGHTS should win because it has more specific matches
      const categoryId = await categorizeProduct(product);
      expect(categoryId).toBe('cat7'); // LIGHTS category
    });
  });

  describe('Category Keywords', () => {
    test('should have keywords for all categories', () => {
      const categories = Object.keys(CATEGORY_KEYWORDS);
      const expectedCategories = ['ACCESSORIES', 'EXTERIOR', 'INTERIOR', 'PERFORMANCE', 'BODYKIT', 'SUSPENSION', 'LIGHTS', 'AUDIO'];
      
      expect(categories).toEqual(expect.arrayContaining(expectedCategories));
      expect(categories).toHaveLength(expectedCategories.length);
    });

    test('should have reasonable number of keywords per category', () => {
      Object.values(CATEGORY_KEYWORDS).forEach(keywords => {
        expect(keywords.length).toBeGreaterThan(3);
        expect(keywords.length).toBeLessThan(15);
      });
    });
  });
});