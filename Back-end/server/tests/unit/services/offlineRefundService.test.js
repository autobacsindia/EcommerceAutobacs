import { jest } from '@jest/globals';

/**
 * The offline-refund service's decision logic: guards, amount bounding, which side
 * effects fire on which surface, and the rule that a phase-2 failure never walks phase 1
 * back.
 *
 * Mocked repositories here on purpose — the atomic claims themselves are proven against
 * a real database in tests/unit/repositories/offlineRefundClaims.test.js. What this
 * covers is the reasoning AROUND those claims, which a real-DB test would only make
 * slower and harder to read.
 */

const mockOrderRepository = {
  findById: jest.fn(),
  markRefundOfflineCompleted: jest.fn(),
  claimRefundRevert: jest.fn(),
  claimRefundPaymentRecord: jest.fn(),
  markCancellationRefundOffline: jest.fn(),
  claimCancellationRefundRevert: jest.fn(),
  setCancellationAppliedAmounts: jest.fn(),
  setRefundAppliedAmounts: jest.fn(),
  clearNotifiedStatus: jest.fn(),
  restorePaidAfterRevert: jest.fn(),
};
const mockPaymentRepository = { recordRefund: jest.fn(), reverseRefund: jest.fn() };
const mockUserRepository = { incrementSpend: jest.fn() };
const mockReturnRequestRepository = { find: jest.fn() };
const mockAuditLogger = { logAction: jest.fn() };
const mockAffiliate = { reinstateForAmount: jest.fn() };
const mockSideEffects = { applyCancellationRefundSideEffectsOnce: jest.fn() };
const mockEnqueueNotification = jest.fn();

jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: mockOrderRepository }));
jest.unstable_mockModule('../../../repositories/paymentRepository.js', () => ({ default: mockPaymentRepository }));
jest.unstable_mockModule('../../../repositories/userRepository.js', () => ({ default: mockUserRepository }));
jest.unstable_mockModule('../../../repositories/returnRequestRepository.js', () => ({ default: mockReturnRequestRepository }));
jest.unstable_mockModule('../../../services/auditLogger.js', () => ({ default: mockAuditLogger }));
jest.unstable_mockModule('../../../services/affiliateCommissionService.js', () => ({ default: mockAffiliate }));
jest.unstable_mockModule('../../../services/cancellationRefundSideEffects.js', () => ({
  applyCancellationRefundSideEffectsOnce: mockSideEffects.applyCancellationRefundSideEffectsOnce,
  default: mockSideEffects,
}));
jest.unstable_mockModule('../../../queue/queues.js', () => ({
  enqueueNotification: mockEnqueueNotification,
  getNotificationsQueue: jest.fn(),
  getOrderQueue: jest.fn(),
}));

const {
  markOrderRefundOffline, revertOrderRefund,
  markCancellationRefundOffline, revertCancellationRefund,
} = await import('../../../services/offlineRefundService.js');

const req = { user: { _id: 'admin-1', id: 'admin-1' }, headers: {} };

const makeOrder = (overrides = {}) => ({
  _id: 'order-1',
  user: 'user-1',
  status: 'cancelled',
  paymentStatus: 'paid',
  totalAmount: 1500,
  payment: 'payment-1',
  cancellations: [],
  refundDetails: { status: 'pending', amount: 1500 },
  ...overrides,
});

const payment = { _id: 'payment-1', gatewayPaymentId: 'pay_abc', amount: 1500, refundAmount: 0 };

const OFFLINE = { offlineMethod: 'bank_transfer', reference: 'UTR-991' };

