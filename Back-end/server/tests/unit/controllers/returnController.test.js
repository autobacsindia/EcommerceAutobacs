import { jest } from '@jest/globals';

/**
 * Unit tests for the return/refund controller. The controller works through the
 * repositories + razorpayService + Cloudinary util + notification queue, so we
 * mock those and exercise the policy guards + refund money-path in isolation
 * (no DB, no gateway, no Cloudinary). Mirrors processRefund.test.js.
 */

const mockReturnRepo = {
  findOne: jest.fn(),
  returnedQuantityByProduct: jest.fn().mockResolvedValue(new Map()),
  // Installation lines another return already refunded (none, by default).
  refundedServiceLineIds: jest.fn().mockResolvedValue([]),
  findById: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  claimForRefund: jest.fn(),
  // Once-only guard for the cumulative Payment.refundAmount $inc.
  claimPaymentRecord: jest.fn(),
  countDocuments: jest.fn(),
  find: jest.fn(),
  // Drives the partial-return coverage check: the order only moves to `returned`
  // when every delivered unit is accounted for.
  returnedQuantityByProduct: jest.fn(),
};
const mockOrderRepo = {
  findOwnedWithProducts: jest.fn(),
  setReturnRequestStatus: jest.fn(),
  findById: jest.fn(),
  markReturnedOnReturnApproval: jest.fn(),
  revertReturnToDelivered: jest.fn(),
};
const mockPaymentRepo = { findById: jest.fn(), recordRefund: jest.fn() };
const mockRazorpay = { refundPayment: jest.fn() };
const mockEnqueue = jest.fn();
const mockGetResource = jest.fn();
const mockReverseLtv = jest.fn();

jest.unstable_mockModule('../../../repositories/returnRequestRepository.js', () => ({ default: mockReturnRepo }));
jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: mockOrderRepo }));
jest.unstable_mockModule('../../../repositories/paymentRepository.js', () => ({ default: mockPaymentRepo }));
jest.unstable_mockModule('../../../services/razorpayService.js', () => ({ default: mockRazorpay }));
jest.unstable_mockModule('../../../services/returnRefundLtvService.js', () => ({ reverseReturnLtvOnce: mockReverseLtv }));
jest.unstable_mockModule('../../../queue/queues.js', () => ({ enqueueNotification: mockEnqueue }));
jest.unstable_mockModule('../../../utils/returnsCloudinary.js', () => ({
  RETURNS_FOLDER_BASE: 'autobacs/returns',
  generateReturnUploadSignature: jest.fn(() => ({ signature: 'sig' })),
  getReturnResource: mockGetResource,
  signedReturnAssetUrl: jest.fn(() => 'https://signed'),
  resourceFormat: (r, id) => (r.format || String(id).split('.').pop() || '').toLowerCase(),
}));

// Customer-raised returns (createReturnRequest) are tested against a real database in
// tests/customerReturns.test.js — the rules now live in services/returnService.js.
const {
  initiateReturnRefund,
  reviewReturn,
  recordInspection,
  cancelMyReturn,
  bookCourier,
  markReceived,
} = await import('../../../controllers/returnController.js');


/**
 * Run an asyncHandler-wrapped controller and capture the error it forwards to next.
 *
 * `status` is the HTTP status the CLIENT actually receives. On the error path that is
 * `err.statusCode` — errorMiddleware derives the status from the error alone and never
 * reads `res.statusCode`, so asserting on `res.status` here would pass for a handler
 * that returns 500 to the browser. That is exactly the bug this file missed: every
 * `res.status(400); throw new Error(...)` in the controller shipped as a 500.
 */
async function run(handler, req) {
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  const next = jest.fn();
  await handler(req, res, next);
  const error = next.mock.calls[0]?.[0];
  return { res, next, error, status: error?.statusCode ?? res.status.mock.calls[0]?.[0] };
}

