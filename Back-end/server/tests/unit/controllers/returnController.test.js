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

const {
  createReturnRequest,
  initiateReturnRefund,
  reviewReturn,
  recordInspection,
  cancelMyReturn,
  bookCourier,
  markReceived,
} = await import('../../../controllers/returnController.js');

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

const validAsset = (folderId, format = 'mp4') => ({ publicId: `autobacs/returns/${folderId}`, resourceType: format === 'mp4' ? 'video' : 'image' });

function makeOrder(overrides = {}) {
  return {
    _id: 'order-1',
    status: 'delivered',
    paymentStatus: 'paid',
    totalAmount: 1500,
    payment: 'payment-1',
    deliveredAt: daysAgo(1),
    fulfillmentMetrics: { deliveredAt: daysAgo(1) },
    items: [
      { product: { _id: 'prod-1', name: 'Wiper', returnPolicy: { returnable: true } }, quantity: 2, price: 500, variantId: null },
    ],
    returnRequest: {},
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

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

describe('createReturnRequest — policy guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReturnRepo.findOne.mockResolvedValue(null);
    mockReturnRepo.returnedQuantityByProduct.mockResolvedValue(new Map());
    mockGetResource.mockImplementation(async (publicId, type) => ({
      bytes: 1000,
      format: type === 'video' ? 'mp4' : 'jpg',
    }));
    mockReturnRepo.create.mockImplementation(async (doc) => ({ _id: 'ret-1', ...doc }));
  });

  const baseBody = {
    orderId: 'order-1',
    items: [{ productId: 'prod-1', quantity: 2, reason: 'manufacturing_defect' }],
    problemDescription: 'It rattles',
    video: { publicId: 'autobacs/returns/abc/vid', resourceType: 'video' },
    proofOfPurchase: { publicId: 'autobacs/returns/abc/proof.jpg', resourceType: 'image' },
  };

  it('rejects a return outside the 4-day window', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(makeOrder({ deliveredAt: daysAgo(9), fulfillmentMetrics: { deliveredAt: daysAgo(9) } }));
    const { status, error } = await run(createReturnRequest, { body: baseBody, user: { _id: 'u1' } });
    expect(status).toBe(400);
    expect(error.message).toMatch(/window closed/i);
  });

  // Boundary regression: the window is a continuous 4×24h cutoff. A floored
  // daysSince() would round 4d23h down to 4 and wrongly ACCEPT this — the exact bug
  // this guards against.
  it('rejects a return raised 4 days 23 hours after delivery', async () => {
    const at = new Date(Date.now() - (4 * 24 + 23) * 60 * 60 * 1000);
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(makeOrder({ deliveredAt: at, fulfillmentMetrics: { deliveredAt: at } }));
    const { status, error } = await run(createReturnRequest, { body: baseBody, user: { _id: 'u1' } });
    expect(status).toBe(400);
    expect(error.message).toMatch(/window closed/i);
  });

  it('accepts a return still inside the window (3 days 23 hours)', async () => {
    const at = new Date(Date.now() - (3 * 24 + 23) * 60 * 60 * 1000);
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(makeOrder({ deliveredAt: at, fulfillmentMetrics: { deliveredAt: at } }));
    const { status, next } = await run(createReturnRequest, { body: baseBody, user: { _id: 'u1' } });
    expect(next).not.toHaveBeenCalled();
    expect(status).toBe(201);
  });

  it('rejects an ineligible reason (change of mind)', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(makeOrder());
    const body = { ...baseBody, items: [{ productId: 'prod-1', quantity: 1, reason: 'changed_mind' }] };
    const { status, error } = await run(createReturnRequest, { body, user: { _id: 'u1' } });
    expect(status).toBe(400);
    expect(error.message).toMatch(/wrong item, transit damage, or a manufacturing defect/i);
  });

  it('blocks a non-returnable product', async () => {
    const order = makeOrder();
    order.items[0].product.returnPolicy = { returnable: false };
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(order);
    const { status, error } = await run(createReturnRequest, { body: baseBody, user: { _id: 'u1' } });
    expect(status).toBe(400);
    expect(error.message).toMatch(/not eligible for return/i);
  });

  it('rejects when the mandatory unboxing video is missing', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(makeOrder());
    const body = { ...baseBody, video: undefined };
    const { status, error } = await run(createReturnRequest, { body, user: { _id: 'u1' } });
    expect(status).toBe(400);
    expect(error.message).toMatch(/unboxing video is required/i);
  });

  it('rejects when the problem description is missing', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(makeOrder());
    const body = { ...baseBody, problemDescription: '   ' };
    const { status, error } = await run(createReturnRequest, { body, user: { _id: 'u1' } });
    expect(status).toBe(400);
    expect(error.message).toMatch(/description of the problem is required/i);
  });

  it('creates a return, snapshots product value, and emails customer + support', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(makeOrder());
    const { status, next } = await run(createReturnRequest, { body: baseBody, user: { _id: 'u1' } });
    expect(next).not.toHaveBeenCalled();
    expect(status).toBe(201);
    const created = mockReturnRepo.create.mock.calls[0][0];
    expect(created.refund.productValue).toBe(1000); // 2 × ₹500
    expect(mockEnqueue).toHaveBeenCalledWith('send-return-submitted', { returnId: 'ret-1' });
    expect(mockEnqueue).toHaveBeenCalledWith('send-admin-return-alert', { returnId: 'ret-1' });
  });
});

