
import { jest } from '@jest/globals';

// Define mock before imports
jest.unstable_mockModule('../../models/Order.js', () => ({
  default: {
    findById: jest.fn(),
    aggregate: jest.fn(),
    find: jest.fn(),
  }
}));

// Dynamic imports after mock
const { OrderStatusService } = await import('../../services/orderStatusService.js');
const { default: Order } = await import('../../models/Order.js');

describe('OrderStatusService', () => {
  let service;
  
  // Mock Order document
  const mockOrder = {
    _id: 'order123',
    status: 'pending',
    user: 'user123',
    save: jest.fn(),
    statusHistory: [],
    fulfillmentMetrics: {}
  };

  beforeEach(() => {
    service = new OrderStatusService();
    jest.clearAllMocks();
  });

  describe('validateTransition', () => {
    it('should validate valid transition', () => {
      const result = service.validateTransition('pending', 'confirmed');
      expect(result.valid).toBe(true);
    });

    it('should invalidate invalid transition', () => {
      const result = service.validateTransition('pending', 'delivered');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Allowed transitions');
    });

    it('should validate admin override for invalid transition', () => {
      const result = service.validateTransition('pending', 'delivered', true);
      expect(result.valid).toBe(true);
    });

    it('should validate admin-only transition for non-admin', () => {
      const result = service.validateTransition('processing', 'cancelled', false);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Admin permission required');
    });

     it('should validate admin-only transition for admin', () => {
      const result = service.validateTransition('processing', 'cancelled', true);
      expect(result.valid).toBe(true);
    });
    
    it('should handle unknown status', () => {
        const result = service.validateTransition('unknown_status', 'pending');
        expect(result.valid).toBe(false);
        expect(result.message).toContain('Invalid current status');
    });
  });

  describe('getValidNextStatuses', () => {
    it('should return allowed statuses for pending', () => {
        const statuses = service.getValidNextStatuses('pending');
        expect(statuses).toContain('confirmed');
        expect(statuses).toContain('cancelled');
    });
    
    it('should filter admin-only statuses for non-admin', () => {
        // processing -> cancelled is admin only
        const statuses = service.getValidNextStatuses('processing', false);
        expect(statuses).not.toContain('cancelled');
        expect(statuses).toContain('shipped');
    });
    
    it('should include admin-only statuses for admin', () => {
        const statuses = service.getValidNextStatuses('processing', true);
        expect(statuses).toContain('cancelled');
    });
  });

  describe('updateOrderStatus', () => {
      it('should update order status successfully', async () => {
          Order.findById.mockResolvedValue(mockOrder);
          mockOrder.status = 'pending';
          mockOrder.save.mockResolvedValue(mockOrder);
          
          const result = await service.updateOrderStatus('order123', 'confirmed', { userId: 'admin1' });
          
          expect(result.success).toBe(true);
          expect(mockOrder.status).toBe('confirmed');
          expect(mockOrder.save).toHaveBeenCalled();
          expect(mockOrder.statusHistory.length).toBe(1);
          expect(mockOrder.statusHistory[0].status).toBe('confirmed');
      });
      
      it('should fail if order not found', async () => {
          Order.findById.mockResolvedValue(null);
          
          const result = await service.updateOrderStatus('order123', 'confirmed');
          
          expect(result.success).toBe(false);
          expect(result.message).toBe('Order not found');
      });
      
      it('should fail if transition invalid', async () => {
          Order.findById.mockResolvedValue(mockOrder);
          mockOrder.status = 'pending';
          
          const result = await service.updateOrderStatus('order123', 'delivered');
          
          expect(result.success).toBe(false);
          expect(result.message).toContain('Allowed transitions');
      });
      
      it('should fail if reason is invalid', async () => {
          Order.findById.mockResolvedValue(mockOrder);
          mockOrder.status = 'confirmed'; // Confirmed -> Processing
          
          // 'processing' allows reasons: ['warehouse_assigned', 'items_picked', 'packing_started']
          const result = await service.updateOrderStatus('order123', 'processing', { 
              reason: 'invalid_reason' 
          });
          
          expect(result.success).toBe(false);
          expect(result.message).toContain('Invalid reason');
      });
      
      it('should allow admin_update reason for admins', async () => {
          Order.findById.mockResolvedValue(mockOrder);
          mockOrder.status = 'pending'; 
          mockOrder.save.mockResolvedValue(mockOrder);
          
          // Admin force update pending -> delivered (normally invalid)
          // But with isAdmin=true, transition is valid.
          // And reason 'admin_update' should be valid.
          
          const result = await service.updateOrderStatus('order123', 'delivered', { 
              isAdmin: true,
              reason: 'admin_update'
          });
          
          expect(result.success).toBe(true);
          expect(mockOrder.status).toBe('delivered');
      });
  });

  describe('canCustomerCancel', () => {
      it('should allow cancellation for pending order', () => {
          const result = service.canCustomerCancel({ status: 'pending' });
          expect(result.canCancel).toBe(true);
      });
      
      it('should allow cancellation for confirmed order', () => {
          const result = service.canCustomerCancel({ status: 'confirmed' });
          expect(result.canCancel).toBe(true);
      });
      
      it('should not allow cancellation for shipped order', () => {
          const result = service.canCustomerCancel({ status: 'shipped' });
          expect(result.canCancel).toBe(false);
      });
  });
});