describe('initiateReturnRefund — deductions + gate', () => {
  // Sibling-return lookup used by the headroom check: repo.find(...).select(...).lean().
  const mockSiblings = (docs = []) => {
    mockReturnRepo.find.mockReturnValue({ select: () => ({ lean: async () => docs }) });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // The refund base is now derived from the ORDER, so it must carry real lines.
    // 2 × ₹500 = ₹1000 goods, no discount, ₹500 shipping → ₹1500 captured.
    mockOrderRepo.findById.mockResolvedValue(makeRefundOrder());
    mockSiblings([]);
    mockPaymentRepo.findById.mockResolvedValue({ _id: 'payment-1', gatewayPaymentId: 'pay_123' });
    mockPaymentRepo.recordRefund.mockResolvedValue({});
    mockReturnRepo.claimPaymentRecord.mockResolvedValue({ _id: 'ret-1' }); // uncontended
    mockRazorpay.refundPayment.mockResolvedValue({ refundId: 'rfnd_1', status: 'processed', amount: 90000 });
    mockReturnRepo.save.mockResolvedValue(true);
    // Default: pre-check passes, and the atomic claim succeeds returning the claimed doc.
    mockReturnRepo.findById.mockResolvedValue(makeReturn());
    mockReturnRepo.claimForRefund.mockImplementation(async (_id, amounts) => makeReturn({ refund: { productValue: 1000, status: 'processing', ...amounts } }));
  });

  function makeRefundOrder(overrides = {}) {
    return {
      _id: 'order-1',
      paymentStatus: 'paid',
      payment: 'payment-1',
      subtotal: 1000,
      discount: 0,
      shippingCost: 500,
      totalAmount: 1500,
      items: [{ product: 'prod-1', quantity: 2, price: 500, variantId: null }],
      save: jest.fn(),
      ...overrides,
    };
  }

  function makeReturn(overrides = {}) {
    return {
      _id: 'ret-1',
      order: 'order-1',
      status: 'received',
      inspection: { passed: true },
      // A CUSTOMER-reason line by default, so the goods-only arithmetic these tests pin
      // is isolated from the our-fault shipping share (tested on its own further down).
      items: [{ product: 'prod-1', quantity: 2, unitPrice: 500, reason: 'changed_mind' }],
      refund: { productValue: 1000, status: 'pending' },
      timeline: [],
      user: { email: 'c@x.com' },
      ...overrides,
    };
  }

  it('blocks a refund before inspection passes (never claims)', async () => {
    mockReturnRepo.findById.mockResolvedValue(makeReturn({ inspection: { passed: null } }));
    const { status, error } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });
    expect(status).toBe(400);
    expect(error.message).toMatch(/received and passes inspection/i);
    expect(mockReturnRepo.claimForRefund).not.toHaveBeenCalled();
  });

  it('refunds the full product value when no deductions given, and reverses LTV', async () => {
    const { res, next } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });
    expect(next).not.toHaveBeenCalled();
    expect(mockReturnRepo.claimForRefund).toHaveBeenCalledWith('ret-1', expect.objectContaining({ finalAmount: 1000 }));
    expect(mockRazorpay.refundPayment).toHaveBeenCalledWith('pay_123', 100000, expect.any(Object)); // ₹1000
    // Instant/'processed' refund → net-LTV reversal fires immediately.
    expect(mockReverseLtv).toHaveBeenCalledWith('ret-1');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    // The settled refund must land on the Payment row, cumulatively.
    expect(mockPaymentRepo.recordRefund).toHaveBeenCalledWith('payment-1', 1000, 'return_refund');
  });

  it('does NOT reverse LTV immediately for a normal-speed (processing) refund', async () => {
    mockRazorpay.refundPayment.mockResolvedValue({ refundId: 'rfnd_2', status: 'processing', amount: 100000 });
    await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });
    // Reversal is deferred to the refund.processed webhook.
    expect(mockReverseLtv).not.toHaveBeenCalled();
  });

  it('deducts shipping + restocking from the refund amount', async () => {
    await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: { shippingDeduction: 100, pickupDeductionReason: 'Delhivery AWB 123', restockingDeduction: 50 }, user: { _id: 'a1' } });
    // (1000 - 100 - 50) = ₹850 → 85000 paise
    expect(mockReturnRepo.claimForRefund).toHaveBeenCalledWith('ret-1', expect.objectContaining({ finalAmount: 850 }));
    expect(mockRazorpay.refundPayment).toHaveBeenCalledWith('pay_123', 85000, expect.any(Object));
  });

  it('rejects deductions that wipe out the refund (never claims)', async () => {
    const { status, error } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: { shippingDeduction: 1000, pickupDeductionReason: 'Courier' }, user: { _id: 'a1' } });
    expect(status).toBe(400);
    expect(error.message).toMatch(/greater than ₹0/);
    expect(mockReturnRepo.claimForRefund).not.toHaveBeenCalled();
  });

  // ── Debit-card EMI: full refund only ────────────────────────────────────────
  //
  // The issuer holds a loan against the whole capture and is never told which line
  // came back, so it can unwind the loan or nothing — Razorpay rejects a partial
  // refund on DC EMI outright. Our return flow is partial by construction, so without
  // this guard the operator learns about it only AFTER claimForRefund has moved the
  // return into `processing`, via a 502 from the gateway.
  const dcEmiPayment = {
    _id: 'payment-1',
    gatewayPaymentId: 'pay_123',
    methodDetails: { emi: { kind: 'debit_card', issuer: 'ICICI' } },
  };

  it('blocks a PARTIAL refund on debit-card EMI before anything is claimed', async () => {
    mockPaymentRepo.findById.mockResolvedValue(dcEmiPayment);
    // ₹1000 goods against a ₹1500 capture → partial.
    const { status, error } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });
    expect(status).toBe(422);
    expect(error.message).toMatch(/Debit Card EMI/i);
    expect(error.message).toMatch(/refund in full/i);
    expect(mockReturnRepo.claimForRefund).not.toHaveBeenCalled();
    expect(mockRazorpay.refundPayment).not.toHaveBeenCalled();
  });

  it('allows a debit-card EMI refund that covers the whole capture', async () => {
    mockPaymentRepo.findById.mockResolvedValue(dcEmiPayment);
    // Goods worth the full ₹1500 capture → a full refund, which the issuer accepts.
    mockOrderRepo.findById.mockResolvedValue(
      makeRefundOrder({ subtotal: 1500, shippingCost: 0, items: [{ product: 'prod-1', quantity: 2, price: 750, variantId: null }] })
    );
    mockReturnRepo.findById.mockResolvedValue(makeReturn({ items: [{ product: 'prod-1', quantity: 2, unitPrice: 750, reason: 'changed_mind' }] }));
    const { next } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });
    expect(next).not.toHaveBeenCalled();
    expect(mockRazorpay.refundPayment).toHaveBeenCalledWith('pay_123', 150000, expect.any(Object));
  });

  it('leaves partial refunds on credit-card EMI alone', async () => {
    mockPaymentRepo.findById.mockResolvedValue({
      ...dcEmiPayment,
      methodDetails: { emi: { kind: 'credit_card', issuer: 'HDFC', months: 6 } },
    });
    const { next } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });
    expect(next).not.toHaveBeenCalled();
    expect(mockRazorpay.refundPayment).toHaveBeenCalledWith('pay_123', 100000, expect.any(Object));
  });

  it('does not block when the EMI kind is unknown — missing metadata must not stop a valid refund', async () => {
    mockPaymentRepo.findById.mockResolvedValue({
      ...dcEmiPayment,
      methodDetails: { emi: { kind: 'unknown' } },
    });
    const { next } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });
    expect(next).not.toHaveBeenCalled();
    expect(mockRazorpay.refundPayment).toHaveBeenCalled();
  });

  it('409s when the atomic claim is lost to a concurrent refund', async () => {
    mockReturnRepo.claimForRefund.mockResolvedValue(null);
    const { status, error } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });
    expect(status).toBe(409);
    expect(error.message).toMatch(/already being processed/i);
    expect(mockRazorpay.refundPayment).not.toHaveBeenCalled();
  });

  // ── Discount proration (the 2026-08-03 over-refund bug) ──────────────────────
  //
  // Order lines carry LIST prices; coupon/karma live at order level. Refunding
  // Σ(price × qty) sends back more than the customer paid — silently when the gap
  // is small, and as a hard Razorpay rejection ("refund amount ... greater than
  // amount captured") when it is large. Both shipped to production.

  it('refunds what the customer PAID, not the list value, when a coupon was applied', async () => {
    // ₹1000 of goods, ₹400 coupon → ₹600 actually paid for these lines (+₹100 shipping).
    mockOrderRepo.findById.mockResolvedValue(makeRefundOrder({
      subtotal: 1000, discount: 400, couponDiscount: 400, shippingCost: 100, totalAmount: 700,
    }));
    await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });

    expect(mockReturnRepo.claimForRefund).toHaveBeenCalledWith('ret-1', expect.objectContaining({
      productValue: 600,   // what was paid — the refundable base
      listValue: 1000,     // struck through in the admin UI
      discountShare: 400,
      finalAmount: 600,
    }));
    expect(mockRazorpay.refundPayment).toHaveBeenCalledWith('pay_123', 60000, expect.any(Object));
  });

  it('prorates the discount across lines when only part of the order is returned', async () => {
    // Two lines: ₹1000 (returned) + ₹3000 = ₹4000 goods, ₹400 discount (10%).
    // The returned line owes 25% of the goods → 25% of the ₹3600 net = ₹900.
    mockOrderRepo.findById.mockResolvedValue(makeRefundOrder({
      subtotal: 4000, discount: 400, shippingCost: 0, totalAmount: 3600,
      items: [
        { product: 'prod-1', quantity: 2, price: 500, variantId: null },
        { product: 'prod-2', quantity: 1, price: 3000, variantId: null },
      ],
    }));
    await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });

    expect(mockReturnRepo.claimForRefund).toHaveBeenCalledWith('ret-1', expect.objectContaining({
      productValue: 900, listValue: 1000, discountShare: 100, finalAmount: 900,
    }));
  });

  it('caps the refund at what is left on the order — never sends the gateway more', async () => {
    // A prior return already took ₹1200 of the ₹1500 captured; only ₹300 remains.
    mockSiblings([
      { _id: 'ret-0', refund: { status: 'completed', finalAmount: 1200 } },
      { _id: 'ret-1', refund: { status: 'pending', finalAmount: 1000 } }, // self — excluded
    ]);
    const { next } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });

    expect(next).not.toHaveBeenCalled();
    expect(mockReturnRepo.claimForRefund).toHaveBeenCalledWith('ret-1', expect.objectContaining({ finalAmount: 300 }));
    expect(mockRazorpay.refundPayment).toHaveBeenCalledWith('pay_123', 30000, expect.any(Object));
  });

  it('refuses when NOTHING is left on the order, before any state moves', async () => {
    mockSiblings([{ _id: 'ret-0', refund: { status: 'completed', finalAmount: 1500 } }]);
    const { status, error } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });

    expect(status).toBe(422);
    expect(error.message).toMatch(/Nothing is left to refund/i);
    expect(mockReturnRepo.claimForRefund).not.toHaveBeenCalled();
    expect(mockRazorpay.refundPayment).not.toHaveBeenCalled();
  });

  it('ignores a stale GROSS productValue snapshot on a pre-fix return', async () => {
    // Returns raised before the fix stored the list value in refund.productValue.
    // The controller must recompute from the order and never trust that snapshot.
    mockReturnRepo.findById.mockResolvedValue(makeReturn({
      refund: { productValue: 99999, status: 'pending' },
    }));
    await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });
    expect(mockReturnRepo.claimForRefund).toHaveBeenCalledWith('ret-1', expect.objectContaining({ finalAmount: 1000 }));
  });

  it('skips the Payment write when the webhook already claimed the record', async () => {
    // recordRefund is an atomic $inc and NOT idempotent — an instant refund whose
    // refund.processed webhook lands first must not be counted twice on the payment.
    mockReturnRepo.claimPaymentRecord.mockResolvedValue(null); // webhook won the claim
    const { next } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });

    expect(next).not.toHaveBeenCalled();
    expect(mockPaymentRepo.recordRefund).not.toHaveBeenCalled();
  });

  it('does not claim the payment record for a normal-speed (processing) refund', async () => {
    mockRazorpay.refundPayment.mockResolvedValue({ refundId: 'rfnd_2', status: 'processing', amount: 100000 });
    await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });

    expect(mockReturnRepo.claimPaymentRecord).not.toHaveBeenCalled();
    expect(mockPaymentRepo.recordRefund).not.toHaveBeenCalled();
  });

  it('counts money the Payment row already knows about when computing headroom', async () => {
    // ₹1500 captured, payment says ₹1400 already refunded → only ₹100 left, so a ₹1000
    // refund is capped at ₹100 even though no sibling ReturnRequest records it.
    mockPaymentRepo.findById.mockResolvedValue({ _id: 'payment-1', gatewayPaymentId: 'pay_123', refundAmount: 1400 });
    await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });

    expect(mockReturnRepo.claimForRefund).toHaveBeenCalledWith('ret-1', expect.objectContaining({ finalAmount: 100 }));
    expect(mockRazorpay.refundPayment).toHaveBeenCalledWith('pay_123', 10000, expect.any(Object));
  });

  // ── Fault-based money (owner-approved rule 1, 2026-10-30) ──────────────────────
  //
  // Dash cam ₹9,000 + installation ₹1,000 (a CUSTOM line) + ₹200 shipping = ₹10,200.
  function dashCamOrder(overrides = {}) {
    return makeRefundOrder({
      subtotal: 10000, discount: 0, shippingCost: 200, totalAmount: 10200,
      items: [
        { _id: 'line-cam', product: 'prod-cam', quantity: 1, price: 9000, variantId: null },
        { _id: 'line-fit', product: null, custom: true, name: 'Installation', quantity: 1, price: 1000 },
      ],
      ...overrides,
    });
  }
  const camReturn = (reason, extra = {}) => makeReturn({
    items: [{ product: 'prod-cam', orderItemId: 'line-cam', quantity: 1, unitPrice: 9000, reason, fault: { claimed: reason === 'changed_mind' || reason === 'ordered_wrong' ? 'customer' : 'ours' } }],
    ...extra,
  });

  it('our fault: refunds the item, the whole shipping share and the picked installation — ₹10,200', async () => {
    mockOrderRepo.findById.mockResolvedValue(dashCamOrder());
    mockReturnRepo.findById.mockResolvedValue(camReturn('wrong_item'));
    await run(initiateReturnRefund, {
      params: { id: 'ret-1' }, body: { serviceLines: [{ orderItemId: 'line-fit' }] }, user: { _id: 'a1' },
    });
    expect(mockReturnRepo.claimForRefund).toHaveBeenCalledWith('ret-1', expect.objectContaining({
      finalAmount: 10200,
      productValue: 9000,
      shippingShare: 200,
      serviceLines: [expect.objectContaining({ orderItemId: 'line-fit', amountPaise: 100000, netPaidPaise: 100000 })],
      shippingDeduction: 0,
    }));
    expect(mockRazorpay.refundPayment).toHaveBeenCalledWith('pay_123', 1020000, expect.any(Object));
  });

  it("customer's reason: refunds the item minus the real pickup cost — ₹8,700", async () => {
    mockOrderRepo.findById.mockResolvedValue(dashCamOrder());
    mockReturnRepo.findById.mockResolvedValue(camReturn('ordered_wrong'));
    await run(initiateReturnRefund, {
      params: { id: 'ret-1' }, body: { pickupDeduction: 300, pickupDeductionReason: 'Delhivery AWB 99' }, user: { _id: 'a1' },
    });
    expect(mockReturnRepo.claimForRefund).toHaveBeenCalledWith('ret-1', expect.objectContaining({
      finalAmount: 8700, shippingShare: 0, serviceLines: [], shippingDeduction: 300, pickupDeductionReason: 'Delhivery AWB 99',
    }));
  });

  it("customer's reason: refuses to refund installation (never claims)", async () => {
    mockOrderRepo.findById.mockResolvedValue(dashCamOrder());
    mockReturnRepo.findById.mockResolvedValue(camReturn('changed_mind'));
    const { status, error } = await run(initiateReturnRefund, {
      params: { id: 'ret-1' }, body: { serviceLines: [{ orderItemId: 'line-fit' }] }, user: { _id: 'a1' },
    });
    expect(status).toBe(400);
    expect(error.message).toMatch(/only when the fault is ours/i);
    expect(mockReturnRepo.claimForRefund).not.toHaveBeenCalled();
  });

  it('our fault: refuses a pickup deduction — we pay for the pickup', async () => {
    mockOrderRepo.findById.mockResolvedValue(dashCamOrder());
    mockReturnRepo.findById.mockResolvedValue(camReturn('transit_damage'));
    const { status } = await run(initiateReturnRefund, {
      params: { id: 'ret-1' }, body: { pickupDeduction: 300, pickupDeductionReason: 'Courier' }, user: { _id: 'a1' },
    });
    expect(status).toBe(400);
    expect(mockReturnRepo.claimForRefund).not.toHaveBeenCalled();
  });

  it('ignores a client-sent amount above what was paid for installation (never raises it)', async () => {
    mockOrderRepo.findById.mockResolvedValue(dashCamOrder());
    mockReturnRepo.findById.mockResolvedValue(camReturn('wrong_item'));
    const { status, error } = await run(initiateReturnRefund, {
      params: { id: 'ret-1' }, body: { serviceLines: [{ orderItemId: 'line-fit', amountRupees: 5000 }] }, user: { _id: 'a1' },
    });
    expect(status).toBe(400);
    expect(error.message).toMatch(/up to ₹1000/);
    expect(mockReturnRepo.claimForRefund).not.toHaveBeenCalled();
  });

  it('lets staff LOWER the installation amount with a reason', async () => {
    mockOrderRepo.findById.mockResolvedValue(dashCamOrder());
    mockReturnRepo.findById.mockResolvedValue(camReturn('wrong_item'));
    await run(initiateReturnRefund, {
      params: { id: 'ret-1' },
      body: { serviceLines: [{ orderItemId: 'line-fit', amountRupees: 600, reductionReason: 'Only the wiring was redone' }] },
      user: { _id: 'a1' },
    });
    expect(mockReturnRepo.claimForRefund).toHaveBeenCalledWith('ret-1', expect.objectContaining({
      finalAmount: 9800,
      serviceLines: [expect.objectContaining({ amountPaise: 60000, reductionReason: 'Only the wiring was redone' })],
    }));
  });

  it('refuses installation another return already refunded (never claims)', async () => {
    mockOrderRepo.findById.mockResolvedValue(dashCamOrder());
    mockReturnRepo.findById.mockResolvedValue(camReturn('wrong_item'));
    mockReturnRepo.refundedServiceLineIds.mockResolvedValueOnce(['line-fit']);
    const { status, error } = await run(initiateReturnRefund, {
      params: { id: 'ret-1' }, body: { serviceLines: [{ orderItemId: 'line-fit' }] }, user: { _id: 'a1' },
    });
    expect(status).toBe(409);
    expect(error.message).toMatch(/already refunded/i);
    expect(mockReturnRepo.claimForRefund).not.toHaveBeenCalled();
  });

  it('turns a lost installation race (unique index) into a 409, never a payout', async () => {
    mockOrderRepo.findById.mockResolvedValue(dashCamOrder());
    mockReturnRepo.findById.mockResolvedValue(camReturn('wrong_item'));
    mockReturnRepo.claimForRefund.mockRejectedValueOnce(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
    const { status, error } = await run(initiateReturnRefund, {
      params: { id: 'ret-1' }, body: { serviceLines: [{ orderItemId: 'line-fit' }] }, user: { _id: 'a1' },
    });
    expect(status).toBe(409);
    expect(error.message).toMatch(/just refunded with another return/i);
    expect(mockRazorpay.refundPayment).not.toHaveBeenCalled();
  });

  it('caps an our-fault full return at what the gateway captured when a Razorpay offer applied', async () => {
    // ₹100 instant discount at the gateway: the customer paid ₹10,100, not ₹10,200.
    mockOrderRepo.findById.mockResolvedValue(dashCamOrder({ gatewayOffer: { discount: 100, amountPaid: 10100 } }));
    mockReturnRepo.findById.mockResolvedValue(camReturn('wrong_item'));
    await run(initiateReturnRefund, {
      params: { id: 'ret-1' }, body: { serviceLines: [{ orderItemId: 'line-fit' }] }, user: { _id: 'a1' },
    });
    expect(mockReturnRepo.claimForRefund).toHaveBeenCalledWith('ret-1', expect.objectContaining({ finalAmount: 10100 }));
    expect(mockRazorpay.refundPayment).toHaveBeenCalledWith('pay_123', 1010000, expect.any(Object));
  });

  it('stores the GST credit note number accounts typed', async () => {
    mockOrderRepo.findById.mockResolvedValue(dashCamOrder());
    mockReturnRepo.findById.mockResolvedValue(camReturn('wrong_item'));
    await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: { creditNoteNo: ' CN-2026-0042 ' }, user: { _id: 'a1' } });
    expect(mockReturnRepo.claimForRefund).toHaveBeenCalledWith('ret-1', expect.objectContaining({ creditNoteNo: 'CN-2026-0042' }));
  });

  it('surfaces a gateway rejection as an operational 502, not a 500 page-out', async () => {
    mockRazorpay.refundPayment.mockRejectedValue(new Error('The refund amount provided is greater than amount captured'));
    const { status, error } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });
    expect(status).toBe(502);
    // isOperational is what keeps this out of the P1 pager and lets an admin read it.
    expect(error.isOperational).toBe(true);
    expect(error.message).toMatch(/greater than amount captured/);
  });
});

