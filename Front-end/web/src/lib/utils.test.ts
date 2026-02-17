
import {
  cn,
  formatCurrency,
  formatDate,
  truncateText,
  calculateCartTotal,
  generateSlug,
  isValidEmail,
  getInitials,
  isEmpty,
} from './utils';

describe('Utility Functions', () => {
  describe('cn', () => {
    it('merges class names correctly', () => {
      expect(cn('p-4', 'bg-red-500')).toBe('p-4 bg-red-500');
    });

    it('handles conditional classes', () => {
      expect(cn('p-4', true && 'bg-red-500', false && 'text-white')).toBe('p-4 bg-red-500');
    });

    it('overrides tailwind classes', () => {
      expect(cn('p-4 p-8')).toBe('p-8');
      expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500');
    });
  });

  describe('formatCurrency', () => {
    it('formats number to INR currency string', () => {
      // Note: The exact output might depend on the locale implementation in the environment
      // We check for the presence of the currency symbol or code and the formatted number
      const result = formatCurrency(1234.56);
      expect(result).toMatch(/₹|INR/);
      expect(result).toMatch(/1,234.56/);
    });

    it('formats with custom currency', () => {
      const result = formatCurrency(1234.56, 'USD');
      expect(result).toMatch(/\$|USD/);
      expect(result).toMatch(/1,234.56/);
    });
  });

  describe('formatDate', () => {
    it('formats date to short string by default', () => {
      const date = new Date('2023-01-15');
      const result = formatDate(date);
      // Expected format: dd/mm/yyyy or similar depending on locale
      expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/); 
    });

    it('formats date to long string', () => {
      const date = new Date('2023-01-15');
      const result = formatDate(date, 'long');
      expect(result).toMatch(/January 15, 2023|15 January 2023/);
    });

    it('handles string input', () => {
      const result = formatDate('2023-01-15');
      expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    });
  });

  describe('truncateText', () => {
    it('truncates text longer than maxLength', () => {
      expect(truncateText('Hello World', 5)).toBe('Hello...');
    });

    it('does not truncate text shorter than or equal to maxLength', () => {
      expect(truncateText('Hello', 5)).toBe('Hello');
      expect(truncateText('Hi', 5)).toBe('Hi');
    });
  });

  describe('calculateCartTotal', () => {
    it('calculates total correctly', () => {
      const items = [
        { price: 100, quantity: 2 },
        { price: 50, quantity: 1 },
      ];
      expect(calculateCartTotal(items)).toBe(250);
    });

    it('returns 0 for empty cart', () => {
      expect(calculateCartTotal([])).toBe(0);
    });
  });

  describe('generateSlug', () => {
    it('generates slug from text', () => {
      expect(generateSlug('Hello World')).toBe('hello-world');
      expect(generateSlug('  Test   String  ')).toBe('test-string');
      expect(generateSlug('Special @#$ Characters')).toBe('special-characters');
    });
  });

  describe('isValidEmail', () => {
    it('validates correct email', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
    });

    it('invalidates incorrect email', () => {
      expect(isValidEmail('testexample.com')).toBe(false);
      expect(isValidEmail('test@')).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });
  });

  describe('getInitials', () => {
    it('gets initials from name', () => {
      expect(getInitials('John Doe')).toBe('JD');
      expect(getInitials('John')).toBe('J');
      expect(getInitials('John Doe Smith')).toBe('JD');
    });
  });

  describe('isEmpty', () => {
    it('checks for empty values', () => {
      expect(isEmpty(null)).toBe(true);
      expect(isEmpty(undefined)).toBe(true);
      expect(isEmpty('')).toBe(true);
      expect(isEmpty('  ')).toBe(true); // Assuming trim check
      expect(isEmpty([])).toBe(true);
      expect(isEmpty({})).toBe(true);
      
      expect(isEmpty('a')).toBe(false);
      expect(isEmpty([1])).toBe(false);
      expect(isEmpty({ a: 1 })).toBe(false);
    });
  });
});
