import { jest } from '@jest/globals';
import { cleanupWordPressProducts } from '../utils/wordpressProductCleanup.js';

// Mock Product model
const mockProducts = [
  { 
    _id: '1', 
    name: 'Turbo Charger',
    description: '<p>High performance <strong>turbo charger</strong> for enhanced engine power</p>',
    category: null
  },
  { 
    _id: '2', 
    name: 'LED Headlights',
    description: '<div>Premium <em>LED headlights</em> with bright illumination</div>',
    category: null
  }
];

const mockBulkWriteResult = {
  modifiedCount: 2
};

jest.mock('../models/Product.js', () => ({
  find: jest.fn().mockResolvedValue(mockProducts),
  bulkWrite: jest.fn().mockResolvedValue(mockBulkWriteResult)
}));

// Mock mongoose
jest.mock('mongoose', () => ({
  connect: jest.fn().mockResolvedValue(),
  connection: {
    close: jest.fn().mockResolvedValue(),
    readyState: 1
  }
}));

// Mock dotenv
jest.mock('dotenv', () => ({
  config: jest.fn()
}));

describe('WordPress Product Cleanup Integration', () => {
  test('should clean up products successfully', async () => {
    const result = await cleanupWordPressProducts(10);
    
    expect(result.success).toBe(true);
    expect(result.processed).toBe(2);
    expect(result.updated).toBe(2);
  });

  test('should handle empty product list', async () => {
    // Mock empty product list
    jest.requireMock('../models/Product.js').find.mockResolvedValueOnce([]);
    
    const result = await cleanupWordPressProducts(10);
    
    expect(result.success).toBe(true);
    expect(result.processed).toBe(0);
    expect(result.message).toBe('No products need cleanup');
  });

  test('should handle errors gracefully', async () => {
    // Mock an error in the database operation
    jest.requireMock('../models/Product.js').find.mockRejectedValueOnce(new Error('Database error'));
    
    const result = await cleanupWordPressProducts(10);
    
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});