beforeEach(() => {
  jest.clearAllMocks();
  mockReturnRequestRepository.find.mockReturnValue({
    select: () => ({ lean: () => Promise.resolve([]) }),
  });
  mockOrderRepository.markRefundOfflineCompleted.mockResolvedValue(true);
  mockOrderRepository.claimRefundPaymentRecord.mockResolvedValue(true);
  mockOrderRepository.clearNotifiedStatus.mockResolvedValue(true);
  mockOrderRepository.restorePaidAfterRevert.mockResolvedValue(true);
  mockOrderRepository.markCancellationRefundOffline.mockResolvedValue({});
  mockOrderRepository.setCancellationAppliedAmounts.mockResolvedValue(true);
  mockOrderRepository.setRefundAppliedAmounts.mockResolvedValue(true);
  mockPaymentRepository.recordRefund.mockResolvedValue({});
  mockPaymentRepository.reverseRefund.mockResolvedValue({});
  mockUserRepository.incrementSpend.mockResolvedValue({});
  mockAuditLogger.logAction.mockResolvedValue({});
  mockAffiliate.reinstateForAmount.mockResolvedValue({ status: 'reinstated' });
  mockSideEffects.applyCancellationRefundSideEffectsOnce
    .mockResolvedValue({ status: 'applied', affiliateClawbackPaise: 1200 });
});

