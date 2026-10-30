import { jest } from '@jest/globals';

/**
 * Return status emails are once-only per key (ReturnRequest.emailsSent): a queue retry,
 * a double-click or two team members pressing the same button mail the customer ONCE.
 * The stamp lands only after the provider accepts the send, so a failed send retries.
 */

const mockRepo = { findById: jest.fn(), wasEmailed: jest.fn(), markEmailed: jest.fn() };
const mockSend = jest.fn();

jest.unstable_mockModule('../../../repositories/returnRequestRepository.js', () => ({ default: mockRepo }));
jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: { findById: jest.fn() } }));
jest.unstable_mockModule('../../../repositories/paymentRepository.js', () => ({ default: { findById: jest.fn() } }));
jest.unstable_mockModule('../../../services/emailHandler.js', () => ({ default: { sendEmail: mockSend } }));
jest.unstable_mockModule('../../../utils/returnEmailTemplates.js', () => ({
  returnEmail: () => ({ subject: 's', text: 't', html: 'h' }),
}));

const { emailReturnStatus, emailKey } = await import('../../../services/returnCustomerEmailService.js');

const rr = (overrides = {}) => ({
  _id: 'ret-1',
  user: { email: 'c@example.com' },
  order: { _id: 'order-1', orderNumber: 'R-1' },
  courier: { trackingNumber: 'AWB1' },
  refund: { initiatedAt: new Date('2026-10-30T10:00:00Z') },
  ...overrides,
});
const loaded = (doc) => ({
  populate() { return this; },
  then(resolve, reject) { return Promise.resolve(doc).then(resolve, reject); },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRepo.findById.mockImplementation(() => loaded(rr()));
  mockRepo.wasEmailed.mockResolvedValue(false);
  mockRepo.markEmailed.mockResolvedValue(true);
  mockSend.mockResolvedValue({ success: true });
});

describe('emailKey', () => {
  it('keys most events by name, the courier email by AWB and the refund by claim time', () => {
    expect(emailKey(rr(), 'approved')).toBe('approved');
    expect(emailKey(rr(), 'courier_booked')).toBe('courier_booked:AWB1');
    expect(emailKey(rr(), 'refunded')).toBe(`refunded:${new Date('2026-10-30T10:00:00Z').getTime()}`);
  });
});

describe('emailReturnStatus', () => {
  it('sends, then stamps the key', async () => {
    await expect(emailReturnStatus('ret-1', 'approved')).resolves.toEqual({ status: 'sent' });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockRepo.markEmailed).toHaveBeenCalledWith('ret-1', 'approved');
  });

  it('sends nothing when the key is already stamped (queue retry / double-click)', async () => {
    mockRepo.wasEmailed.mockResolvedValue(true);
    await expect(emailReturnStatus('ret-1', 'approved')).resolves.toEqual({ status: 'skipped' });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('does not stamp a failed send, so the queue retry sends it', async () => {
    mockSend.mockResolvedValue({ success: false, error: 'provider down' });
    await expect(emailReturnStatus('ret-1', 'approved')).rejects.toThrow(/provider down/);
    expect(mockRepo.markEmailed).not.toHaveBeenCalled();
  });

  it('never throws after a successful send, even if the stamp fails — a throw would re-send', async () => {
    mockRepo.markEmailed.mockRejectedValue(new Error('db blip'));
    await expect(emailReturnStatus('ret-1', 'refunded')).resolves.toEqual({ status: 'sent' });
  });

  it('still emails a CORRECTED AWB — it is a different message', async () => {
    mockRepo.wasEmailed.mockImplementation(async (_id, key) => key === 'courier_booked:AWB1');
    mockRepo.findById.mockImplementation(() => loaded(rr({ courier: { trackingNumber: 'AWB2' } })));
    await expect(emailReturnStatus('ret-1', 'courier_booked')).resolves.toEqual({ status: 'sent' });
    expect(mockRepo.markEmailed).toHaveBeenCalledWith('ret-1', 'courier_booked:AWB2');
  });
});