/**
 * Order fulfillment-axis follow-through. Operations wanted the Orders column to stop
 * reading "Delivered" the moment a return is approved — and, just as importantly, to
 * go BACK when the return doesn't complete, so no order is stranded in the terminal
 * `returned` state.
 */
describe('return approval → order fulfillment status', () => {
  // reviewReturn/recordInspection chain .populate() off findById; cancelMyReturn awaits it directly.
  const populated = (rr) => ({ populate: jest.fn().mockResolvedValue(rr) });

  function makeReturn(overrides = {}) {
    return {
      _id: 'ret-1',
      order: 'order-1',
      user: 'u1',
      status: 'pending',
      timeline: [],
      items: [{ product: 'prod-1', quantity: 1, unitPrice: 500 }],
      refund: { productValue: 500, status: 'pending' },
      ...overrides,
    };
  }

  /**
   * An order matching `makeReturn`'s single line. No shipments, so it is treated as a
   * pre-parcel order whose every live unit was delivered — the legacy fallback in
   * utils/orderReturns.deliveredQuantityByProduct.
   */
  const makeCoverageOrder = (items = [{ _id: 'i1', product: 'prod-1', quantity: 1 }]) => ({
    _id: 'order-1',
    status: 'delivered',
    items,
    shipments: [],
    cancellations: [],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockReturnRepo.save.mockResolvedValue(true);
    // Default: a one-line order whose only unit is the one being returned, so the
    // return covers everything and the order legitimately becomes `returned`.
    mockOrderRepo.findById.mockResolvedValue(makeCoverageOrder());
    mockReturnRepo.returnedQuantityByProduct.mockResolvedValue(new Map([['prod-1', 1]]));
  });

  it('marks the order returned when the return is approved', async () => {
    mockReturnRepo.findById.mockReturnValue(populated(makeReturn()));
    const { next } = await run(reviewReturn, { params: { id: 'ret-1' }, body: { decision: 'approve' }, user: { _id: 'a1' } });
    expect(next).not.toHaveBeenCalled();
    expect(mockOrderRepo.markReturnedOnReturnApproval).toHaveBeenCalledWith('order-1', 'a1', expect.any(String));
    expect(mockOrderRepo.revertReturnToDelivered).not.toHaveBeenCalled();
  });

  /*
    ── REGRESSION: a partial return must NOT close the whole order ──────────────────
    Approving a return for 1 of 3 delivered items used to flip Order.status to
    `returned`, which is TERMINAL in orderStatusService.STATUS_TRANSITIONS — so the
    customer could never send back the other 2 and the order could never move again.
    The unique_inflight_return_per_order_product index was deliberately narrowed to
    permit exactly that follow-up return; this flip defeated it.
  */
  it('leaves a partially returned order on `delivered` so the rest stays returnable', async () => {
    mockOrderRepo.findById.mockResolvedValue(makeCoverageOrder([
      { _id: 'i1', product: 'prod-1', quantity: 1 },
      { _id: 'i2', product: 'prod-2', quantity: 2 },
    ]));
    // Only the prod-1 unit has been claimed; prod-2 ×2 is still with the customer.
    mockReturnRepo.returnedQuantityByProduct.mockResolvedValue(new Map([['prod-1', 1]]));

    mockReturnRepo.findById.mockReturnValue(populated(makeReturn()));
    const { next } = await run(reviewReturn, { params: { id: 'ret-1' }, body: { decision: 'approve' }, user: { _id: 'a1' } });

    expect(next).not.toHaveBeenCalled();
    expect(mockOrderRepo.markReturnedOnReturnApproval).not.toHaveBeenCalled();
  });

  it('marks the order returned once the LAST outstanding line comes back', async () => {
    mockOrderRepo.findById.mockResolvedValue(makeCoverageOrder([
      { _id: 'i1', product: 'prod-1', quantity: 1 },
      { _id: 'i2', product: 'prod-2', quantity: 2 },
    ]));
    // The earlier prod-1 return plus this one for both prod-2 units = everything.
    mockReturnRepo.returnedQuantityByProduct.mockResolvedValue(
      new Map([['prod-1', 1], ['prod-2', 2]]));

    mockReturnRepo.findById.mockReturnValue(populated(makeReturn()));
    await run(reviewReturn, { params: { id: 'ret-1' }, body: { decision: 'approve' }, user: { _id: 'a1' } });

    expect(mockOrderRepo.markReturnedOnReturnApproval).toHaveBeenCalledWith('order-1', 'a1', expect.any(String));
  });

  it('counts only what a parcel actually delivered, not what was ordered', async () => {
    // Two items ordered, only prod-1 has arrived — prod-2's parcel is still in transit.
    // Returning prod-1 therefore covers everything DELIVERED, but the order must stay
    // `delivered` because a live parcel is still owed.
    mockOrderRepo.findById.mockResolvedValue({
      _id: 'order-1',
      status: 'delivered',
      items: [
        { _id: 'i1', product: 'prod-1', quantity: 1 },
        { _id: 'i2', product: 'prod-2', quantity: 1 },
      ],
      shipments: [
        { _id: 's1', status: 'delivered', deliveredAt: new Date(), lines: [{ itemId: 'i1', quantity: 1 }] },
        { _id: 's2', status: 'shipped', lines: [{ itemId: 'i2', quantity: 1 }] },
      ],
      cancellations: [],
    });
    mockReturnRepo.returnedQuantityByProduct.mockResolvedValue(new Map([['prod-1', 1]]));

    mockReturnRepo.findById.mockReturnValue(populated(makeReturn()));
    await run(reviewReturn, { params: { id: 'ret-1' }, body: { decision: 'approve' }, user: { _id: 'a1' } });

    // prod-1 is the only delivered unit and it came back, so coverage IS complete.
    expect(mockOrderRepo.markReturnedOnReturnApproval).toHaveBeenCalled();
  });

  it('never fails the approval when the status roll-up throws', async () => {
    mockReturnRepo.returnedQuantityByProduct.mockRejectedValue(new Error('mongo down'));
    mockReturnRepo.findById.mockReturnValue(populated(makeReturn()));

    const { next } = await run(reviewReturn, { params: { id: 'ret-1' }, body: { decision: 'approve' }, user: { _id: 'a1' } });

    // The goods decision is recorded; only the cached Order.status is left stale.
    expect(next).not.toHaveBeenCalled();
    expect(mockReturnRepo.save).toHaveBeenCalled();
    expect(mockOrderRepo.markReturnedOnReturnApproval).not.toHaveBeenCalled();
  });

  it('leaves the order alone when the return is rejected at review', async () => {
    mockReturnRepo.findById.mockReturnValue(populated(makeReturn()));
    await run(reviewReturn, {
      params: { id: 'ret-1' },
      body: { decision: 'reject', rejectionReason: 'Outside policy' },
      user: { _id: 'a1' },
    });
    expect(mockOrderRepo.markReturnedOnReturnApproval).not.toHaveBeenCalled();
  });

  it('restores the order to delivered when the item fails inspection', async () => {
    mockReturnRepo.findById.mockReturnValue(populated(makeReturn({ status: 'received' })));
    await run(recordInspection, { params: { id: 'ret-1' }, body: { passed: false, notes: 'Used' }, user: { _id: 'a1' } });
    expect(mockOrderRepo.revertReturnToDelivered).toHaveBeenCalledWith('order-1', 'a1', expect.any(String));
  });

  it('does NOT restore the order when the item passes inspection', async () => {
    mockReturnRepo.findById.mockReturnValue(populated(makeReturn({ status: 'received', timeline: [] })));
    await run(recordInspection, { params: { id: 'ret-1' }, body: { passed: true }, user: { _id: 'a1' } });
    expect(mockOrderRepo.revertReturnToDelivered).not.toHaveBeenCalled();
  });

  it('restores the order when the customer withdraws an approved return', async () => {
    mockReturnRepo.findById.mockResolvedValue(makeReturn({ status: 'approved' }));
    await run(cancelMyReturn, { params: { id: 'ret-1' }, user: { _id: 'u1' } });
    expect(mockOrderRepo.revertReturnToDelivered).toHaveBeenCalledWith('order-1', 'u1', expect.any(String));
  });

});

