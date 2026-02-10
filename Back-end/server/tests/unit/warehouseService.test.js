
import { jest } from '@jest/globals';

// Mock models
const mockWarehouse = {
  find: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findNearest: jest.fn(),
  save: jest.fn(), // Instance method mock handled in implementation
};

const mockWarehouseInventory = {
  find: jest.fn(),
  findOne: jest.fn(),
  countDocuments: jest.fn(),
  findWarehousesWithStock: jest.fn(),
  getTotalStock: jest.fn(),
  getLowStockItems: jest.fn(),
};

// Mock Google Maps Service
const mockGoogleMapsService = {
  geocodeAddress: jest.fn(),
  calculateDistance: jest.fn(),
};

// Mock Warehouse Instance
const mockWarehouseInstance = {
  _id: 'warehouse123',
  save: jest.fn().mockResolvedValue(true),
  location: { coordinates: { coordinates: [0, 0] } },
  serviceablePinCodes: [],
  servicesPinCode: jest.fn().mockReturnValue(true),
};

const mockInventoryInstance = {
  _id: 'inv123',
  quantity: 10,
  save: jest.fn().mockResolvedValue(true),
  incrementStock: jest.fn().mockResolvedValue(true),
  decrementStock: jest.fn().mockResolvedValue(true),
  reserveStock: jest.fn().mockResolvedValue(true),
  releaseStock: jest.fn().mockResolvedValue(true),
};

// Setup mocks
jest.unstable_mockModule('../../models/Warehouse.js', () => ({
  default: class Warehouse {
    constructor(data) {
      Object.assign(this, data);
      this.save = mockWarehouseInstance.save;
    }
    static find = mockWarehouse.find;
    static findById = mockWarehouse.findById;
    static findByIdAndUpdate = mockWarehouse.findByIdAndUpdate;
    static findNearest = mockWarehouse.findNearest;
  }
}));

jest.unstable_mockModule('../../models/WarehouseInventory.js', () => ({
  default: class WarehouseInventory {
    constructor(data) {
      Object.assign(this, data);
      this.save = mockInventoryInstance.save;
    }
    static find = mockWarehouseInventory.find;
    static findOne = mockWarehouseInventory.findOne;
    static countDocuments = mockWarehouseInventory.countDocuments;
    static findWarehousesWithStock = mockWarehouseInventory.findWarehousesWithStock;
    static getTotalStock = mockWarehouseInventory.getTotalStock;
    static getLowStockItems = mockWarehouseInventory.getLowStockItems;
  }
}));

jest.unstable_mockModule('../../models/Product.js', () => ({
  default: {}
}));

jest.unstable_mockModule('../../services/googleMapsService.js', () => ({
  default: mockGoogleMapsService
}));

// Import service
const { default: warehouseService } = await import('../../services/warehouseService.js');

describe('WarehouseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset chainable mocks
    mockWarehouse.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
      then: function(resolve) { resolve([]); } // For await
    });

    mockWarehouseInventory.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      then: function(resolve) { resolve([]); }
    });
  });

  describe('createWarehouse', () => {
    test('should create warehouse with geocoding', async () => {
      mockGoogleMapsService.geocodeAddress.mockResolvedValue({
        coordinates: { longitude: 10, latitude: 20 }
      });

      const warehouseData = {
        name: 'Test Warehouse',
        location: {
          address: '123 Main St',
          city: 'City',
          state: 'State',
          postalCode: '12345'
        }
      };

      const result = await warehouseService.createWarehouse(warehouseData);

      expect(mockGoogleMapsService.geocodeAddress).toHaveBeenCalled();
      expect(mockWarehouseInstance.save).toHaveBeenCalled();
      expect(result).toBeInstanceOf(Object); // Warehouse instance
    });
  });

  describe('getAllWarehouses', () => {
    test('should return warehouses with filters', async () => {
      const mockWarehouses = [mockWarehouseInstance];
      mockWarehouse.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockWarehouses)
      });

      const result = await warehouseService.getAllWarehouses({ city: 'City' });

      expect(mockWarehouse.find).toHaveBeenCalledWith(expect.objectContaining({
        'location.city': 'City'
      }));
      expect(result).toEqual(mockWarehouses);
    });
  });

  describe('updateWarehouseStock', () => {
    test('should update existing inventory stock', async () => {
      mockWarehouseInventory.findOne.mockResolvedValue(mockInventoryInstance);

      const result = await warehouseService.updateWarehouseStock('w1', 'p1', {
        quantity: 5,
        operation: 'increment'
      });

      expect(mockInventoryInstance.incrementStock).toHaveBeenCalledWith(5);
      expect(result).toBe(mockInventoryInstance);
    });

    test('should create new inventory if not found', async () => {
      mockWarehouseInventory.findOne.mockResolvedValue(null);
      // constructor mock handles creation
      
      const result = await warehouseService.updateWarehouseStock('w1', 'p1', {
        quantity: 50,
        operation: 'set'
      });

      expect(mockInventoryInstance.save).toHaveBeenCalled();
    });
  });

  describe('selectWarehouseForOrder', () => {
    test('should select nearest warehouse with stock', async () => {
      const warehouses = [
        { ...mockWarehouseInstance, _id: 'w1', servicesPinCode: () => true },
        { ...mockWarehouseInstance, _id: 'w2', servicesPinCode: () => true }
      ];
      mockWarehouse.find.mockResolvedValue(warehouses);
      
      // w1 has stock, w2 has stock. w1 is closer (mock distance)
      mockWarehouseInventory.findOne
        .mockResolvedValueOnce({ ...mockInventoryInstance, availableQuantity: 100 }) // w1
        .mockResolvedValueOnce({ ...mockInventoryInstance, availableQuantity: 100 }); // w2

      mockGoogleMapsService.calculateDistance
        .mockReturnValueOnce(1000) // w1 distance
        .mockReturnValueOnce(2000); // w2 distance

      const result = await warehouseService.selectWarehouseForOrder(
        [{ productId: 'p1', quantity: 1 }],
        { coordinates: { latitude: 0, longitude: 0 }, postalCode: '12345' }
      );

      expect(result.available).toBe(true);
      expect(result.warehouse._id).toBe('w1');
      expect(result.distance).toBe(1000);
    });

    test('should return unavailable if no warehouse has stock', async () => {
       mockWarehouse.find.mockResolvedValue([mockWarehouseInstance]);
       mockWarehouseInventory.findOne.mockResolvedValue({ ...mockInventoryInstance, availableQuantity: 0 }); // No stock

       const result = await warehouseService.selectWarehouseForOrder(
        [{ productId: 'p1', quantity: 1 }],
        { coordinates: { latitude: 0, longitude: 0 }, postalCode: '12345' }
      );

      expect(result.available).toBe(false);
    });
  });
});
