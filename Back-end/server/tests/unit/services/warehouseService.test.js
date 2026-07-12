
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
  findOneAndUpdate: jest.fn(),
  countDocuments: jest.fn(),
  findWarehousesWithStock: jest.fn(),
  getTotalStock: jest.fn(),
  getLowStockItems: jest.fn(),
};

// Minimal mongoose stub — selectWarehouseForOrder only needs a session whose
// withTransaction runs the callback (no real replica set in unit tests).
// jest config uses resetMocks:true, so startSession's implementation is
// (re)applied in beforeEach rather than in the module factory.
const mockSession = {
  withTransaction: async (fn) => { await fn(); },
  endSession: jest.fn(),
};
const mockMongoose = { startSession: jest.fn() };

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
jest.unstable_mockModule('../../../models/Warehouse.js', () => ({
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

jest.unstable_mockModule('../../../models/WarehouseInventory.js', () => ({
  default: class WarehouseInventory {
    constructor(data) {
      Object.assign(this, data);
      this.save = mockInventoryInstance.save;
    }
    static find = mockWarehouseInventory.find;
    static findOne = mockWarehouseInventory.findOne;
    static findOneAndUpdate = mockWarehouseInventory.findOneAndUpdate;
    static countDocuments = mockWarehouseInventory.countDocuments;
    static findWarehousesWithStock = mockWarehouseInventory.findWarehousesWithStock;
    static getTotalStock = mockWarehouseInventory.getTotalStock;
    static getLowStockItems = mockWarehouseInventory.getLowStockItems;
  }
}));

jest.unstable_mockModule('../../../models/Product.js', () => ({
  default: {}
}));

jest.unstable_mockModule('mongoose', () => ({
  default: mockMongoose,
}));

// Import service
const { default: warehouseService } = await import('../../../services/warehouseService.js');

describe('WarehouseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // resetMocks:true wipes implementations between tests — reapply the session stub.
    mockMongoose.startSession.mockResolvedValue(mockSession);

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
    test('should normalise manual lat/lng into GeoJSON coordinates', async () => {
      const warehouseData = {
        name: 'Test Warehouse',
        location: {
          address: '123 Main St',
          city: 'City',
          state: 'State',
          postalCode: '12345',
          latitude: 20,
          longitude: 10
        }
      };

      const result = await warehouseService.createWarehouse(warehouseData);

      // [lng, lat] GeoJSON order
      expect(warehouseData.location.coordinates).toEqual({
        type: 'Point',
        coordinates: [10, 20]
      });
      expect(warehouseData.location.latitude).toBeUndefined();
      expect(warehouseData.location.longitude).toBeUndefined();
      expect(mockWarehouseInstance.save).toHaveBeenCalled();
      expect(result).toBeInstanceOf(Object); // Warehouse instance
    });

    test('should reject when coordinates are missing', async () => {
      const warehouseData = {
        name: 'No Coords Warehouse',
        location: { address: '1 St', city: 'C', state: 'S', postalCode: '00000' }
      };

      await expect(warehouseService.createWarehouse(warehouseData)).rejects.toThrow(
        /latitude and longitude are required/i
      );
      expect(mockWarehouseInstance.save).not.toHaveBeenCalled();
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
      // w1 sits on the delivery point (distance 0), w2 is ~157km away — the
      // internal haversine must rank w1 first.
      const warehouses = [
        {
          ...mockWarehouseInstance, _id: 'w2', servicesPinCode: () => true,
          location: { coordinates: { coordinates: [1, 1] } }
        },
        {
          ...mockWarehouseInstance, _id: 'w1', servicesPinCode: () => true,
          location: { coordinates: { coordinates: [0, 0] } }
        }
      ];
      mockWarehouse.find.mockResolvedValue(warehouses);

      // Reservation succeeds (atomic findOneAndUpdate returns the updated doc).
      mockWarehouseInventory.findOneAndUpdate
        .mockResolvedValue({ ...mockInventoryInstance, reservedQuantity: 1 });

      const result = await warehouseService.selectWarehouseForOrder(
        [{ productId: 'p1', quantity: 1 }],
        { coordinates: { latitude: 0, longitude: 0 }, postalCode: '12345' }
      );

      expect(result.available).toBe(true);
      expect(result.warehouse._id).toBe('w1');
      expect(result.distance).toBe(0);
    });

    test('should return unavailable if no warehouse has stock', async () => {
       mockWarehouse.find.mockResolvedValue([mockWarehouseInstance]);
       // Atomic reservation finds nothing with sufficient stock → null.
       mockWarehouseInventory.findOneAndUpdate.mockResolvedValue(null);

       const result = await warehouseService.selectWarehouseForOrder(
        [{ productId: 'p1', quantity: 1 }],
        { coordinates: { latitude: 0, longitude: 0 }, postalCode: '12345' }
      );

      expect(result.available).toBe(false);
    });
  });
});