describe('markOrderRefundOffline — guards', () => {
  it('refuses an order that is not cancelled', async () => {
    await expect(markOrderRefundOffline(req, { order: makeOrder({ status: 'delivered' }), payment, ...OFFLINE }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(mockOrderRepository.markRefundOfflineCompleted).not.toHaveBeenCalled();
  });

  it('refuses an order that was cancelled line by line', async () => {
    // Those amounts are priced per line and net of the order's discount; a whole-order
    // record would be the wrong figure AND a second claim on the same capture.
    const order = makeOrder({ cancellations: [{ _id: 'c1', refund: { status: 'pending' } }] });
    await expect(markOrderRefundOffline(req, { order, payment, ...OFFLINE }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuses an order that was never paid', async () => {
    // Headroom derives from totalAmount — what the order is WORTH, not what was
    // collected — so without this an unpaid offline deal accepts a full "refund".
    const order = makeOrder({ paymentStatus: 'pending' });
    await expect(markOrderRefundOffline(req, { order, payment, ...OFFLINE }))
      .rejects.toMatchObject({ statusCode: 422 });
  });

  it('refuses an amount above what is still refundable, naming both figures', async () => {
    const order = makeOrder();
    await expect(markOrderRefundOffline(req, { order, payment, amount: 2000, ...OFFLINE }))
      .rejects.toThrow(/more than the ₹1500 still refundable/);
  });

  it('refuses a zero or negative amount', async () => {
    const order = makeOrder();
    await expect(markOrderRefundOffline(req, { order, payment, amount: 0, ...OFFLINE }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(markOrderRefundOffline(req, { order, payment, amount: -5, ...OFFLINE }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('caps against a sibling RETURN that already drew on the same capture', async () => {
    mockReturnRequestRepository.find.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve([{ _id: 'r1', refund: { status: 'completed', finalAmount: 1000 } }]) }),
    });
    const order = makeOrder();

    // ₹1,500 captured, ₹1,000 already returned → only ₹500 may be recorded.
    await expect(markOrderRefundOffline(req, { order, payment, amount: 800, ...OFFLINE }))
      .rejects.toThrow(/more than the ₹500 still refundable/);

    const ok = await markOrderRefundOffline(req, { order, payment, ...OFFLINE });
    expect(ok.amountRupees).toBe(500);
    // ₹500 does not cover the ₹1,500 order, so it is a partial record.
    expect(ok.isFull).toBe(false);
  });

  it('surfaces a lost claim as a 409 rather than recording twice', async () => {
    mockOrderRepository.markRefundOfflineCompleted.mockResolvedValue(false);
    await expect(markOrderRefundOffline(req, { order: makeOrder(), payment, ...OFFLINE }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(mockPaymentRepository.recordRefund).not.toHaveBeenCalled();
  });
});

describe('markOrderRefundOffline — side effects', () => {
  it('persists what the payment write actually applied, for an exact later reversal', async () => {
    await markOrderRefundOffline(req, { order: makeOrder(), payment, ...OFFLINE });
    expect(mockOrderRepository.setRefundAppliedAmounts)
      .toHaveBeenCalledWith('order-1', { paymentRecordedPaise: 150000 });
  });

  it('records NOTHING applied when the payment write throws', async () => {
    mockPaymentRepository.recordRefund.mockRejectedValue(new Error('mongo down'));
    const result = await markOrderRefundOffline(req, { order: makeOrder(), payment, ...OFFLINE });

    expect(result.warnings).toContain('payment record');
    // The claim flag is already true at this point; this is what stops a later revert
    // subtracting money that was never added.
    expect(mockOrderRepository.setRefundAppliedAmounts).not.toHaveBeenCalled();
  });

  it('records the payment row and emails the customer on a FULL refund', async () => {
    const result = await markOrderRefundOffline(req, { order: makeOrder(), payment, ...OFFLINE });

    expect(result.amountRupees).toBe(1500);
    expect(result.isFull).toBe(true);
    expect(mockPaymentRepository.recordRefund)
      .toHaveBeenCalledWith('payment-1', 1500, 'order_cancelled_offline');
    expect(mockEnqueueNotification).toHaveBeenCalledWith('send-order-status-email', {
      orderId: 'order-1', status: 'refunded',
    });
    expect(result.notified).toBe(true);
  });

  it('does NOT email for a partial record, and says why', async () => {
    /*
      Not a preference. `notifiedStatuses` keys on the bare status word for order-level
      events, so one 'refunded' email can ever be sent per order — spending it on a
      partial reconciliation entry would permanently silence the real one.
    */
    const result = await markOrderRefundOffline(req, { order: makeOrder(), payment, amount: 500, ...OFFLINE });

    expect(result.isFull).toBe(false);
    expect(result.notified).toBe(false);
    expect(mockEnqueueNotification).not.toHaveBeenCalled();
    expect(result.message).toMatch(/only one refund email/);
  });

  it('honours notifyCustomer: false', async () => {
    const result = await markOrderRefundOffline(req, {
      order: makeOrder(), payment, notifyCustomer: false, ...OFFLINE,
    });
    expect(mockEnqueueNotification).not.toHaveBeenCalled();
    expect(result.notified).toBe(false);
  });

  it('does NOT touch LTV or the affiliate ledger on this surface', async () => {
    // Both already fired on the `cancelled` transition (post-order-cancelled). Repeating
    // them here would double-count — the gateway refund path does not repeat them either.
    await markOrderRefundOffline(req, { order: makeOrder(), payment, ...OFFLINE });

    expect(mockUserRepository.incrementSpend).not.toHaveBeenCalled();
    expect(mockAffiliate.reinstateForAmount).not.toHaveBeenCalled();
    expect(mockSideEffects.applyCancellationRefundSideEffectsOnce).not.toHaveBeenCalled();
  });

  it('respects the once-only payment claim', async () => {
    mockOrderRepository.claimRefundPaymentRecord.mockResolvedValue(false);
    await markOrderRefundOffline(req, { order: makeOrder(), payment, ...OFFLINE });
    expect(mockPaymentRepository.recordRefund).not.toHaveBeenCalled();
  });

  it('records without a Payment row at all (legacy/imported order)', async () => {
    const result = await markOrderRefundOffline(req, { order: makeOrder({ payment: null }), payment: null, ...OFFLINE });
    expect(result.amountRupees).toBe(1500);
    expect(mockPaymentRepository.recordRefund).not.toHaveBeenCalled();
  });

  it('a phase-2 failure is REPORTED, never rolled back', async () => {
    /*
      The rule the whole phase split exists for. The money has already gone back; if a
      follow-up failure walked the record back to `failed`, the payout would vanish from
      the headroom and a gateway refund could pay the same money a second time.
    */
    mockPaymentRepository.recordRefund.mockRejectedValue(new Error('mongo down'));

    const result = await markOrderRefundOffline(req, { order: makeOrder(), payment, ...OFFLINE });

    expect(result.warnings).toContain('payment record');
    expect(result.message).toMatch(/need checking/);
    // Still a success: the record stands.
    expect(result.amountRupees).toBe(1500);
  });
});

describe('revertOrderRefund', () => {
  const reverted = {
    _id: 'order-1',
    user: 'user-1',
    payment: 'payment-1',
    paymentStatus: 'refunded',
    refundDetails: {
      status: 'completed', amount: 1500, refundType: 'full', refundMethod: 'offline',
      offlineMethod: 'bank_transfer', offlineReference: 'UTR-991',
      paymentRecordedPaise: 150000,
    },
  };

  it('reverses the payment row and clears the email stamp', async () => {
    mockOrderRepository.claimRefundRevert.mockResolvedValue(reverted);

    const result = await revertOrderRefund(req, { orderId: 'order-1', reason: 'wrong order' });

    expect(mockPaymentRepository.reverseRefund).toHaveBeenCalledWith('payment-1', 1500);
    // Or the customer would never be told about the REAL refund when it goes out.
    expect(mockOrderRepository.clearNotifiedStatus).toHaveBeenCalledWith('order-1', 'refunded');
    expect(result.amountRupees).toBe(1500);
  });

  it('does NOT re-credit LTV or the affiliate ledger on this surface', async () => {
    // Mirror of the mark path: neither was applied, so neither is reversed.
    mockOrderRepository.claimRefundRevert.mockResolvedValue(reverted);
    await revertOrderRefund(req, { orderId: 'order-1', reason: 'r' });

    expect(mockUserRepository.incrementSpend).not.toHaveBeenCalled();
    expect(mockAffiliate.reinstateForAmount).not.toHaveBeenCalled();
  });

  it('does NOT separately restore paymentStatus — the claim did it atomically', async () => {
    // It used to be a best-effort follow-up, which could leave an order advertising a
    // refund button that every path behind it refuses. See claimRefundRevert.
    mockOrderRepository.claimRefundRevert.mockResolvedValue(reverted);
    await revertOrderRefund(req, { orderId: 'order-1', reason: 'r' });

    expect(mockOrderRepository.restorePaidAfterRevert).not.toHaveBeenCalled();
  });

  it('explains a refusal to revert a GATEWAY refund', async () => {
    mockOrderRepository.claimRefundRevert.mockResolvedValue(null);
    mockOrderRepository.findById.mockResolvedValue(makeOrder({
      refundDetails: { status: 'completed', refundMethod: 'original_payment', transactionId: 'rfnd_1' },
    }));

    await expect(revertOrderRefund(req, { orderId: 'order-1', reason: 'r' }))
      .rejects.toThrow(/went through Razorpay/);
  });

  it('explains a refusal when there is nothing recorded to revert', async () => {
    mockOrderRepository.claimRefundRevert.mockResolvedValue(null);
    mockOrderRepository.findById.mockResolvedValue(makeOrder());

    await expect(revertOrderRefund(req, { orderId: 'order-1', reason: 'r' }))
      .rejects.toThrow(/no offline refund recorded/);
  });

  it('404s for an order that does not exist', async () => {
    mockOrderRepository.claimRefundRevert.mockResolvedValue(null);
    mockOrderRepository.findById.mockResolvedValue(null);

    await expect(revertOrderRefund(req, { orderId: 'nope', reason: 'r' }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('does NOT touch the payment row when the mark never recorded one', async () => {
    /*
      REGRESSION — the same class as the cancellation case. A revert that reversed the
      refund's face value regardless would take ₹1,500 off a Payment row that never
      received it, destroying a sibling refund's contribution to the headroom floor.
    */
    mockOrderRepository.claimRefundRevert.mockResolvedValue({
      ...reverted,
      refundDetails: { ...reverted.refundDetails, paymentRecordedPaise: 0 },
    });

    await revertOrderRefund(req, { orderId: 'order-1', reason: 'r' });

    expect(mockPaymentRepository.reverseRefund).not.toHaveBeenCalled();
    // The email stamp is still cleared — it is not money, and it was stamped.
    expect(mockOrderRepository.clearNotifiedStatus).toHaveBeenCalled();
  });

  it('reports a failed reversal step instead of throwing', async () => {
    mockOrderRepository.claimRefundRevert.mockResolvedValue(reverted);
    mockPaymentRepository.reverseRefund.mockRejectedValue(new Error('mongo down'));

    const result = await revertOrderRefund(req, { orderId: 'order-1', reason: 'r' });

    /*
      The safe failure direction: the record is withdrawn but Payment.refundAmount stays
      up, and that field is the FLOOR in remainingRefundable — so headroom stays consumed
      and a refund attempt is refused. Confusing, surfaced, and impossible to double-pay.
    */
    expect(result.warnings).toContain('payment row');
  });
});

describe('cancellation offline refund', () => {
  const makeCancellationOrder = () => makeOrder({
    status: 'processing',
    cancellations: [{ _id: 'c1', refund: { status: 'pending', productValuePaise: 40000 } }],
  });

  it('records the payout and runs the SHARED side-effect module', async () => {
    const order = makeCancellationOrder();
    const result = await markCancellationRefundOffline(req, {
      order, record: order.cancellations[0], payment, ...OFFLINE,
    });

    expect(result.amountRupees).toBe(400);
    // The same function the gateway path and the refund webhook use — not a copy.
    expect(mockSideEffects.applyCancellationRefundSideEffectsOnce)
      .toHaveBeenCalledWith('order-1', 'c1', 'payment-1', 40000);
    // What each effect ACTUALLY applied is persisted, for an exact later reversal.
    expect(mockOrderRepository.setCancellationAppliedAmounts).toHaveBeenCalledWith(
      'order-1', 'c1',
      expect.objectContaining({ affiliateClawbackPaise: 1200 }),
    );
  });

  it('sends NO customer email — parity with the gateway per-line path', async () => {
    const order = makeCancellationOrder();
    await markCancellationRefundOffline(req, { order, record: order.cancellations[0], payment, ...OFFLINE });
    expect(mockEnqueueNotification).not.toHaveBeenCalled();
  });

  it('refuses a cancellation whose refund is already running or done', async () => {
    const order = makeCancellationOrder();
    for (const status of ['processing', 'completed']) {
      const record = { _id: 'c1', refund: { status, productValuePaise: 40000 } };
      // eslint-disable-next-line no-await-in-loop -- assertion per status
      await expect(markCancellationRefundOffline(req, { order, record, payment, ...OFFLINE }))
        .rejects.toMatchObject({ statusCode: 409 });
    }
  });

  it('caps at this cancellation\'s own priced value, not the whole order', async () => {
    const order = makeCancellationOrder();
    const result = await markCancellationRefundOffline(req, {
      order, record: order.cancellations[0], payment, ...OFFLINE,
    });
    // ₹400 priced, ₹1,500 order — the line's figure wins.
    expect(result.amountRupees).toBe(400);
  });

  it('REJECTS an explicit amount above the line value, even with order headroom to spare', async () => {
    /*
      REGRESSION. The ceiling used to be advisory: it supplied the DEFAULT while the
      explicit `amount` was validated against the order-wide headroom. So a ₹400
      cancellation on a ₹1,500 order accepted ₹1,500 — inflating the Payment row, the
      affiliate clawback and the LTV decrement, and eating the whole order's headroom so
      every sibling refund was then refused. The gateway twin caps at
      min(productValuePaise, headroom); this has to agree.
    */
    const order = makeCancellationOrder();

    await expect(markCancellationRefundOffline(req, {
      order, record: order.cancellations[0], payment, amount: 1500, ...OFFLINE,
    })).rejects.toMatchObject({ statusCode: 422 });

    // And the message names the LINE's limit, not the order's — they need different fixes.
    await expect(markCancellationRefundOffline(req, {
      order, record: order.cancellations[0], payment, amount: 1500, ...OFFLINE,
    })).rejects.toThrow(/more than the ₹400 this refund covers/);

    expect(mockOrderRepository.markCancellationRefundOffline).not.toHaveBeenCalled();
  });

  it('still allows a partial amount within the line value', async () => {
    const order = makeCancellationOrder();
    const result = await markCancellationRefundOffline(req, {
      order, record: order.cancellations[0], payment, amount: 250, ...OFFLINE,
    });
    expect(result.amountRupees).toBe(250);
  });

  it('persists what each side effect ACTUALLY applied, not what it attempted', async () => {
    // The claim flags (paymentIncremented / ltvAdjusted) are set BEFORE the work, so they
    // cannot answer "did it land?". These figures can.
    mockSideEffects.applyCancellationRefundSideEffectsOnce.mockResolvedValue({
      status: 'applied', affiliateClawbackPaise: 1200,
      paymentRecordedPaise: 40000, ltvDecrementedPaise: 0,
    });
    const order = makeCancellationOrder();

    await markCancellationRefundOffline(req, { order, record: order.cancellations[0], payment, ...OFFLINE });

    expect(mockOrderRepository.setCancellationAppliedAmounts).toHaveBeenCalledWith(
      'order-1', 'c1',
      { affiliateClawbackPaise: 1200, paymentRecordedPaise: 40000, ltvDecrementedPaise: 0 },
    );
  });

  it('reverses ONLY the effects that actually landed', async () => {
    /*
      REGRESSION. The revert used to reverse the refund's face value unconditionally. If
      the Payment `$inc` had failed at mark time (reported as a warning, deliberately not
      rolled back), the reversal subtracted money that was never added — wiping a SIBLING
      refund's contribution off Payment.refundAmount, which is the Math.max(...) floor
      remainingRefundable trusts, and silently freeing headroom for a second payout.
    */
    mockOrderRepository.claimCancellationRefundRevert.mockResolvedValue({
      _id: 'order-1',
      user: 'user-1',
      payment: 'payment-1',
      cancellations: [{
        _id: 'c1',
        refund: {
          status: 'completed', amountPaise: 40000, offlineMethod: 'upi',
          // The refund was recorded, but BOTH money-moving effects failed at mark time.
          affiliateClawbackPaise: 0, paymentRecordedPaise: 0, ltvDecrementedPaise: 0,
        },
      }],
    });

    await revertCancellationRefund(req, { orderId: 'order-1', cancellationId: 'c1', reason: 'mistake' });

    expect(mockPaymentRepository.reverseRefund).not.toHaveBeenCalled();
    expect(mockUserRepository.incrementSpend).not.toHaveBeenCalled();
    expect(mockAffiliate.reinstateForAmount).not.toHaveBeenCalled();
  });

  it('reverses the payment row but NOT LTV when only the payment write landed', async () => {
    mockOrderRepository.claimCancellationRefundRevert.mockResolvedValue({
      _id: 'order-1',
      user: 'user-1',
      payment: 'payment-1',
      cancellations: [{
        _id: 'c1',
        refund: {
          status: 'completed', amountPaise: 40000, offlineMethod: 'upi',
          affiliateClawbackPaise: 0, paymentRecordedPaise: 40000, ltvDecrementedPaise: 0,
        },
      }],
    });

    await revertCancellationRefund(req, { orderId: 'order-1', cancellationId: 'c1', reason: 'mistake' });

    expect(mockPaymentRepository.reverseRefund).toHaveBeenCalledWith('payment-1', 400);
    expect(mockUserRepository.incrementSpend).not.toHaveBeenCalled();
  });

  it('reverses LTV and the affiliate ledger on revert — both WERE applied here', async () => {
    mockOrderRepository.claimCancellationRefundRevert.mockResolvedValue({
      _id: 'order-1',
      user: 'user-1',
      payment: 'payment-1',
      cancellations: [{
        _id: 'c1',
        refund: {
          status: 'completed', amountPaise: 40000, affiliateClawbackPaise: 1200,
          offlineMethod: 'upi', paymentRecordedPaise: 40000, ltvDecrementedPaise: 40000,
        },
      }],
    });

    const result = await revertCancellationRefund(req, {
      orderId: 'order-1', cancellationId: 'c1', reason: 'mistake',
    });

    expect(mockPaymentRepository.reverseRefund).toHaveBeenCalledWith('payment-1', 400);
    expect(mockUserRepository.incrementSpend).toHaveBeenCalledWith('user-1', { amountPaise: 40000 });
    // Exactly what the clawback took, read from the record — never re-derived.
    expect(mockAffiliate.reinstateForAmount)
      .toHaveBeenCalledWith('order-1', 1200, 'cancellation_refund_reverted');
    expect(result.amountRupees).toBe(400);
  });

  it('explains a refusal to revert a GATEWAY cancellation refund', async () => {
    mockOrderRepository.claimCancellationRefundRevert.mockResolvedValue(null);
    mockOrderRepository.findById.mockResolvedValue(makeOrder({
      cancellations: [{ _id: 'c1', refund: { status: 'completed', razorpayRefundId: 'rfnd_9' } }],
    }));

    await expect(revertCancellationRefund(req, { orderId: 'order-1', cancellationId: 'c1', reason: 'r' }))
      .rejects.toThrow(/went through Razorpay/);
  });
});
