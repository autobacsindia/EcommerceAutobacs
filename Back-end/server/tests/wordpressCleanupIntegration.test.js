import { jest } from '@jest/globals';

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

// Mock dependencies using unstable_mockModule for ESM
jest.unstable_mockModule('../models/Product.js', async () => {
  const { jest } = await import('@jest/globals');
  const mockModel = {
    find: jest.fn(() => ({
      limit: jest.fn().mockResolvedValue(mockProducts)
    })),
    countDocuments: jest.fn().mockResolvedValue(2),
    bulkWrite: jest.fn().mockResolvedValue(mockBulkWriteResult)
  };
  return {
    __esModule: true,
    default: mockModel,
    ...mockModel
  };
});

jest.unstable_mockModule('mongoose', async () => {
  const { jest } = await import('@jest/globals');
  return {
    default: {
      connect: jest.fn().mockResolvedValue(),
      connection: {
        close: jest.fn().mockResolvedValue(),
        readyState: 1
      }
    }
  };
});

jest.unstable_mockModule('dotenv', async () => {
  const { jest } = await import('@jest/globals');
  return {
    default: {
      config: jest.fn()
    }
  };
});

// Also need to mock Category because it's used deeply
jest.unstable_mockModule('../models/Category.js', async () => {
  const { jest } = await import('@jest/globals');
  const mockModel = {
    find: jest.fn().mockResolvedValue([
      { _id: 'cat4', name: 'PERFORMANCE', isActive: true },
      { _id: 'cat7', name: 'LIGHTS', isActive: true }
    ])
  };
  return {
    __esModule: true,
    default: mockModel,
    ...mockModel
  };
});

// Dynamic import after mocks
const { cleanupWordPressProducts } = await import('../utils/wordpressProductCleanup.js');

describe('WordPress Product Cleanup Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should clean up products successfully', async () => {
    // Reset mocks for this test if needed, but default mocks are fine
    const result = await cleanupWordPressProducts(10);
    
    expect(result.success).toBe(true);
    expect(result.processed).toBe(2);
    // Depending on logic, it might update 2 or 0 if categorization fails.
    // Assuming categorization works (mocked Category), it should be 2.
    // But wait, categorizeProduct might return null if logic fails.
    // Given the mocks and logic, let's assume it works.
    // If it fails, we will see.
  });

  test('should handle empty product list', async () => {
    // We need to override the mock for this test.
    // But since we used unstable_mockModule which is global/hoisted, we can't easily change it per test via the module factory.
    // However, we can import the mocked module and change the implementation of the spy.
    
    const Product = (await import('../models/Product.js')).default;
    Product.find.mockReturnValueOnce({
      limit: jest.fn().mockResolvedValue([])
    });
    
    const result = await cleanupWordPressProducts(10);
    
    expect(result.success).toBe(true);
    expect(result.processed).toBe(0);
    expect(result.message).toBe('No products need cleanup');
  });

  test('should handle errors gracefully', async () => {
    console.log('TEST 3 START');
    const Product = (await import('../models/Product.js')).default;
    Product.find.mockReturnValueOnce({
      limit: jest.fn().mockRejectedValue(new Error('Database error 3'))
    });
    
    const result = await cleanupWordPressProducts(10);
    
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
