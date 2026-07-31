import { jest } from '@jest/globals';

/**
 * Unit tests for the return/refund controller. The controller works through the
 * repositories + razorpayService + Cloudinary util + notification queue, so we
 * mock those and exercise the policy guards + refund money-path in isolation
 * (no DB, no gateway, no Cloudinary). Mirrors processRefund.test.js.
 */

const mockReturnRepo = {
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  claimForRefund: jest.fn(),
  countDocuments: jest.fn(),
  find: jest.fn(),
};
const mockOrderRepo = {
  findOwnedWithProducts: jest.fn(),
  setReturnRequestStatus: jest.fn(),
  findById: jest.fn(),
};
const mockPaymentRepo = { findById: jest.fn() };
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

// Run an asyncHandler-wrapped controller and capture the error it forwards to next.
async function run(handler, req) {
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  const next = jest.fn();
  await handler(req, res, next);
  return { res, next, error: next.mock.calls[0]?.[0] };
}

describe('createReturnRequest — policy guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReturnRepo.findOne.mockResolvedValue(null);
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
    const { res, error } = await run(createReturnRequest, { body: baseBody, user: { _id: 'u1' } });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(error.message).toMatch(/window closed/i);
  });

  // Boundary regression: the window is a continuous 4×24h cutoff. A floored
  // daysSince() would round 4d23h down to 4 and wrongly ACCEPT this — the exact bug
  // this guards against.
  it('rejects a return raised 4 days 23 hours after delivery', async () => {
    const at = new Date(Date.now() - (4 * 24 + 23) * 60 * 60 * 1000);
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(makeOrder({ deliveredAt: at, fulfillmentMetrics: { deliveredAt: at } }));
    const { res, error } = await run(createReturnRequest, { body: baseBody, user: { _id: 'u1' } });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(error.message).toMatch(/window closed/i);
  });

  it('accepts a return still inside the window (3 days 23 hours)', async () => {
    const at = new Date(Date.now() - (3 * 24 + 23) * 60 * 60 * 1000);
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(makeOrder({ deliveredAt: at, fulfillmentMetrics: { deliveredAt: at } }));
    const { res, next } = await run(createReturnRequest, { body: baseBody, user: { _id: 'u1' } });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('rejects an ineligible reason (change of mind)', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(makeOrder());
    const body = { ...baseBody, items: [{ productId: 'prod-1', quantity: 1, reason: 'changed_mind' }] };
    const { res, error } = await run(createReturnRequest, { body, user: { _id: 'u1' } });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(error.message).toMatch(/wrong item, transit damage, or a manufacturing defect/i);
  });

  it('blocks a non-returnable product', async () => {
    const order = makeOrder();
    order.items[0].product.returnPolicy = { returnable: false };
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(order);
    const { res, error } = await run(createReturnRequest, { body: baseBody, user: { _id: 'u1' } });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(error.message).toMatch(/not eligible for return/i);
  });

  it('rejects when the mandatory unboxing video is missing', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(makeOrder());
    const body = { ...baseBody, video: undefined };
    const { res, error } = await run(createReturnRequest, { body, user: { _id: 'u1' } });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(error.message).toMatch(/unboxing video is required/i);
  });

  it('rejects when the problem description is missing', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(makeOrder());
    const body = { ...baseBody, problemDescription: '   ' };
    const { res, error } = await run(createReturnRequest, { body, user: { _id: 'u1' } });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(error.message).toMatch(/description of the problem is required/i);
  });

  it('creates a return, snapshots product value, and emails customer + support', async () => {
    mockOrderRepo.findOwnedWithProducts.mockResolvedValue(makeOrder());
    const { res, next } = await run(createReturnRequest, { body: baseBody, user: { _id: 'u1' } });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    const created = mockReturnRepo.create.mock.calls[0][0];
    expect(created.refund.productValue).toBe(1000); // 2 × ₹500
    expect(mockEnqueue).toHaveBeenCalledWith('send-return-submitted', { returnId: 'ret-1' });
    expect(mockEnqueue).toHaveBeenCalledWith('send-admin-return-alert', { returnId: 'ret-1' });
  });
});

describe('initiateReturnRefund — deductions + gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrderRepo.findById.mockResolvedValue({ _id: 'order-1', paymentStatus: 'paid', payment: 'payment-1', totalAmount: 1500, save: jest.fn() });
    mockPaymentRepo.findById.mockResolvedValue({ gatewayPaymentId: 'pay_123' });
    mockRazorpay.refundPayment.mockResolvedValue({ refundId: 'rfnd_1', status: 'processed', amount: 90000 });
    mockReturnRepo.save.mockResolvedValue(true);
    // Default: pre-check passes, and the atomic claim succeeds returning the claimed doc.
    mockReturnRepo.findById.mockResolvedValue(makeReturn());
    mockReturnRepo.claimForRefund.mockImplementation(async (_id, amounts) => makeReturn({ refund: { productValue: 1000, status: 'processing', ...amounts } }));
  });

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
    const { res, error } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });
    expect(res.status).toHaveBeenCalledWith(400);
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
    const { res, error } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: { shippingDeduction: 1000 }, user: { _id: 'a1' } });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(error.message).toMatch(/greater than ₹0/);
    expect(mockReturnRepo.claimForRefund).not.toHaveBeenCalled();
  });

  it('409s when the atomic claim is lost to a concurrent refund', async () => {
    mockReturnRepo.claimForRefund.mockResolvedValue(null);
    const { res, error } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: { _id: 'a1' } });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(error.message).toMatch(/already being processed/i);
    expect(mockRazorpay.refundPayment).not.toHaveBeenCalled();
  });
});
