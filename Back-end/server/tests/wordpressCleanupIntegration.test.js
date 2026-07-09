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

const mockCats = [
  { _id: 'cat4', name: 'PERFORMANCE', isActive: true },
  { _id: 'cat7', name: 'LIGHTS', isActive: true }
];

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
    // Named export used by the cleanup util to re-index bulkWrite'd products in ES.
    enqueueProductSync: jest.fn(),
    ...mockModel
  };
});

jest.unstable_mockModule('../models/Category.js', async () => {
  const { jest } = await import('@jest/globals');
  return {
    __esModule: true,
    default: {
      find: jest.fn().mockResolvedValue(mockCats)
    }
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

// Dynamic import after mocks
const { cleanupWordPressProducts, runCleanupWordPressProductsCli } =
  await import('../utils/wordpressProductCleanup.js');

describe('WordPress Product Cleanup Integration', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Setup Product mock
    const Product = (await import('../models/Product.js')).default;
    Product.find.mockImplementation(() => ({
      limit: jest.fn().mockResolvedValue(mockProducts)
    }));
    Product.countDocuments.mockResolvedValue(2);
    Product.bulkWrite.mockResolvedValue(mockBulkWriteResult);

    // Setup Category mock explicitly to ensure it persists
    const Category = (await import('../models/Category.js')).default;
    Category.find.mockResolvedValue(mockCats);
  });

  test('should clean up products successfully', async () => {
    // Reset mocks for this test if needed, but default mocks are fine
    const result = await cleanupWordPressProducts(10);

    expect(result.success).toBe(true);
    expect(result.processed).toBe(2);

    // bulkWrite bypasses Mongoose hooks, so the util must enqueue ES re-index
    // for every affected product id explicitly.
    const { enqueueProductSync } = await import('../models/Product.js');
    expect(enqueueProductSync).toHaveBeenCalledWith(['1', '2']);
  });

  test('should handle empty product list', async () => {
    // We need to override the mock for this test.
    const Product = (await import('../models/Product.js')).default;
    Product.find.mockReturnValueOnce({
      limit: jest.fn().mockResolvedValue([])
    });
    
    const result = await cleanupWordPressProducts(10);
    
    expect(result.success).toBe(true);
    expect(result.processed).toBe(0);
    expect(result.message).toBe('No products need cleanup');
  });

  // Regression guard: the worker runs inside the live server on the app's shared
  // Mongoose connection. It must NEVER open or close that connection, or an admin
  // hitting POST /products/cleanup/wordpress would drop the whole app's DB link.
  test('cleanupWordPressProducts does NOT touch the shared Mongoose connection', async () => {
    const mongoose = (await import('mongoose')).default;

    await cleanupWordPressProducts(10);

    expect(mongoose.connect).not.toHaveBeenCalled();
    expect(mongoose.connection.close).not.toHaveBeenCalled();
  });

  // The CLI runner is the ONLY place that owns the connection lifecycle.
  test('runCleanupWordPressProductsCli connects, runs cleanup, then closes', async () => {
    const mongoose = (await import('mongoose')).default;

    const result = await runCleanupWordPressProductsCli(10);

    expect(result.success).toBe(true);
    expect(mongoose.connect).toHaveBeenCalledTimes(1);
    expect(mongoose.connection.close).toHaveBeenCalledTimes(1);
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
