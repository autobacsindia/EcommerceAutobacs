
import { jest } from '@jest/globals';

// Mock Order model
const mockOrder = {
  findById: jest.fn(),
  findOne: jest.fn(),
  aggregate: jest.fn(),
};

// Define mock instances
const mockOrderInstance = {
  _id: 'order123',
  save: jest.fn().mockResolvedValue(true),
  trackingEvents: [],
  status: 'shipped',
  fulfillmentMetrics: {}
};

// Setup mocks using unstable_mockModule
jest.unstable_mockModule('../../models/Order.js', () => ({
  default: mockOrder
}));

// Import the service under test (dynamically after mocks)
const { default: orderTrackingService, TRACKING_STATUS } = await import('../../services/orderTrackingService.js');

describe('OrderTrackingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrder.findById.mockReset();
    mockOrder.findOne.mockReset();
    mockOrder.aggregate.mockReset();
    mockOrderInstance.save.mockClear();
    mockOrderInstance.trackingEvents = [];
    mockOrderInstance.status = 'shipped';
  });

  describe('generateTrackingNumber', () => {
    test('should generate numeric tracking number for FEDEX', () => {
      const trackingNumber = orderTrackingService.generateTrackingNumber('FEDEX');
      expect(trackingNumber).toMatch(/^[0-9]{12}$/);
    });

    test('should generate UPS format tracking number', () => {
      const trackingNumber = orderTrackingService.generateTrackingNumber('UPS');
      expect(trackingNumber).toMatch(/^1Z[A-Z0-9]{16}$/);
    });

    test('should throw error for invalid carrier', () => {
      expect(() => {
        orderTrackingService.generateTrackingNumber('INVALID_CARRIER');
      }).toThrow('Invalid carrier code');
    });
  });

  describe('validateTrackingNumber', () => {
    test('should return true for valid tracking number', () => {
      // Mock regex match logic implicitly by providing correct format
      // FEDEX: 12-14 digits.
      const isValid = orderTrackingService.validateTrackingNumber('123456789012', 'FEDEX');
      expect(isValid).toBe(true);
    });

    test('should return false for invalid tracking number', () => {
      const isValid = orderTrackingService.validateTrackingNumber('INVALID', 'FEDEX');
      expect(isValid).toBe(false);
    });
  });

  describe('addTrackingInfo', () => {
    test('should add tracking info to order', async () => {
      mockOrder.findById.mockResolvedValue(mockOrderInstance);

      const result = await orderTrackingService.addTrackingInfo('order123', {
        trackingNumber: '123456789012',
        carrierCode: 'FEDEX',
        notes: 'Test note'
      });

      expect(result.success).toBe(true);
      expect(mockOrderInstance.trackingNumber).toBe('123456789012');
      expect(mockOrderInstance.carrier.code).toBe('FEDEX');
      expect(mockOrderInstance.save).toHaveBeenCalled();
      expect(mockOrderInstance.trackingEvents).toHaveLength(1);
      expect(mockOrderInstance.trackingEvents[0].status).toBe(TRACKING_STATUS.LABEL_CREATED);
    });

    test('should return error if order not found', async () => {
      mockOrder.findById.mockResolvedValue(null);

      const result = await orderTrackingService.addTrackingInfo('order123', {
        trackingNumber: '123456789012',
        carrierCode: 'FEDEX'
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Order not found');
    });
  });

  describe('addTrackingEvent', () => {
    test('should add tracking event and update status', async () => {
      mockOrderInstance.trackingNumber = '123456789012';
      mockOrder.findById.mockResolvedValue(mockOrderInstance);

      const result = await orderTrackingService.addTrackingEvent('order123', {
        status: TRACKING_STATUS.IN_TRANSIT,
        location: 'New York',
        description: 'Arrived at facility'
      });

      expect(result.success).toBe(true);
      expect(mockOrderInstance.trackingEvents).toHaveLength(1);
      expect(mockOrderInstance.trackingEvents[0].status).toBe(TRACKING_STATUS.IN_TRANSIT);
      expect(mockOrderInstance.save).toHaveBeenCalled();
    });

    test('should auto-update order status to delivered', async () => {
      mockOrderInstance.trackingNumber = '123456789012';
      mockOrderInstance.status = 'shipped';
      mockOrder.findById.mockResolvedValue(mockOrderInstance);

      const result = await orderTrackingService.addTrackingEvent('order123', {
        status: TRACKING_STATUS.DELIVERED,
        location: 'Home'
      });

      expect(result.success).toBe(true);
      expect(mockOrderInstance.status).toBe('delivered');
      expect(mockOrderInstance.deliveredAt).toBeDefined();
    });
  });

  describe('getTrackingStatistics', () => {
    test('should return statistics', async () => {
      const mockStats = [{ carrierName: 'FedEx', totalOrders: 10 }];
      mockOrder.aggregate.mockResolvedValue(mockStats);

      const result = await orderTrackingService.getTrackingStatistics();

      expect(result.success).toBe(true);
      expect(result.statistics).toEqual(mockStats);
      expect(mockOrder.aggregate).toHaveBeenCalled();
    });
  });
});
