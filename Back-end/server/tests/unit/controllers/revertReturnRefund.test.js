import { jest } from '@jest/globals';

/**
 * Withdrawing a return's OFFLINE refund record.
 *
 * The return goes back to `received` with a `pending` refund — exactly the state
 * claimForRefund needs to re-claim it — so the refund can then be issued properly.
 */

const mockReturnRequestRepository = { claimRefundRevert: jest.fn(), findById: jest.fn() };
const mockOrderRepository = {
  findById: jest.fn(), save: jest.fn(), clearNotifiedStatus: jest.fn(),
  restorePaidAfterRevert: jest.fn(), clearRefundMirror: jest.fn(),
};
const mockPaymentRepository = { reverseRefund: jest.fn() };
const mockUserRepository = { incrementSpend: jest.fn() };
const mockAffiliate = { reinstateForAmount: jest.fn() };
const mockAuditLogger = { logAction: jest.fn() };

jest.unstable_mockModule('../../../repositories/returnRequestRepository.js', () => ({ default: mockReturnRequestRepository }));
jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: mockOrderRepository }));
jest.unstable_mockModule('../../../repositories/paymentRepository.js', () => ({ default: mockPaymentRepository }));
jest.unstable_mockModule('../../../repositories/userRepository.js', () => ({ default: mockUserRepository }));
jest.unstable_mockModule('../../../services/affiliateCommissionService.js', () => ({ default: mockAffiliate }));
jest.unstable_mockModule('../../../services/auditLogger.js', () => ({ default: mockAuditLogger }));
jest.unstable_mockModule('../../../services/razorpayService.js', () => ({ default: { refundPayment: jest.fn() } }));
jest.unstable_mockModule('../../../queue/queues.js', () => ({
  enqueueNotification: jest.fn(), getNotificationsQueue: jest.fn(), getOrderQueue: jest.fn(),
}));

const { revertReturnRefund } = await import('../../../controllers/returnController.js');

const req = { params: { id: 'ret-1' }, body: { reason: 'never actually paid' }, user: { _id: 'admin-1' }, headers: {} };
let res, next;

const offlineReturn = (overrides = {}) => ({
  _id: 'ret-1',
  order: 'order-1',
  user: 'user-1',
  refund: {
    status: 'completed', method: 'offline', finalAmount: 400,
    offlineMethod: 'cash', reference: 'RCPT-77', affiliateClawbackPaise: 900,
    // What each effect ACTUALLY applied at mark time.
    paymentRecordedPaise: 40000, ltvDecrementedPaise: 40000,
  },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  next = jest.fn();
  mockOrderRepository.findById.mockResolvedValue({
    _id: 'order-1', payment: 'payment-1', paymentStatus: 'paid', totalAmount: 1500, refundDetails: {},
  });
  mockOrderRepository.clearNotifiedStatus.mockResolvedValue(true);
  mockOrderRepository.restorePaidAfterRevert.mockResolvedValue(true);
  mockOrderRepository.save.mockResolvedValue(undefined);
  mockOrderRepository.clearRefundMirror.mockResolvedValue(true);
  mockPaymentRepository.reverseRefund.mockResolvedValue({});
  mockUserRepository.incrementSpend.mockResolvedValue({});
  mockAffiliate.reinstateForAmount.mockResolvedValue({ status: 'reinstated' });
  mockAuditLogger.logAction.mockResolvedValue({});
});

const run = () => revertReturnRefund(req, res, next);