// ── Debit-card EMI caught at REQUEST time, not refund time ───────────────────
//
// The refund-time guard fires only after the return is approved, the courier is paid
// for and the goods are back. Catching it here costs nothing instead.
describe('createReturnRequest — debit-card EMI is all-or-nothing', () => {
  const dcEmi = { _id: 'payment-1', gatewayPaymentId: 'pay_1', methodDetails: { emi: { kind: 'debit_card', issuer: 'HDFC' } } };

  const twoLineOrder = () => makeOrder({
    payment: 'payment-1',
    items: [
      { product: { _id: 'prod-1', name: 'Seat Cover', returnPolicy: { returnable: true } }, quantity: 1, price: 20000, variantId: null },
      { product: { _id: 'prod-2', name: 'Suspension Kit', returnPolicy: { returnable: true } }, quantity: 1, price: 60000, variantId: null },
    ],
  });

  const body = (items) => ({
    orderId: 'order-1', items, problemDescription: 'Arrived damaged',
    video: validAsset('v1'), proofOfPurchase: validAsset('p1', 'jpg'),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockReturnRepo.findOne.mockResolvedValue(null);
    mockReturnRepo.returnedQuantityByProduct.mockResolvedValue(new Map());
    mockGetResource.mockImplementation(async (publicId, type) => ({ bytes: 1000, format: type === 'video' ? 'mp4' : 'jpg' }));
    mockReturnRepo.create.mockImplementation(async (doc) => ({ _id: 'ret-1', ...doc }));
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(twoLineOrder());
    mockPaymentRepo.findById.mockResolvedValue(dcEmi);
  });

  it('rejects a PARTIAL return before anything is shipped or collected', async () => {
    const req = { body: body([{ productId: 'prod-1', quantity: 1, reason: 'transit_damage' }]), user: { _id: 'u1' } };
    const { status, error } = await run(createReturnRequest, req);
    expect(status).toBe(422);
    expect(error.message).toMatch(/whole EMI plan/i);
    expect(error.message).toMatch(/every item in this order/i);
    expect(mockReturnRepo.create).not.toHaveBeenCalled();
  });

  it('accepts the return when every line is included', async () => {
    const req = { body: body([
      { productId: 'prod-1', quantity: 1, reason: 'transit_damage' },
      { productId: 'prod-2', quantity: 1, reason: 'transit_damage' },
    ]), user: { _id: 'u1' } };
    const { next } = await run(createReturnRequest, req);
    expect(next).not.toHaveBeenCalled();
    expect(mockReturnRepo.create).toHaveBeenCalled();
  });

  it('rejects a full-line-count return that short-ships the QUANTITY', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(makeOrder({
      payment: 'payment-1',
      items: [{ product: { _id: 'prod-1', name: 'Seat Cover', returnPolicy: { returnable: true } }, quantity: 3, price: 20000, variantId: null }],
    }));
    const req = { body: body([{ productId: 'prod-1', quantity: 1, reason: 'transit_damage' }]), user: { _id: 'u1' } };
    const { status } = await run(createReturnRequest, req);
    expect(status).toBe(422);
  });

  it('explains the dead end when a line is non-returnable, so a full return is impossible', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(makeOrder({
      payment: 'payment-1',
      items: [
        { product: { _id: 'prod-1', name: 'Seat Cover', returnPolicy: { returnable: true } }, quantity: 1, price: 20000, variantId: null },
        { product: { _id: 'prod-2', name: 'Custom Wrap', returnPolicy: { returnable: false } }, quantity: 1, price: 60000, variantId: null },
      ],
    }));
    const req = { body: body([{ productId: 'prod-1', quantity: 1, reason: 'transit_damage' }]), user: { _id: 'u1' } };
    const { status, error } = await run(createReturnRequest, req);
    expect(status).toBe(422);
    expect(error.message).toMatch(/contact support/i);
    expect(error.message).toMatch(/Custom Wrap/);
  });

  it('leaves a SINGLE-item order alone — returning the only line is already a full return', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(makeOrder({ payment: 'payment-1' }));
    const req = { body: body([{ productId: 'prod-1', quantity: 2, reason: 'transit_damage' }]), user: { _id: 'u1' } };
    const { next } = await run(createReturnRequest, req);
    expect(next).not.toHaveBeenCalled();
    expect(mockReturnRepo.create).toHaveBeenCalled();
  });

  it('leaves CREDIT-card EMI partial returns alone', async () => {
    mockPaymentRepo.findById.mockResolvedValue({ ...dcEmi, methodDetails: { emi: { kind: 'credit_card', issuer: 'Kotak' } } });
    const req = { body: body([{ productId: 'prod-1', quantity: 1, reason: 'transit_damage' }]), user: { _id: 'u1' } };
    const { next } = await run(createReturnRequest, req);
    expect(next).not.toHaveBeenCalled();
    expect(mockReturnRepo.create).toHaveBeenCalled();
  });
});

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
      items: [{ product: 'prod-1', quantity: 2, unitPrice: 500 }],
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
    await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: { shippingDeduction: 100, restockingDeduction: 50 }, user: { _id: 'a1' } });
    // (1000 - 100 - 50) = ₹850 → 85000 paise
    expect(mockReturnRepo.claimForRefund).toHaveBeenCalledWith('ret-1', expect.objectContaining({ finalAmount: 850 }));
    expect(mockRazorpay.refundPayment).toHaveBeenCalledWith('pay_123', 85000, expect.any(Object));
  });

  it('rejects deductions that wipe out the refund (never claims)', async () => {
    const { status, error } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: { shippingDeduction: 1000 }, user: { _id: 'a1' } });
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
    mockReturnRepo.findById.mockResolvedValue(makeReturn({ items: [{ product: 'prod-1', quantity: 2, unitPrice: 750 }] }));
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

  it('refuses a refund larger than what is left on the order, before any state moves', async () => {
    // A prior return already took ₹1200 of the ₹1500 captured; only ₹300 remains.
    mockSiblings([
      { _id: 'ret-0', refund: { status: 'completed', finalAmount: 1200 } },
      { _id: 'ret-1', refund: { status: 'pending', finalAmount: 1000 } }, // self — excluded
    ]);
    const { status, error } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });

    expect(status).toBe(422);
    expect(error.message).toMatch(/exceeds what is left/i);
    expect(error.message).toMatch(/₹300 of ₹1500/);
    // Nothing may move: no claim, and above all no gateway call.
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
    // refund must be refused even though no sibling ReturnRequest records it.
    mockPaymentRepo.findById.mockResolvedValue({ _id: 'payment-1', gatewayPaymentId: 'pay_123', refundAmount: 1400 });
    const { status, error } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });

    expect(status).toBe(422);
    expect(error.message).toMatch(/exceeds what is left/i);
    expect(mockRazorpay.refundPayment).not.toHaveBeenCalled();
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

  it('still accepts a return for another item while the order sits in `returned`', async () => {
    mockReturnRepo.findOne.mockResolvedValue(null);
    mockReturnRepo.returnedQuantityByProduct.mockResolvedValue(new Map());
    mockReturnRepo.create.mockImplementation(async (doc) => ({ _id: 'ret-2', ...doc }));
    mockGetResource.mockImplementation(async (publicId, type) => ({ bytes: 1000, format: type === 'video' ? 'mp4' : 'jpg' }));
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(makeOrder({ status: 'returned' }));

    const { status, next } = await run(createReturnRequest, {
      body: {
        orderId: 'order-1',
        items: [{ productId: 'prod-1', quantity: 1, reason: 'transit_damage' }],
        problemDescription: 'Cracked on arrival',
        video: { publicId: 'autobacs/returns/abc/vid', resourceType: 'video' },
        proofOfPurchase: { publicId: 'autobacs/returns/abc/proof.jpg', resourceType: 'image' },
      },
      user: { _id: 'u1' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(status).toBe(201);
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
describe('createReturnRequest — per-line return window (split shipments)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReturnRepo.findOne.mockResolvedValue(null);
    mockReturnRepo.returnedQuantityByProduct.mockResolvedValue(new Map());
    mockGetResource.mockImplementation(async (publicId, type) => ({
      bytes: 1000, format: type === 'video' ? 'mp4' : 'jpg',
    }));
    mockReturnRepo.create.mockImplementation(async (doc) => ({ _id: 'ret-1', ...doc }));
  });

  const body = (productId = 'prod-1') => ({
    orderId: 'order-1',
    items: [{ productId, quantity: 1, reason: 'manufacturing_defect' }],
    problemDescription: 'It rattles',
    video: { publicId: 'autobacs/returns/abc/vid', resourceType: 'video' },
    proofOfPurchase: { publicId: 'autobacs/returns/abc/proof.jpg', resourceType: 'image' },
  });

  /** Two lines, each in its own parcel, delivered `aDays` and `bDays` ago. */
  const splitOrder = ({ aDays, bDays, bDelivered = true, status = 'delivered' }) => makeOrder({
    status,
    items: [
      { _id: 'item-a', product: { _id: 'prod-1', name: 'Wiper', returnPolicy: { returnable: true } }, quantity: 1, price: 500, variantId: null },
      { _id: 'item-b', product: { _id: 'prod-2', name: 'Polish', returnPolicy: { returnable: true } }, quantity: 1, price: 500, variantId: null },
    ],
    shipments: [
      { _id: 's1', sequence: 1, status: 'delivered', deliveredAt: daysAgo(aDays), lines: [{ itemId: 'item-a', quantity: 1 }] },
      bDelivered
        ? { _id: 's2', sequence: 2, status: 'delivered', deliveredAt: daysAgo(bDays), lines: [{ itemId: 'item-b', quantity: 1 }] }
        : { _id: 's2', sequence: 2, status: 'shipped', lines: [{ itemId: 'item-b', quantity: 1 }] },
    ],
    // The order-level date reflects the LAST parcel, as the roll-up would leave it.
    deliveredAt: daysAgo(bDelivered ? Math.min(aDays, bDays) : aDays),
    fulfillmentMetrics: { deliveredAt: daysAgo(bDelivered ? Math.min(aDays, bDays) : aDays) },
  });

  // The bug: parcel A landed 9 days ago and is long out of window, but the order's own
  // date is 1 day old because parcel B arrived yesterday. Measuring from the order
  // would ACCEPT this return, ~5 days late.
  it('rejects a line whose OWN parcel is out of window, even though the order looks recent', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(splitOrder({ aDays: 9, bDays: 1 }));
    const { status, error } = await run(createReturnRequest, { body: body('prod-1'), user: { _id: 'u1' } });
    expect(status).toBe(400);
    expect(error.message).toMatch(/window closed for "Wiper"/i);
  });

  // The mirror image: parcel B is well inside its own window and must be accepted even
  // though parcel A is ancient.
  it('accepts a line whose own parcel is in window, even though another line is stale', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(splitOrder({ aDays: 9, bDays: 1 }));
    const { error } = await run(createReturnRequest, { body: body('prod-2'), user: { _id: 'u1' } });
    expect(error).toBeUndefined();
    expect(mockReturnRepo.create).toHaveBeenCalled();
  });

  it('refuses a line that has not been delivered at all', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(
      splitOrder({ aDays: 1, bDays: 0, bDelivered: false, status: 'shipped' }));
    const { status, error } = await run(createReturnRequest, { body: body('prod-2'), user: { _id: 'u1' } });
    expect(status).toBe(400);
    expect(error.message).toMatch(/hasn't been delivered yet/i);
  });

  /*
    A split order sits at `shipped` until the LAST parcel lands. Gating on the order
    status alone would refuse a return for an item delivered days ago — and its 4-day
    window could expire before the final parcel ever flipped the order to `delivered`.
  */
  it('allows a return on a still-shipping order for a line that HAS arrived', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(
      splitOrder({ aDays: 1, bDays: 0, bDelivered: false, status: 'shipped' }));
    const { error } = await run(createReturnRequest, { body: body('prod-1'), user: { _id: 'u1' } });
    expect(error).toBeUndefined();
    expect(mockReturnRepo.create).toHaveBeenCalled();
  });

  it('still refuses a return on a shipped order that has NO parcels (legacy shape)', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(makeOrder({ status: 'shipped', shipments: [] }));
    const { status, error } = await run(createReturnRequest, { body: body('prod-1'), user: { _id: 'u1' } });
    expect(status).toBe(400);
    expect(error.message).toMatch(/Only delivered orders/i);
  });

  // ── THE LEGACY GUARANTEE ───────────────────────────────────────────────────
  it('measures a parcel-less order from its order-level date, exactly as before', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(
      makeOrder({ shipments: [], deliveredAt: daysAgo(9), fulfillmentMetrics: { deliveredAt: daysAgo(9) } }));
    const { status, error } = await run(createReturnRequest, {
      body: { ...body('prod-1'), items: [{ productId: 'prod-1', quantity: 2, reason: 'manufacturing_defect' }] },
      user: { _id: 'u1' },
    });
    expect(status).toBe(400);
    expect(error.message).toMatch(/window closed/i);
  });
});