/**
 * The courier step. Both fields are mandatory, the AWB is emailed to the customer, and
 * it is our only handle for a claim against the courier if a high-value pickup goes
 * missing — which is exactly why a typo must remain correctable.
 */
describe('bookCourier — mandatory, un-skippable, and correctable', () => {
  const makeReturn = (overrides = {}) => ({
    _id: 'ret-1',
    order: 'order-1',
    status: 'approved',
    timeline: [],
    user: { email: 'c@x.com' },
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockReturnRepo.save.mockResolvedValue(true);
    mockOrderRepo.setReturnRequestStatus.mockResolvedValue(true);
    mockReturnRepo.findById.mockReturnValue({ populate: async () => makeReturn() });
  });

  /** repo.findById(...).populate(...) resolves to the return. */
  const loaded = (rr) => mockReturnRepo.findById.mockReturnValue({ populate: async () => rr });

  const book = (body) => run(bookCourier, { params: { id: 'ret-1' }, body, user: { _id: 'a1' } });

  it('rejects a booking with no courier name', async () => {
    const { status, error } = await book({ trackingNumber: 'AWB1' });
    expect(status).toBe(400);
    expect(error.message).toMatch(/courier name is required/i);
    expect(mockReturnRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a booking with no AWB', async () => {
    const { status, error } = await book({ provider: 'Delhivery' });
    expect(status).toBe(400);
    expect(error.message).toMatch(/tracking \/ awb number is required/i);
  });

  it('treats whitespace-only values as missing', async () => {
    const { status } = await book({ provider: '   ', trackingNumber: '  ' });
    expect(status).toBe(400);
  });

  it('books from `approved` and emails the customer the courier + AWB', async () => {
    const rr = makeReturn();
    loaded(rr);

    const { next } = await book({ provider: ' Delhivery ', trackingNumber: ' AWB123 ' });

    expect(next).not.toHaveBeenCalled();
    expect(rr.courier.provider).toBe('Delhivery');       // trimmed
    expect(rr.courier.trackingNumber).toBe('AWB123');
    expect(rr.status).toBe('courier_booked');
    expect(mockEnqueue).toHaveBeenCalledWith('send-return-status-email', { returnId: 'ret-1', event: 'courier_booked' });
  });

  it('allows a correction while still in `courier_booked`', async () => {
    const bookedAt = new Date('2026-08-01T10:00:00Z');
    const rr = makeReturn({
      status: 'courier_booked',
      courier: { provider: 'Delhivery', trackingNumber: 'TYPO-1', bookedAt },
    });
    loaded(rr);

    const { next } = await book({ provider: 'Bluedart', trackingNumber: 'AWB-CORRECT' });

    expect(next).not.toHaveBeenCalled();
    expect(rr.courier.trackingNumber).toBe('AWB-CORRECT');
    // The original handover time is what a courier claim turns on — never overwritten.
    expect(rr.courier.bookedAt).toBe(bookedAt);
    expect(rr.courier.correctedAt).toBeInstanceOf(Date);
    expect(rr.timeline.at(-1).note).toMatch(/corrected/i);
    // The customer must not be left holding the wrong AWB.
    expect(mockEnqueue).toHaveBeenCalledWith('send-return-status-email', { returnId: 'ret-1', event: 'courier_booked' });
  });

  it('is a no-op when a correction changes nothing (no re-mail, no timeline noise)', async () => {
    const rr = makeReturn({
      status: 'courier_booked',
      timeline: [{ status: 'courier_booked', note: 'original' }],
      courier: { provider: 'Delhivery', trackingNumber: 'AWB123', bookedAt: new Date() },
    });
    loaded(rr);

    await book({ provider: 'Delhivery', trackingNumber: 'AWB123' });

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(rr.timeline).toHaveLength(1);
    expect(mockReturnRepo.save).not.toHaveBeenCalled();
  });

  it('refuses to book before approval, with a message that says what to do', async () => {
    loaded(makeReturn({ status: 'pending' }));
    const { status, error } = await book({ provider: 'Delhivery', trackingNumber: 'AWB1' });
    expect(status).toBe(400);
    expect(error.message).toMatch(/approve the request before/i);
  });

  it('freezes courier details once the item is received', async () => {
    loaded(makeReturn({ status: 'received' }));
    const { status, error } = await book({ provider: 'Bluedart', trackingNumber: 'AWB2' });
    expect(status).toBe(400);
    expect(error.message).toMatch(/no longer be changed/i);
  });
});

describe('markReceived — the courier step cannot be skipped', () => {
  const makeReturn = (overrides = {}) => ({
    _id: 'ret-1', order: 'order-1', status: 'courier_booked', timeline: [], user: { email: 'c@x.com' }, ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockReturnRepo.save.mockResolvedValue(true);
    mockOrderRepo.setReturnRequestStatus.mockResolvedValue(true);
  });

  it('accepts a return that went through the courier step', async () => {
    const rr = makeReturn();
    mockReturnRepo.findById.mockReturnValue({ populate: async () => rr });
    const { next } = await run(markReceived, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });
    expect(next).not.toHaveBeenCalled();
    expect(rr.status).toBe('received');
  });

  it('rejects an `approved` return — that shortcut is how a mandatory AWB gets bypassed', async () => {
    mockReturnRepo.findById.mockReturnValue({ populate: async () => makeReturn({ status: 'approved' }) });
    const { status, error } = await run(markReceived, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });
    expect(status).toBe(400);
    expect(error.message).toMatch(/after the courier is booked/i);
  });
});

/**
 * Split shipments and the return window.
 *
 * The window runs from delivery. When an order arrives in several parcels there is no
 * single delivery date, so measuring every line from the order's date is wrong for at
 * least one of them: an item that arrived first gets a window that runs long, and an
 * item that arrived last can have its window expire before the customer ever held it.
 */