describe('revertReturnRefund', () => {
  it('reverses the payment row, LTV and the affiliate clawback', async () => {
    mockReturnRequestRepository.claimRefundRevert.mockResolvedValue(offlineReturn());

    await run();

    expect(mockPaymentRepository.reverseRefund).toHaveBeenCalledWith('payment-1', 400);
    expect(mockUserRepository.incrementSpend).toHaveBeenCalledWith('user-1', { amountPaise: 40000 });
    // Exactly the figure the clawback took, read from the record.
    expect(mockAffiliate.reinstateForAmount)
      .toHaveBeenCalledWith('order-1', 900, 'return_refund_reverted');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, amount: 400 }));
  });

  it('does NOT resurrect an order whose refund was only partial', async () => {
    // recordOfflineRefund flips the order to `refunded` only when the payout covered the
    // whole order value. ₹400 of a ₹1,500 order never did, so nothing may be restored.
    mockOrderRepository.findById.mockResolvedValue({
      _id: 'order-1', payment: 'payment-1', paymentStatus: 'refunded', totalAmount: 1500, refundDetails: {},
    });
    mockReturnRequestRepository.claimRefundRevert.mockResolvedValue(offlineReturn());

    await run();

    expect(mockOrderRepository.restorePaidAfterRevert).not.toHaveBeenCalled();
  });

  it('restores the payment axis when the refund DID cover the order', async () => {
    mockOrderRepository.findById.mockResolvedValue({
      _id: 'order-1', payment: 'payment-1', paymentStatus: 'refunded', totalAmount: 400, refundDetails: {},
    });
    mockReturnRequestRepository.claimRefundRevert.mockResolvedValue(offlineReturn());

    await run();

    expect(mockOrderRepository.restorePaidAfterRevert).toHaveBeenCalledWith('order-1');
  });

  it('CLEARS the order mirror rather than leaving it "pending"', async () => {
    /*
      REGRESSION. It used to set the mirror to `status: 'pending'` with `requestedAt`
      still set — precisely findWithRefunds' actionable bucket. The order is `delivered`,
      so it appeared in /admin/refunds as a refund owed while every action there
      (Process Refund, Mark offline) 400s on `status !== 'cancelled'`: permanently stuck,
      un-actionable and un-dismissable.
    */
    const order = {
      _id: 'order-1', payment: 'payment-1', paymentStatus: 'paid', totalAmount: 1500,
      refundDetails: { status: 'completed', notes: 'Return ret-1' },
    };
    mockOrderRepository.findById.mockResolvedValue(order);
    mockReturnRequestRepository.claimRefundRevert.mockResolvedValue(offlineReturn());

    await run();

    // Guarded on the note so it can only ever clear THIS return's mirror.
    expect(mockOrderRepository.clearRefundMirror).toHaveBeenCalledWith('order-1', 'Return ret-1');
  });

  it('leaves a DIFFERENT return\'s mirror alone', async () => {
    // The mirror holds only the latest refund across every return on the order. Blindly
    // clearing it would erase another return's summary.
    const order = {
      _id: 'order-1', payment: 'payment-1', paymentStatus: 'paid', totalAmount: 1500,
      refundDetails: { status: 'completed', notes: 'Return ret-OTHER' },
    };
    mockOrderRepository.findById.mockResolvedValue(order);
    mockReturnRequestRepository.claimRefundRevert.mockResolvedValue(offlineReturn());

    await run();

    expect(mockOrderRepository.clearRefundMirror).not.toHaveBeenCalled();
  });

  it('reverses ONLY the effects that actually landed', async () => {
    /*
      REGRESSION. reverseReturnLtvOnce swallows a failed decrementSpend entirely, and the
      `ltvReversed` / `paymentRecorded` claim flags are set BEFORE the work — so a revert
      that trusted them credited back spend never taken and subtracted from the Payment
      row money never added.
    */
    mockReturnRequestRepository.claimRefundRevert.mockResolvedValue(offlineReturn({
      refund: {
        status: 'completed', method: 'offline', finalAmount: 400,
        offlineMethod: 'cash', reference: 'RCPT-77',
        affiliateClawbackPaise: 0, paymentRecordedPaise: 0, ltvDecrementedPaise: 0,
      },
    }));

    await run();

    expect(mockPaymentRepository.reverseRefund).not.toHaveBeenCalled();
    expect(mockUserRepository.incrementSpend).not.toHaveBeenCalled();
    expect(mockAffiliate.reinstateForAmount).not.toHaveBeenCalled();
    // Still a success — the record is withdrawn either way.
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('REFUSES to revert a gateway refund', async () => {
    mockReturnRequestRepository.claimRefundRevert.mockResolvedValue(null);
    mockReturnRequestRepository.findById.mockResolvedValue(offlineReturn({
      refund: { status: 'completed', method: 'original_payment', razorpayRefundId: 'rfnd_1' },
    }));

    await run();

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
    expect(next.mock.calls[0][0].message).toMatch(/went through Razorpay/);
    expect(mockPaymentRepository.reverseRefund).not.toHaveBeenCalled();
  });

  it('explains when there is nothing recorded to revert', async () => {
    mockReturnRequestRepository.claimRefundRevert.mockResolvedValue(null);
    mockReturnRequestRepository.findById.mockResolvedValue(offlineReturn({
      refund: { status: 'pending' },
    }));

    await run();

    expect(next.mock.calls[0][0].message).toMatch(/no offline refund recorded/);
  });

  it('404s for a return that does not exist', async () => {
    mockReturnRequestRepository.claimRefundRevert.mockResolvedValue(null);
    mockReturnRequestRepository.findById.mockResolvedValue(null);

    await run();

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('reports a failed reversal step rather than throwing', async () => {
    mockReturnRequestRepository.claimRefundRevert.mockResolvedValue(offlineReturn());
    mockPaymentRepository.reverseRefund.mockRejectedValue(new Error('mongo down'));

    await run();

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true, warnings: expect.arrayContaining(['payment row']),
    }));
  });
});
