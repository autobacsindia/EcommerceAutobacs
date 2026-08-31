import { jest } from '@jest/globals';

/**
 * emailAdminReturnRefundedAlert — the finance alert that fires whenever money leaves
 * against a return.
 *
 * The case under test is the OFFLINE payout: no Razorpay refund exists, so the gateway
 * wording ("initiated to the customer's original payment method") is false, the "Refund
 * id" row is permanently blank, and the two facts finance actually needs — how it was
 * paid and the operator's reference — were missing entirely.
 */

const mockSendEmail = jest.fn();
const mockReturnRepo = { findById: jest.fn() };

jest.unstable_mockModule('../../../repositories/returnRequestRepository.js', () => ({ default: mockReturnRepo }));
jest.unstable_mockModule('../../../repositories/reviewRepository.js', () => ({ default: { findById: jest.fn() } }));
jest.unstable_mockModule('../../../repositories/consultationRepository.js', () => ({ default: { findById: jest.fn() } }));
jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: { findById: jest.fn() } }));
jest.unstable_mockModule('../../../services/invoiceService.js', () => ({ orderNumber: (o) => `#${o?._id || ''}` }));
jest.unstable_mockModule('../../../services/emailHandler.js', () => ({ default: { sendEmail: mockSendEmail } }));
jest.unstable_mockModule('../../../config/company.js', () => ({
  default: { name: 'Autobacs India', email: 'support@autobacsindia.com' },
}));

const { emailAdminReturnRefundedAlert } = await import('../../../services/adminNotificationService.js');

/** The repo call chains .populate() three times before awaiting. */
const loads = (doc) => {
  const chain = { populate: () => chain, then: (res) => Promise.resolve(doc).then(res) };
  mockReturnRepo.findById.mockReturnValue(chain);
};

const makeReturn = (refund) => ({
  _id: 'ret-1',
  order: { orderNumber: 'AB-1001' },
  user: { name: 'Asha Rao', email: 'asha@example.com' },
  refund,
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ADMIN_NOTIFICATION_EMAIL = 'ops@autobacsindia.com';
  process.env.FRONTEND_URL = 'https://autobacsindia.com';
  mockSendEmail.mockResolvedValue({ success: true });
});

describe('emailAdminReturnRefundedAlert — offline payouts', () => {
  it('says the money was recorded, not sent, and carries the method + reference', async () => {
    loads(makeReturn({
      finalAmount: 1000, productValue: 1000, status: 'completed',
      method: 'offline', offlineMethod: 'cash', reference: 'RCPT-8821',
      initiatedBy: { name: 'Ops Rahul', email: 'rahul@autobacsindia.com' },
    }));

    await emailAdminReturnRefundedAlert('ret-1');
    const { subject, text } = mockSendEmail.mock.calls[0][0];

    expect(subject).toContain('(offline)');
    expect(text).toMatch(/RECORDED as already paid outside the gateway by cash/);
    expect(text).toContain('Reference: RCPT-8821');
    expect(text).toContain('Recorded by: rahul@autobacsindia.com');
    // The gateway claim must not appear — no Razorpay refund exists.
    expect(text).not.toMatch(/original payment method/);
    expect(text).not.toMatch(/Refund id/);
  });

  it('keeps the gateway wording and the refund id for a Razorpay refund', async () => {
    loads(makeReturn({
      finalAmount: 1000, productValue: 1000, status: 'completed',
      method: 'original_payment', razorpayRefundId: 'rfnd_123',
    }));

    await emailAdminReturnRefundedAlert('ret-1');
    const { subject, text } = mockSendEmail.mock.calls[0][0];

    expect(subject).not.toContain('(offline)');
    expect(text).toMatch(/original payment method/);
    expect(text).toContain('Refund id: rfnd_123');
    expect(text).not.toContain('Reference:');
  });
});
