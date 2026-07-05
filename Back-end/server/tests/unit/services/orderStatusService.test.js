
import { jest } from '@jest/globals';

// Mock Order model
const mockSave = jest.fn();
const mockOrderInstance = {
  _id: 'order123',
  status: 'awaiting_payment',
  save: mockSave,
  statusHistory: [],
  fulfillmentMetrics: {}
};

const mockOrderModel = {
  findById: jest.fn(),
  aggregate: jest.fn()
};

jest.unstable_mockModule('../../../models/Order.js', () => ({
  default: mockOrderModel
}));

// Import service after mocking
const { OrderStatusService } = await import('../../../services/orderStatusService.js');

describe('OrderStatusService Unit Tests', () => {
  let service;

  beforeEach(() => {
    service = new OrderStatusService();
    jest.clearAllMocks();
    mockSave.mockClear();

    // Reset mock order instance defaults
    mockOrderInstance.status = 'awaiting_payment';
    mockOrderInstance.statusHistory = [];
    mockOrderInstance.fulfillmentMetrics = {};
    mockOrderInstance.save = mockSave;
  });

  describe('validateTransition', () => {
    it('should allow valid transitions', () => {
      const result = service.validateTransition('awaiting_payment', 'processing');
      expect(result.valid).toBe(true);
    });

    it('should reject invalid transitions', () => {
      const result = service.validateTransition('awaiting_payment', 'delivered');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Cannot transition');
    });

    it('should reject non-existent statuses', () => {
      const result = service.validateTransition('invalid_status', 'processing');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Invalid current status');
    });

    it('should enforce admin-only transitions', () => {
      // processing -> cancelled requires admin
      const resultUser = service.validateTransition('processing', 'cancelled', false);
      expect(resultUser.valid).toBe(false);
      expect(resultUser.message).toContain('Admin permission required');

      const resultAdmin = service.validateTransition('processing', 'cancelled', true);
      expect(resultAdmin.valid).toBe(true);
    });

    it('should allow admins to bypass transition rules', () => {
      // awaiting_payment -> delivered is normally invalid
      const resultUser = service.validateTransition('awaiting_payment', 'delivered', false);
      expect(resultUser.valid).toBe(false);

      const resultAdmin = service.validateTransition('awaiting_payment', 'delivered', true);
      expect(resultAdmin.valid).toBe(true);
    });
  });

  describe('getValidNextStatuses', () => {
    it('should return valid next statuses for user', () => {
      const statuses = service.getValidNextStatuses('awaiting_payment', false);
      expect(statuses).toContain('processing');
      expect(statuses).toContain('cancelled');
    });

    it('should filter out admin-only transitions for regular users', () => {
      // processing -> cancelled is admin only
      const statuses = service.getValidNextStatuses('processing', false);
      expect(statuses).not.toContain('cancelled');
      expect(statuses).toContain('shipped');
    });

    it('should include admin-only transitions for admins', () => {
      const statuses = service.getValidNextStatuses('processing', true);
      expect(statuses).toContain('cancelled');
      expect(statuses).toContain('shipped');
    });
  });

  describe('canCustomerCancel', () => {
    it('should allow cancellation for an unpaid (awaiting_payment) order', () => {
      const result = service.canCustomerCancel({ status: 'awaiting_payment' });
      expect(result.canCancel).toBe(true);
    });

    it('should allow cancellation for a processing order', () => {
      const result = service.canCustomerCancel({ status: 'processing' });
      expect(result.canCancel).toBe(true);
    });

    it('should not allow cancellation for shipped order', () => {
      const result = service.canCustomerCancel({ status: 'shipped' });
      expect(result.canCancel).toBe(false);
    });
  });

  describe('updateOrderStatus', () => {
    it('should update status successfully for valid transition', async () => {
      mockOrderModel.findById.mockResolvedValue(mockOrderInstance);
      mockOrderInstance.status = 'awaiting_payment';

      const result = await service.updateOrderStatus('order123', 'processing', {
        userId: 'user123',
        reason: 'payment_verified'
      });

      expect(result.success).toBe(true);
      expect(mockOrderInstance.status).toBe('processing');
      expect(mockSave).toHaveBeenCalled();
      expect(mockOrderInstance.statusHistory).toHaveLength(1);
      expect(mockOrderInstance.statusHistory[0].status).toBe('processing');
      expect(mockOrderInstance.statusHistory[0].reason).toBe('payment_verified');
    });

    it('should fail if order not found', async () => {
      mockOrderModel.findById.mockResolvedValue(null);

      const result = await service.updateOrderStatus('nonexistent', 'processing');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Order not found');
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('should fail for invalid transition', async () => {
      mockOrderModel.findById.mockResolvedValue(mockOrderInstance);
      mockOrderInstance.status = 'awaiting_payment';

      const result = await service.updateOrderStatus('order123', 'delivered');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Cannot transition');
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('should fail for invalid reason', async () => {
      mockOrderModel.findById.mockResolvedValue(mockOrderInstance);
      mockOrderInstance.status = 'awaiting_payment';

      const result = await service.updateOrderStatus('order123', 'processing', {
        reason: 'invalid_reason'
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid reason');
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('should allow admin_update reason for admins', async () => {
      mockOrderModel.findById.mockResolvedValue(mockOrderInstance);
      mockOrderInstance.status = 'awaiting_payment';

      const result = await service.updateOrderStatus('order123', 'delivered', {
        isAdmin: true,
        reason: 'admin_update'
      });

      expect(result.success).toBe(true);
      expect(mockOrderInstance.status).toBe('delivered');
      expect(mockSave).toHaveBeenCalled();
    });

    it('should update metrics when status changes to shipped', async () => {
      mockOrderModel.findById.mockResolvedValue(mockOrderInstance);
      mockOrderInstance.status = 'processing';
      // Time-to-ship is measured from processing start.
      mockOrderInstance.fulfillmentMetrics = {
        processingStartedAt: new Date(Date.now() - 3600000) // 1 hour ago
      };

      const result = await service.updateOrderStatus('order123', 'shipped', {
        userId: 'admin123'
      });

      expect(result.success).toBe(true);
      expect(mockOrderInstance.fulfillmentMetrics.shippedAt).toBeDefined();
      expect(mockOrderInstance.fulfillmentMetrics.timeToShip).toBe(1); // 1 hour
    });
  });
});
