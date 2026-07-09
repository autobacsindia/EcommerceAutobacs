/**
 * Unit tests for orderStatusEmailService.emailOrderStatusUpdate.
 * DB + provider are mocked; asserts recipient resolution, idempotency, and marking.
 */

import { jest } from '@jest/globals';

const mockFindById = jest.fn();
const mockSave = jest.fn();
const mockSendStatus = jest.fn();

jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({
  default: { findById: mockFindById, save: mockSave },
}));

jest.unstable_mockModule('../../../services/emailHandler.js', () => ({
  default: { sendOrderStatusUpdate: mockSendStatus },
}));

const { emailOrderStatusUpdate } = await import('../../../services/orderStatusEmailService.js');

const makeOrder = (over = {}) => ({
  _id: 'order123',
  user: { name: 'Asha', email: 'asha@example.com' },
  notifiedStatuses: [],
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('emailOrderStatusUpdate', () => {
  test('sends and marks notifiedStatuses on first call', async () => {
    const order = makeOrder();
    mockFindById.mockResolvedValue(order);
    mockSendStatus.mockResolvedValue({ success: true });

    const result = await emailOrderStatusUpdate('order123', 'shipped');

    expect(result).toEqual({ status: 'sent' });
    expect(mockSendStatus).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'asha@example.com', status: 'shipped' })
    );
    expect(order.notifiedStatuses).toContain('shipped');
    expect(mockSave).toHaveBeenCalledWith(order);
  });

  test('is idempotent — skips if the status was already notified', async () => {
    mockFindById.mockResolvedValue(makeOrder({ notifiedStatuses: ['shipped'] }));

    const result = await emailOrderStatusUpdate('order123', 'shipped');

    expect(result).toEqual({ status: 'skipped' });
    expect(mockSendStatus).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  test('returns not-found when the order is missing', async () => {
    mockFindById.mockResolvedValue(null);
    expect(await emailOrderStatusUpdate('missing', 'delivered')).toEqual({ status: 'not-found' });
    expect(mockSendStatus).not.toHaveBeenCalled();
  });

  test('falls back to guestEmail and skips when no recipient', async () => {
    mockFindById.mockResolvedValue(makeOrder({ user: null, guestEmail: null }));
    const result = await emailOrderStatusUpdate('order123', 'delivered');
    expect(result).toEqual({ status: 'no-recipient' });
    expect(mockSendStatus).not.toHaveBeenCalled();
  });

  test('does NOT mark notified and throws when the provider fails (so BullMQ retries)', async () => {
    const order = makeOrder();
    mockFindById.mockResolvedValue(order);
    mockSendStatus.mockResolvedValue({ success: false, error: 'postmark down' });

    await expect(emailOrderStatusUpdate('order123', 'cancelled')).rejects.toThrow(/postmark down/);
    expect(order.notifiedStatuses).not.toContain('cancelled');
    expect(mockSave).not.toHaveBeenCalled();
  });

  test('attaches the shipping slip PDF on a shipped email', async () => {
    const order = makeOrder({ shippingSlip: { url: 'https://cdn.example/slip.pdf' } });
    mockFindById.mockResolvedValue(order);
    mockSendStatus.mockResolvedValue({ success: true });
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, arrayBuffer: async () => Buffer.from('%PDF-1.4 fake').buffer });

    const result = await emailOrderStatusUpdate('order123', 'shipped');

    expect(result).toEqual({ status: 'sent' });
    // Called with a bounded AbortSignal so a stalled fetch can't hang the worker.
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://cdn.example/slip.pdf',
      expect.objectContaining({ signal: expect.anything() }),
    );
    const arg = mockSendStatus.mock.calls[0][0];
    expect(arg.attachments).toHaveLength(1);
    expect(arg.attachments[0]).toEqual(
      expect.objectContaining({ ContentType: 'application/pdf', Content: expect.any(String) })
    );
    fetchSpy.mockRestore();
  });

  test('still sends the shipped email (no attachment) if the slip download fails', async () => {
    const order = makeOrder({ shippingSlip: { url: 'https://cdn.example/gone.pdf' } });
    mockFindById.mockResolvedValue(order);
    mockSendStatus.mockResolvedValue({ success: true });
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 });

    const result = await emailOrderStatusUpdate('order123', 'shipped');

    expect(result).toEqual({ status: 'sent' });
    expect(mockSendStatus.mock.calls[0][0].attachments).toBeUndefined();
    fetchSpy.mockRestore();
  });
});
