
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
jest.unstable_mockModule('../../../models/Order.js', () => ({
  default: mockOrder
}));

// Import the service under test (dynamically after mocks)
const {
  default: orderTrackingService,
  TRACKING_STATUS,
  OTHER_CARRIER_CODE,
  MAX_CUSTOM_CARRIER_NAME,
} = await import('../../../services/orderTrackingService.js');

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

    test('stores the typed courier name and no tracking link for OTHER', async () => {
      mockOrder.findById.mockResolvedValue(mockOrderInstance);
      mockOrderInstance.estimatedDelivery = undefined;

      const result = await orderTrackingService.addTrackingInfo('order123', {
        trackingNumber: 'TRK-99887',
        carrierCode: OTHER_CARRIER_CODE,
        carrierName: '  Trackon Couriers  '
      });

      expect(result.success).toBe(true);
      expect(mockOrderInstance.carrier).toEqual({ name: 'Trackon Couriers', code: OTHER_CARRIER_CODE });
      expect(mockOrderInstance.carrier.trackingUrl).toBeUndefined();
      // Unknown courier → no SLA → no invented ETA.
      expect(mockOrderInstance.estimatedDelivery).toBeUndefined();
    });

    test('rejects OTHER without a courier name', async () => {
      mockOrder.findById.mockResolvedValue(mockOrderInstance);

      const result = await orderTrackingService.addTrackingInfo('order123', {
        trackingNumber: 'TRK-99887',
        carrierCode: OTHER_CARRIER_CODE,
        carrierName: '   '
      });

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Courier name is required/);
      expect(mockOrderInstance.save).not.toHaveBeenCalled();
    });
  });

  describe('resolveCarrier', () => {
    test('returns a built-in carrier untouched', () => {
      const { carrier, error } = orderTrackingService.resolveCarrier('FEDEX');
      expect(error).toBeNull();
      expect(carrier.name).toBe('FedEx');
    });

    test('rejects an unknown code', () => {
      const { carrier, error } = orderTrackingService.resolveCarrier('NOPE');
      expect(carrier).toBeNull();
      expect(error).toMatch(/Unknown carrier code/);
    });

    test('uses the trimmed admin-typed name for OTHER', () => {
      const { carrier, error } = orderTrackingService.resolveCarrier(OTHER_CARRIER_CODE, ' Trackon ');
      expect(error).toBeNull();
      expect(carrier.name).toBe('Trackon');
      expect(carrier.code).toBe(OTHER_CARRIER_CODE);
    });

    test.each([undefined, '', '   ', 42])('rejects OTHER with a missing name (%p)', (name) => {
      const { carrier, error } = orderTrackingService.resolveCarrier(OTHER_CARRIER_CODE, name);
      expect(carrier).toBeNull();
      expect(error).toMatch(/Courier name is required/);
    });

    test('rejects an over-long courier name', () => {
      const { carrier, error } = orderTrackingService.resolveCarrier(
        OTHER_CARRIER_CODE,
        'x'.repeat(MAX_CUSTOM_CARRIER_NAME + 1)
      );
      expect(carrier).toBeNull();
      expect(error).toMatch(/characters or fewer/);
    });

    test('accepts a name exactly at the limit', () => {
      const name = 'x'.repeat(MAX_CUSTOM_CARRIER_NAME);
      const { carrier, error } = orderTrackingService.resolveCarrier(OTHER_CARRIER_CODE, name);
      expect(error).toBeNull();
      expect(carrier.name).toBe(name);
    });
  });

  describe('buildCarrierSubdoc', () => {
    test('appends the tracking number to a built-in carrier URL', () => {
      const { carrier } = orderTrackingService.resolveCarrier('FEDEX');
      expect(orderTrackingService.buildCarrierSubdoc(carrier, '123456789012')).toEqual({
        name: 'FedEx',
        code: 'FEDEX',
        trackingUrl: 'https://www.fedex.com/fedextrack/?trknbr=123456789012',
      });
    });

    test('omits trackingUrl entirely for a custom courier', () => {
      const { carrier } = orderTrackingService.resolveCarrier(OTHER_CARRIER_CODE, 'Trackon');
      const subdoc = orderTrackingService.buildCarrierSubdoc(carrier, 'TRK-99887');
      expect(subdoc).toEqual({ name: 'Trackon', code: OTHER_CARRIER_CODE });
      expect('trackingUrl' in subdoc).toBe(false);
    });
  });

  describe('getSupportedCarriers', () => {
    test('lists OTHER last and flags it as custom', () => {
      const carriers = orderTrackingService.getSupportedCarriers();
      const other = carriers[carriers.length - 1];
      expect(other.code).toBe(OTHER_CARRIER_CODE);
      expect(other.custom).toBe(true);
      // Built-in carriers must not be flagged — the admin UI keys its input off it.
      expect(carriers.filter((c) => c.custom)).toHaveLength(1);
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