/**
 * Returning PART of a multi-item order.
 *
 * Two independent axes, and a customer can use both at once: which products they send
 * back, and how many units of each. On a split order a third axis appears — which of
 * those have actually arrived yet.
 */
describe('createReturnRequest — partial returns', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReturnRepo.findOne.mockResolvedValue(null);
    mockReturnRepo.returnedQuantityByProduct.mockResolvedValue(new Map());
    mockGetResource.mockImplementation(async (publicId, type) => ({
      bytes: 1000, format: type === 'video' ? 'mp4' : 'jpg',
    }));
    mockReturnRepo.create.mockImplementation(async (doc) => ({ _id: 'ret-1', ...doc }));
  });

  const evidence = {
    problemDescription: 'It rattles',
    video: { publicId: 'autobacs/returns/abc/vid', resourceType: 'video' },
    proofOfPurchase: { publicId: 'autobacs/returns/abc/proof.jpg', resourceType: 'image' },
  };

  /** Two products: Wiper ×3 and Polish ×1, both delivered a day ago. */
  const multiItemOrder = (over = {}) => makeOrder({
    items: [
      { _id: 'item-a', product: { _id: 'prod-1', name: 'Wiper', returnPolicy: { returnable: true } }, quantity: 3, price: 500, variantId: null },
      { _id: 'item-b', product: { _id: 'prod-2', name: 'Polish', returnPolicy: { returnable: true } }, quantity: 1, price: 250, variantId: null },
    ],
    ...over,
  });

  it('returns ONE product out of several, leaving the other alone', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(multiItemOrder());
    const { error } = await run(createReturnRequest, {
      body: { orderId: 'order-1', items: [{ productId: 'prod-1', quantity: 3, reason: 'manufacturing_defect' }], ...evidence },
      user: { _id: 'u1' },
    });

    expect(error).toBeUndefined();
    const created = mockReturnRepo.create.mock.calls[0][0];
    expect(created.items).toHaveLength(1);
    expect(created.items[0]).toMatchObject({ product: 'prod-1', quantity: 3 });
  });

  // The customer bought 3 wipers and only 2 are faulty.
  it('returns PART of a line’s quantity', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(multiItemOrder());
    const { error } = await run(createReturnRequest, {
      body: { orderId: 'order-1', items: [{ productId: 'prod-1', quantity: 2, reason: 'manufacturing_defect' }], ...evidence },
      user: { _id: 'u1' },
    });

    expect(error).toBeUndefined();
    const created = mockReturnRepo.create.mock.calls[0][0];
    expect(created.items[0]).toMatchObject({ product: 'prod-1', quantity: 2, unitPrice: 500 });
  });

  // A tampered or stale client must never be able to claim back more than was bought.
  it('clamps a quantity larger than the order line', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(multiItemOrder());
    await run(createReturnRequest, {
      body: { orderId: 'order-1', items: [{ productId: 'prod-1', quantity: 99, reason: 'manufacturing_defect' }], ...evidence },
      user: { _id: 'u1' },
    });
    expect(mockReturnRepo.create.mock.calls[0][0].items[0].quantity).toBe(3);
  });

  it('returns several products at once, each with its own quantity and reason', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(multiItemOrder());
    const { error } = await run(createReturnRequest, {
      body: {
        orderId: 'order-1',
        items: [
          { productId: 'prod-1', quantity: 1, reason: 'transit_damage' },
          { productId: 'prod-2', quantity: 1, reason: 'wrong_item' },
        ],
        ...evidence,
      },
      user: { _id: 'u1' },
    });

    expect(error).toBeUndefined();
    const created = mockReturnRepo.create.mock.calls[0][0];
    expect(created.items).toHaveLength(2);
    expect(created.items.map((i) => i.reason)).toEqual(['transit_damage', 'wrong_item']);
  });

  /*
    The three axes together: send back 2 of 3 units of a product that arrived in the FIRST
    parcel, while a second parcel is still in transit. The order is still `shipped`, so a
    naive order-status gate would have refused this outright.
  */
  it('returns part of a line that arrived in parcel 1 while parcel 2 is still in transit', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(multiItemOrder({
      status: 'shipped',
      shipments: [
        { _id: 's1', sequence: 1, status: 'delivered', deliveredAt: daysAgo(1), lines: [{ itemId: 'item-a', quantity: 3 }] },
        { _id: 's2', sequence: 2, status: 'shipped', lines: [{ itemId: 'item-b', quantity: 1 }] },
      ],
    }));

    const { error } = await run(createReturnRequest, {
      body: { orderId: 'order-1', items: [{ productId: 'prod-1', quantity: 2, reason: 'manufacturing_defect' }], ...evidence },
      user: { _id: 'u1' },
    });

    expect(error).toBeUndefined();
    expect(mockReturnRepo.create.mock.calls[0][0].items[0]).toMatchObject({ product: 'prod-1', quantity: 2 });
  });

  it('still refuses the undelivered product from that same order', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(multiItemOrder({
      status: 'shipped',
      shipments: [
        { _id: 's1', sequence: 1, status: 'delivered', deliveredAt: daysAgo(1), lines: [{ itemId: 'item-a', quantity: 3 }] },
        { _id: 's2', sequence: 2, status: 'shipped', lines: [{ itemId: 'item-b', quantity: 1 }] },
      ],
    }));

    const { status, error } = await run(createReturnRequest, {
      body: { orderId: 'order-1', items: [{ productId: 'prod-2', quantity: 1, reason: 'wrong_item' }], ...evidence },
      user: { _id: 'u1' },
    });
    expect(status).toBe(400);
    expect(error.message).toMatch(/hasn't been delivered yet/i);
  });

  /*
    ── COMING BACK FOR THE REST ────────────────────────────────────────────────────
    A refunded return used to block that product for the life of the order, so a shopper
    who sent back 1 of 3 faulty wipers could never claim the other 2 — the form invited a
    partial quantity and the API then made it one-shot. Quantity is the bound now.
  */
  it('allows a second return for the units NOT yet sent back', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(multiItemOrder());
    mockReturnRepo.findOne.mockResolvedValue(null);           // nothing rejected, nothing in flight
    mockReturnRepo.returnedQuantityByProduct.mockResolvedValue(new Map([['prod-1', 1]]));

    const { error } = await run(createReturnRequest, {
      body: { orderId: 'order-1', items: [{ productId: 'prod-1', quantity: 2, reason: 'manufacturing_defect' }], ...evidence },
      user: { _id: 'u1' },
    });

    expect(error).toBeUndefined();
    expect(mockReturnRepo.create.mock.calls[0][0].items[0]).toMatchObject({ product: 'prod-1', quantity: 2 });
  });

  // The ceiling. Three bought, one already returned → two left, not three.
  it('refuses more than the units still available, and says how many are left', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(multiItemOrder());
    mockReturnRepo.findOne.mockResolvedValue(null);
    mockReturnRepo.returnedQuantityByProduct.mockResolvedValue(new Map([['prod-1', 1]]));

    const { status, error } = await run(createReturnRequest, {
      body: { orderId: 'order-1', items: [{ productId: 'prod-1', quantity: 3, reason: 'manufacturing_defect' }], ...evidence },
      user: { _id: 'u1' },
    });

    expect(status).toBe(409);
    expect(error.message).toMatch(/return 2 more/i);
  });

  it('refuses once every unit has been returned', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(multiItemOrder());
    mockReturnRepo.findOne.mockResolvedValue(null);
    mockReturnRepo.returnedQuantityByProduct.mockResolvedValue(new Map([['prod-1', 3]]));

    const { status, error } = await run(createReturnRequest, {
      body: { orderId: 'order-1', items: [{ productId: 'prod-1', quantity: 1, reason: 'manufacturing_defect' }], ...evidence },
      user: { _id: 'u1' },
    });

    expect(status).toBe(409);
    expect(error.message).toMatch(/all 3 .* have already been returned/i);
  });

  // Concurrency guard, mirroring the DB unique index exactly.
  it('refuses a second return while one is still IN FLIGHT', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(multiItemOrder());
    mockReturnRepo.returnedQuantityByProduct.mockResolvedValue(new Map());
    mockReturnRepo.findOne.mockImplementation(async (q) =>
      (q.status === 'rejected' ? null : { _id: 'ret-inflight', status: 'approved' }));

    const { status, error } = await run(createReturnRequest, {
      body: { orderId: 'order-1', items: [{ productId: 'prod-1', quantity: 1, reason: 'manufacturing_defect' }], ...evidence },
      user: { _id: 'u1' },
    });

    expect(status).toBe(409);
    expect(error.message).toMatch(/already in progress/i);
  });

  /*
    A REJECTED return stays a hard stop. No quantity was consumed — the goods were never
    taken back — but an operator has already declined it, and re-asking is a support
    conversation, not a self-serve retry.
  */
  it('refuses outright after a return was reviewed and declined', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(multiItemOrder());
    mockReturnRepo.returnedQuantityByProduct.mockResolvedValue(new Map());
    mockReturnRepo.findOne.mockImplementation(async (q) =>
      (q.status === 'rejected' ? { _id: 'ret-rejected', status: 'rejected' } : null));

    const { status, error } = await run(createReturnRequest, {
      body: { orderId: 'order-1', items: [{ productId: 'prod-1', quantity: 1, reason: 'manufacturing_defect' }], ...evidence },
      user: { _id: 'u1' },
    });

    expect(status).toBe(409);
    expect(error.message).toMatch(/reviewed and declined/i);
  });

  // A cancelled request frees its units again — the customer withdrew, nothing moved.
  it('lets a customer re-raise after cancelling their own request', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(multiItemOrder());
    mockReturnRepo.findOne.mockResolvedValue(null);
    mockReturnRepo.returnedQuantityByProduct.mockResolvedValue(new Map()); // cancelled consumes nothing

    const { error } = await run(createReturnRequest, {
      body: { orderId: 'order-1', items: [{ productId: 'prod-1', quantity: 3, reason: 'manufacturing_defect' }], ...evidence },
      user: { _id: 'u1' },
    });
    expect(error).toBeUndefined();
  });
});
