/**
 * Unit tests for orderStatusService._enqueueStatusNotification — verifies only the
 * Core-4 fulfillment statuses enqueue a customer email, and payment-driven statuses do not.
 */

import { jest } from '@jest/globals';

const mockNotificationsAdd = jest.fn().mockResolvedValue(undefined);
const mockOrderAdd = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../../../queue/queues.js', () => ({
  getNotificationsQueue: () => ({ add: mockNotificationsAdd }),
  getOrderQueue: () => ({ add: mockOrderAdd }),
}));

// The enqueue is gated on REDIS_URL being set (checked at call time, not import).
const ORIGINAL_REDIS_URL = process.env.REDIS_URL;
process.env.REDIS_URL = 'redis://localhost:6379';

const { OrderStatusService } = await import('../../../services/orderStatusService.js');
const service = new OrderStatusService();

beforeEach(() => {
  // mockReset clears calls AND implementation, so re-apply the resolved value
  // (the service calls `.add(...).catch(...)`, so add must return a promise).
  mockNotificationsAdd.mockReset().mockResolvedValue(undefined);
  mockOrderAdd.mockReset().mockResolvedValue(undefined);
});

afterAll(() => {
  // Restore so we don't leak REDIS_URL into other suites in the same worker.
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL;
});

describe('_enqueueStatusNotification', () => {
  test.each(['shipped', 'delivered', 'cancelled', 'refunded'])(
    'enqueues send-order-status-email for Core-4 status %s',
    (status) => {
      service._enqueueStatusNotification('order123', status);
      expect(mockNotificationsAdd).toHaveBeenCalledWith('send-order-status-email', {
        orderId: 'order123',
        status,
      });
    }
  );

  test.each(['confirmed', 'processing', 'pending', 'failed'])(
    'does NOT enqueue an email for non-notified status %s',
    (status) => {
      service._enqueueStatusNotification('order123', status);
      expect(mockNotificationsAdd).not.toHaveBeenCalled();
    }
  );
});
