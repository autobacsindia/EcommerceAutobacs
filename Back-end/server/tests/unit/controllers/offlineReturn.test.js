import { jest } from '@jest/globals';

/**
 * Unit tests for the OFFLINE return path — a return that was handled off-platform
 * (walk-in, phone, sales rep) and is being RECORDED by an admin rather than driven
 * through the storefront flow.
 *
 * The point of these tests is the split between what the offline path is allowed to
 * skip and what it is not:
 *
 *   skipped (policy)     4-day window, unboxing video, proof of purchase,
 *                        non-returnable classes, `delivered` order status,
 *                        courier/AWB, warehouse inspection.
 *   enforced (money)     refund base recomputed from the ORDER, one active return per
 *                        (order, product), the headroom cap, and the single atomic
 *                        claim that makes cash and gateway payouts mutually exclusive.
 *
 * Same mocking approach as returnController.test.js — no DB, no gateway, no Cloudinary.
 */

const mockReturnRepo = {
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  claimForRefund: jest.fn(),
  claimPaymentRecord: jest.fn(),
  find: jest.fn(),
  // productId → units already spoken for by an in-flight/refunded return. The offline
  // path is held to the same quantity ceiling as the customer path, so that an admin
  // cannot record their way past the units the order actually contained.
  returnedQuantityByProduct: jest.fn(),
};
const mockOrderRepo = {
  findByIdWithProducts: jest.fn(),
  findById: jest.fn(),
  setReturnRequestStatus: jest.fn(),
  markReturnedOnReturnApproval: jest.fn(),
  revertReturnToDelivered: jest.fn(),
};
const mockPaymentRepo = { findById: jest.fn(), recordRefund: jest.fn() };
const mockRazorpay = { refundPayment: jest.fn() };
const mockEnqueue = jest.fn();
const mockReverseLtv = jest.fn();
const mockAudit = { logAction: jest.fn() };

jest.unstable_mockModule('../../../repositories/returnRequestRepository.js', () => ({ default: mockReturnRepo }));
jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: mockOrderRepo }));
jest.unstable_mockModule('../../../repositories/paymentRepository.js', () => ({ default: mockPaymentRepo }));
jest.unstable_mockModule('../../../services/razorpayService.js', () => ({ default: mockRazorpay }));
jest.unstable_mockModule('../../../services/returnRefundLtvService.js', () => ({ reverseReturnLtvOnce: mockReverseLtv }));
jest.unstable_mockModule('../../../services/auditLogger.js', () => ({ default: mockAudit }));
jest.unstable_mockModule('../../../queue/queues.js', () => ({ enqueueNotification: mockEnqueue }));
jest.unstable_mockModule('../../../utils/returnsCloudinary.js', () => ({
  RETURNS_FOLDER_BASE: 'autobacs/returns',
  generateReturnUploadSignature: jest.fn(() => ({ signature: 'sig' })),
  getReturnResource: jest.fn(),
  signedReturnAssetUrl: jest.fn(() => 'https://signed'),
  resourceFormat: () => 'jpg',
}));

const {
  createOfflineReturn,
  markReturnedOffline,
  initiateReturnRefund,
} = await import('../../../controllers/returnController.js');

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const ADMIN = { _id: 'admin-1', email: 'ops@x.com' };

async function run(handler, req) {
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  const next = jest.fn();
  await handler(req, res, next);
  const error = next.mock.calls[0]?.[0];
  return { res, next, error, status: error?.statusCode ?? res.status.mock.calls[0]?.[0] };
}

/**
 * An order that the CUSTOMER-facing flow would refuse outright: delivered nine days
 * ago (window closed), still sitting at `shipped`, and carrying a product flagged
 * non-returnable. Every offline-create test runs against this deliberately.
 */
function makeAwkwardOrder(overrides = {}) {
  return {
    _id: 'order-1',
    user: 'user-1',
    status: 'shipped',
    paymentStatus: 'paid',
    payment: 'payment-1',
    // 2 × ₹500 + 1 × ₹200 = ₹1200 goods, no discount, ₹500 shipping.
    subtotal: 1200,
    discount: 0,
    shippingCost: 500,
    totalAmount: 1700,
    deliveredAt: daysAgo(9),
    fulfillmentMetrics: { deliveredAt: daysAgo(9) },
    items: [
      { product: { _id: 'prod-1', name: 'Wiper', returnPolicy: { returnable: false } }, quantity: 2, price: 500, variantId: null },
      { product: { _id: 'prod-2', name: 'Mat', returnPolicy: { returnable: true } }, quantity: 1, price: 200, variantId: null },
    ],
    returnRequest: {},
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

const baseCreateBody = {
  orderId: 'order-1',
  items: [{ productId: 'prod-1', quantity: 2, reason: 'manufacturing_defect' }],
  note: 'Customer brought it into the Vyttila counter',
};

describe('createOfflineReturn — records what the storefront flow would refuse', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrderRepo.findByIdWithProducts.mockResolvedValue(makeAwkwardOrder());
    // syncOrderReturnedStatus re-reads the order to work out whether the return covers
    // every delivered line before it touches the fulfilment axis.
    mockOrderRepo.findById.mockResolvedValue(makeAwkwardOrder());
    mockReturnRepo.findOne.mockResolvedValue(null);
    mockReturnRepo.returnedQuantityByProduct.mockResolvedValue(new Map()); // nothing returned yet
    mockReturnRepo.create.mockImplementation(async (doc) => ({ _id: 'ret-1', ...doc }));
    mockOrderRepo.markReturnedOnReturnApproval.mockResolvedValue(true);
  });

  it('records a return that is out of window, undocumented, non-returnable and not yet delivered', async () => {
    const { res, next } = await run(createOfflineReturn, { body: baseCreateBody, user: ADMIN });
    expect(next).not.toHaveBeenCalled();

    const doc = mockReturnRepo.create.mock.calls[0][0];
    expect(doc.origin).toBe('admin_offline');
    expect(doc.createdBy).toBe('admin-1');
    expect(doc.video).toBeNull();
    expect(doc.proofOfPurchase).toBeNull();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('lands straight in `received` with the inspection passed, so the refund gate is satisfied', async () => {
    await run(createOfflineReturn, { body: baseCreateBody, user: ADMIN });
    const doc = mockReturnRepo.create.mock.calls[0][0];
    expect(doc.status).toBe('received');
    expect(doc.inspection.passed).toBe(true);
    expect(doc.inspection.by).toBe('admin-1');
  });

  it('snapshots the charged unit price and clamps the quantity to what was bought', async () => {
    await run(createOfflineReturn, {
      body: { ...baseCreateBody, items: [{ productId: 'prod-1', quantity: 99, reason: 'wrong_item' }] },
      user: ADMIN,
    });
    const doc = mockReturnRepo.create.mock.calls[0][0];
    expect(doc.items[0]).toMatchObject({ unitPrice: 500, quantity: 2 });
    // 2 × ₹500, no discount → the refundable base is the ₹1000 actually paid.
    expect(doc.refund.productValue).toBe(1000);
  });

  /*
    `baseCreateBody` returns prod-1 ×2 out of the order's THREE delivered units
    (prod-1 ×2 + prod-2 ×1) — a partial return. The summary mirror still moves to
    `item_received`, because that describes the RETURN; the order's fulfilment axis must
    not, because the customer still holds the mat. Before the coverage check this flipped
    the whole order to `returned`, a terminal state that stranded the un-returned line.
  */
  it('mirrors the summary as item_received but leaves a PARTIAL return on the order axis', async () => {
    const order = makeAwkwardOrder();
    mockOrderRepo.findByIdWithProducts.mockResolvedValue(order);
    /*
      Read TWICE per request, and the two reads want different answers: the create-path
      guard runs BEFORE this return exists (nothing claimed yet, so prod-1 ×2 is
      allowed), while the coverage check runs after (prod-1 ×2 now claimed).
    */
    mockReturnRepo.returnedQuantityByProduct
      .mockResolvedValueOnce(new Map())
      .mockResolvedValue(new Map([['prod-1', 2]]));
    await run(createOfflineReturn, { body: baseCreateBody, user: ADMIN });

    expect(order.returnRequest.status).toBe('item_received');
    expect(order.save).toHaveBeenCalled();
    expect(mockOrderRepo.markReturnedOnReturnApproval).not.toHaveBeenCalled();
  });

  it('moves the order onto the returned axis when the offline return covers every line', async () => {
    const order = makeAwkwardOrder();
    mockOrderRepo.findByIdWithProducts.mockResolvedValue(order);
    // Guard read first (nothing claimed), then the coverage read (everything claimed).
    mockReturnRepo.returnedQuantityByProduct
      .mockResolvedValueOnce(new Map())
      .mockResolvedValue(new Map([['prod-1', 2], ['prod-2', 1]]));

    await run(createOfflineReturn, {
      body: {
        ...baseCreateBody,
        items: [
          { productId: 'prod-1', quantity: 2, reason: 'manufacturing_defect' },
          { productId: 'prod-2', quantity: 1, reason: 'manufacturing_defect' },
        ],
      },
      user: ADMIN,
    });

    expect(order.returnRequest.status).toBe('item_received');
    expect(mockOrderRepo.markReturnedOnReturnApproval).toHaveBeenCalledWith('order-1', 'admin-1', expect.stringMatching(/Offline return/));
  });

  it('stays silent to the customer by default — they handed the goods over in person', async () => {
    await run(createOfflineReturn, { body: baseCreateBody, user: ADMIN });
    expect(mockEnqueue).not.toHaveBeenCalledWith('send-return-submitted', expect.anything());
  });

  it('emails the customer only when the operator explicitly asks', async () => {
    await run(createOfflineReturn, { body: { ...baseCreateBody, notifyCustomer: true }, user: ADMIN });
    expect(mockEnqueue).toHaveBeenCalledWith('send-return-submitted', { returnId: 'ret-1' });
  });

  it('records a return on a legacy/guest order that has no user at all', async () => {
    mockOrderRepo.findByIdWithProducts.mockResolvedValue(makeAwkwardOrder({ user: undefined }));
    const { next } = await run(createOfflineReturn, { body: baseCreateBody, user: ADMIN });
    expect(next).not.toHaveBeenCalled();
    expect(mockReturnRepo.create.mock.calls[0][0].user).toBeUndefined();
  });

  it('leaves it pending — and the order untouched — when the goods are not back yet', async () => {
    await run(createOfflineReturn, { body: { ...baseCreateBody, markReturned: false }, user: ADMIN });
    const doc = mockReturnRepo.create.mock.calls[0][0];
    expect(doc.status).toBe('pending');
    expect(doc.inspection.passed).toBeNull();
    expect(mockOrderRepo.markReturnedOnReturnApproval).not.toHaveBeenCalled();
  });

  it('still refuses a second active return for the same line', async () => {
    mockReturnRepo.findOne.mockResolvedValue({ _id: 'ret-existing' });
    const { status, error } = await run(createOfflineReturn, { body: baseCreateBody, user: ADMIN });
    expect(status).toBe(409);
    expect(error.message).toMatch(/already exists/i);
    expect(mockReturnRepo.create).not.toHaveBeenCalled();
  });

  it('checks every line for a clash in ONE query, not one per line', async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ productId: `prod-${i}`, quantity: 1, reason: 'wrong_item' }));
    mockOrderRepo.findByIdWithProducts.mockResolvedValue(makeAwkwardOrder({
      subtotal: 500,
      totalAmount: 1000,
      items: items.map((it) => ({ product: { _id: it.productId, name: it.productId }, quantity: 1, price: 100, variantId: null })),
    }));

    await run(createOfflineReturn, { body: { ...baseCreateBody, items }, user: ADMIN });
    // The (order, items.product) index is multikey, so one `$in` uses the same index a
    // per-line lookup did. Five round trips to Atlas for a five-line return was pure waste.
    expect(mockReturnRepo.findOne).toHaveBeenCalledTimes(1);
    expect(mockReturnRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({
      'items.product': { $in: items.map((i) => i.productId) },
    }));
  });

  it('rejects the same product entered twice — the unique index cannot catch it', async () => {
    const { status, error } = await run(createOfflineReturn, {
      body: {
        ...baseCreateBody,
        items: [
          { productId: 'prod-1', quantity: 1, reason: 'wrong_item' },
          { productId: 'prod-1', quantity: 1, reason: 'wrong_item' },
        ],
      },
      user: ADMIN,
    });
    expect(status).toBe(400);
    expect(error.message).toMatch(/listed twice/i);
    expect(mockReturnRepo.create).not.toHaveBeenCalled();
  });

  it('snapshots the RIGHT variant when one product sits on the order twice', async () => {
    // A variable product on two lines shares one product id. Matching on product alone
    // always binds the first line — wrong variant, wrong charged price, wrong qty cap.
    mockOrderRepo.findByIdWithProducts.mockResolvedValue(makeAwkwardOrder({
      subtotal: 1100, totalAmount: 1600,
      items: [
        { _id: 'line-a', product: { _id: 'prod-1', name: 'Mat (Black)' }, variantId: 'var-black', quantity: 1, price: 300 },
        { _id: 'line-b', product: { _id: 'prod-1', name: 'Mat (Beige)' }, variantId: 'var-beige', quantity: 2, price: 400 },
      ],
    }));

    await run(createOfflineReturn, {
      body: { ...baseCreateBody, items: [{ itemId: 'line-b', productId: 'prod-1', variantId: 'var-beige', quantity: 2, reason: 'wrong_item' }] },
      user: ADMIN,
    });
    const doc = mockReturnRepo.create.mock.calls[0][0];
    expect(doc.items[0]).toMatchObject({ variantId: 'var-beige', unitPrice: 400, quantity: 2 });
    expect(doc.refund.productValue).toBe(800);
  });

  it('falls back to variantId when no line id is sent', async () => {
    mockOrderRepo.findByIdWithProducts.mockResolvedValue(makeAwkwardOrder({
      subtotal: 1100, totalAmount: 1600,
      items: [
        { _id: 'line-a', product: { _id: 'prod-1', name: 'Mat (Black)' }, variantId: 'var-black', quantity: 1, price: 300 },
        { _id: 'line-b', product: { _id: 'prod-1', name: 'Mat (Beige)' }, variantId: 'var-beige', quantity: 2, price: 400 },
      ],
    }));
    await run(createOfflineReturn, {
      body: { ...baseCreateBody, items: [{ productId: 'prod-1', variantId: 'var-beige', quantity: 1, reason: 'wrong_item' }] },
      user: ADMIN,
    });
    expect(mockReturnRepo.create.mock.calls[0][0].items[0]).toMatchObject({ variantId: 'var-beige', unitPrice: 400 });
  });

  it('refuses an imported line with no catalogue product instead of writing a broken return', async () => {
    // Order.items.product is optional for source:'woocommerce', but
    // ReturnRequest.items.product is required — so this can never be recorded.
    mockOrderRepo.findByIdWithProducts.mockResolvedValue(makeAwkwardOrder({
      subtotal: 500, totalAmount: 1000,
      items: [{ _id: 'line-woo', product: null, name: 'Legacy Woo item', quantity: 1, price: 500 }],
    }));
    const { status, error } = await run(createOfflineReturn, {
      body: { ...baseCreateBody, items: [{ itemId: 'line-woo', quantity: 1, reason: 'wrong_item' }] },
      user: ADMIN,
    });
    expect(status).toBe(422);
    expect(error.message).toMatch(/no catalogue product/i);
    expect(mockReturnRepo.create).not.toHaveBeenCalled();
  });

  it('holds the offline route to the same quantity ceiling as the customer route', async () => {
    // prod-1 was bought ×2 and one unit is already spoken for, so only one may be recorded.
    mockReturnRepo.returnedQuantityByProduct.mockResolvedValue(new Map([['prod-1', 1]]));
    const { status, error } = await run(createOfflineReturn, {
      body: { ...baseCreateBody, items: [{ productId: 'prod-1', quantity: 2, reason: 'wrong_item' }] },
      user: ADMIN,
    });
    expect(status).toBe(409);
    expect(error.message).toMatch(/Only 1 of "Wiper" can still be returned/);
    expect(mockReturnRepo.create).not.toHaveBeenCalled();
  });

  it('allows the units that are still outstanding', async () => {
    mockReturnRepo.returnedQuantityByProduct.mockResolvedValue(new Map([['prod-1', 1]]));
    const { next } = await run(createOfflineReturn, {
      body: { ...baseCreateBody, items: [{ productId: 'prod-1', quantity: 1, reason: 'wrong_item' }] },
      user: ADMIN,
    });
    expect(next).not.toHaveBeenCalled();
    expect(mockReturnRepo.create.mock.calls[0][0].items[0].quantity).toBe(1);
  });

  it('counts the ceiling across EVERY line carrying the product, not just the first', async () => {
    // 1 black + 2 beige of one variable product. The beige line alone may be returned in
    // full; capping on the first matching line would refuse it at 1.
    mockOrderRepo.findByIdWithProducts.mockResolvedValue(makeAwkwardOrder({
      subtotal: 1100, totalAmount: 1600,
      items: [
        { _id: 'line-a', product: { _id: 'prod-1', name: 'Mat' }, variantId: 'var-black', quantity: 1, price: 300 },
        { _id: 'line-b', product: { _id: 'prod-1', name: 'Mat' }, variantId: 'var-beige', quantity: 2, price: 400 },
      ],
    }));
    const { next } = await run(createOfflineReturn, {
      body: { ...baseCreateBody, items: [{ itemId: 'line-b', productId: 'prod-1', variantId: 'var-beige', quantity: 2, reason: 'wrong_item' }] },
      user: ADMIN,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('weighs two variant lines of one product against a SHARED ceiling', async () => {
    // 3 units across two variant lines, 1 already spoken for → 2 may still come back.
    // Requesting both lines in full (1 + 2 = 3) must fail: checked per LINE against the
    // per-PRODUCT remaining, each line looks affordable and the pair slips through.
    mockOrderRepo.findByIdWithProducts.mockResolvedValue(makeAwkwardOrder({
      subtotal: 1100, totalAmount: 1600,
      items: [
        { _id: 'line-a', product: { _id: 'prod-1', name: 'Mat' }, variantId: 'var-black', quantity: 1, price: 300 },
        { _id: 'line-b', product: { _id: 'prod-1', name: 'Mat' }, variantId: 'var-beige', quantity: 2, price: 400 },
      ],
    }));
    mockReturnRepo.returnedQuantityByProduct.mockResolvedValue(new Map([['prod-1', 1]]));

    const { status, error } = await run(createOfflineReturn, {
      body: {
        ...baseCreateBody,
        items: [
          { itemId: 'line-a', productId: 'prod-1', variantId: 'var-black', quantity: 1, reason: 'wrong_item' },
          { itemId: 'line-b', productId: 'prod-1', variantId: 'var-beige', quantity: 2, reason: 'wrong_item' },
        ],
      },
      user: ADMIN,
    });
    expect(status).toBe(409);
    expect(error.message).toMatch(/Only 2 of "Mat" can still be returned/);
    expect(mockReturnRepo.create).not.toHaveBeenCalled();
  });

  it('clamps an over-entered quantity to what the line actually held', async () => {
    // The operator typing 99 must not become a 99-unit refund base.
    const { next } = await run(createOfflineReturn, {
      body: { ...baseCreateBody, items: [{ productId: 'prod-1', quantity: 99, reason: 'wrong_item' }] },
      user: ADMIN,
    });
    expect(next).not.toHaveBeenCalled();
    expect(mockReturnRepo.create.mock.calls[0][0].items[0].quantity).toBe(2);
  });

  it('rejects a line that is not on the order', async () => {
    const { status, error } = await run(createOfflineReturn, {
      body: { ...baseCreateBody, items: [{ productId: 'prod-999', quantity: 1, reason: 'wrong_item' }] },
      user: ADMIN,
    });
    expect(status).toBe(400);
    expect(error.message).toMatch(/not part of this order/i);
  });

  it('requires the operator note — it is the only record an offline return leaves', async () => {
    const { status, error } = await run(createOfflineReturn, { body: { ...baseCreateBody, note: '   ' }, user: ADMIN });
    expect(status).toBe(400);
    expect(error.message).toMatch(/note/i);
    expect(mockReturnRepo.create).not.toHaveBeenCalled();
  });

  it('404s on an unknown order', async () => {
    mockOrderRepo.findByIdWithProducts.mockResolvedValue(null);
    const { status } = await run(createOfflineReturn, { body: baseCreateBody, user: ADMIN });
    expect(status).toBe(404);
  });

  it('writes an audit row naming the operator and their note', async () => {
    await run(createOfflineReturn, { body: baseCreateBody, user: ADMIN });
    expect(mockAudit.logAction).toHaveBeenCalledWith(
      expect.anything(), 'RETURN_OFFLINE_CREATE', 'ReturnRequest', 'ret-1',
      expect.objectContaining({ orderId: 'order-1', note: baseCreateBody.note }),
    );
  });
});

describe('markReturnedOffline — fast-forwarding a customer-raised return', () => {
  const makeReturn = (overrides = {}) => ({
    _id: 'ret-1',
    order: 'order-1',
    status: 'pending',
    inspection: { passed: null },
    timeline: [],
    user: { email: 'c@x.com' },
    ...overrides,
  });

  const load = (doc) => ({ populate: () => Promise.resolve(doc) });

  beforeEach(() => {
    jest.clearAllMocks();
    mockReturnRepo.save.mockResolvedValue(true);
    mockOrderRepo.markReturnedOnReturnApproval.mockResolvedValue(true);
    // A single-line order whose only delivered unit is the one coming back, so the
    // coverage check passes and the fulfilment axis legitimately moves.
    mockOrderRepo.findById.mockResolvedValue({
      _id: 'order-1',
      status: 'delivered',
      items: [{ _id: 'i1', product: 'prod-1', quantity: 1 }],
      shipments: [],
      cancellations: [],
    });
    mockReturnRepo.returnedQuantityByProduct.mockResolvedValue(new Map([['prod-1', 1]]));
  });

  it('jumps `pending` straight to received+passed without a courier or an AWB', async () => {
    const rr = makeReturn();
    mockReturnRepo.findById.mockReturnValue(load(rr));

    const { next } = await run(markReturnedOffline, { params: { id: 'ret-1' }, body: { note: 'Dropped at the counter' }, user: ADMIN });
    expect(next).not.toHaveBeenCalled();
    expect(rr.status).toBe('received');
    expect(rr.inspection.passed).toBe(true);
    expect(rr.timeline).toHaveLength(1);
    expect(mockOrderRepo.setReturnRequestStatus).toHaveBeenCalledWith('order-1', 'item_received');
    // The return never got approved, so the approval-time fulfilment flip happens here.
    expect(mockOrderRepo.markReturnedOnReturnApproval).toHaveBeenCalled();
  });

  it('also works from courier_booked, where the parcel never actually shipped', async () => {
    const rr = makeReturn({ status: 'courier_booked' });
    mockReturnRepo.findById.mockReturnValue(load(rr));
    const { next } = await run(markReturnedOffline, { params: { id: 'ret-1' }, body: { note: 'Hand-carried instead' }, user: ADMIN });
    expect(next).not.toHaveBeenCalled();
    expect(rr.status).toBe('received');
  });

  it.each(['refunded', 'rejected', 'cancelled'])('refuses to reopen a %s return', async (status) => {
    mockReturnRepo.findById.mockReturnValue(load(makeReturn({ status })));
    const { status: httpStatus, error } = await run(markReturnedOffline, { params: { id: 'ret-1' }, body: { note: 'x' }, user: ADMIN });
    expect(httpStatus).toBe(400);
    expect(error.message).toMatch(/cannot be reopened/i);
    expect(mockReturnRepo.save).not.toHaveBeenCalled();
  });

  it('is idempotent — a double-click adds no second timeline entry', async () => {
    const rr = makeReturn({ status: 'received', inspection: { passed: true, at: new Date('2026-08-01') } });
    mockReturnRepo.findById.mockReturnValue(load(rr));
    const { next } = await run(markReturnedOffline, { params: { id: 'ret-1' }, body: { note: 'again' }, user: ADMIN });
    expect(next).not.toHaveBeenCalled();
    expect(rr.timeline).toHaveLength(0);
    expect(mockReturnRepo.save).not.toHaveBeenCalled();
  });

  it('requires a note explaining why the mandatory steps were skipped', async () => {
    mockReturnRepo.findById.mockReturnValue(load(makeReturn()));
    const { status } = await run(markReturnedOffline, { params: { id: 'ret-1' }, body: {}, user: ADMIN });
    expect(status).toBe(400);
    expect(mockReturnRepo.save).not.toHaveBeenCalled();
  });

  it('stays silent to the customer unless asked', async () => {
    mockReturnRepo.findById.mockReturnValue(load(makeReturn()));
    await run(markReturnedOffline, { params: { id: 'ret-1' }, body: { note: 'counter' }, user: ADMIN });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('audits the skip with the status it jumped from', async () => {
    mockReturnRepo.findById.mockReturnValue(load(makeReturn({ status: 'approved' })));
    await run(markReturnedOffline, { params: { id: 'ret-1' }, body: { note: 'counter' }, user: ADMIN });
    expect(mockAudit.logAction).toHaveBeenCalledWith(
      expect.anything(), 'RETURN_OFFLINE_RECEIVED', 'ReturnRequest', 'ret-1',
      expect.objectContaining({ previousStatus: 'approved' }),
    );
  });
});

describe('initiateReturnRefund — recording money paid back outside the gateway', () => {
  const mockSiblings = (docs = []) => {
    mockReturnRepo.find.mockReturnValue({ select: () => ({ lean: async () => docs }) });
  };

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
      save: jest.fn().mockResolvedValue(true),
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

  const offlineBody = { method: 'offline', offlineMethod: 'cash', reference: 'RCPT-8821' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockOrderRepo.findById.mockResolvedValue(makeRefundOrder());
    mockSiblings([]);
    mockPaymentRepo.findById.mockResolvedValue({ _id: 'payment-1', gatewayPaymentId: 'pay_123' });
    mockPaymentRepo.recordRefund.mockResolvedValue({});
    mockReturnRepo.claimPaymentRecord.mockResolvedValue({ _id: 'ret-1' });
    mockReturnRepo.save.mockResolvedValue(true);
    mockReturnRepo.findById.mockResolvedValue(makeReturn());
    mockReturnRepo.claimForRefund.mockImplementation(async (_id, amounts) =>
      makeReturn({ refund: { productValue: 1000, status: 'processing', initiatedAt: new Date(), ...amounts } }));
    mockRazorpay.refundPayment.mockResolvedValue({ refundId: 'rfnd_1', status: 'processed' });
  });

  it('records the payout without ever touching Razorpay', async () => {
    const { res, next } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: offlineBody, user: ADMIN });
    expect(next).not.toHaveBeenCalled();
    expect(mockRazorpay.refundPayment).not.toHaveBeenCalled();
    expect(mockReturnRepo.claimForRefund).toHaveBeenCalledWith('ret-1', expect.objectContaining({
      finalAmount: 1000, method: 'offline', offlineMethod: 'cash', reference: 'RCPT-8821',
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      refund: expect.objectContaining({ status: 'completed', amount: 1000, method: 'offline' }),
    }));
  });

  it('completes the return and reverses net LTV once', async () => {
    await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: offlineBody, user: ADMIN });
    const saved = mockReturnRepo.save.mock.calls[0][0];
    expect(saved.status).toBe('refunded');
    expect(saved.refund.status).toBe('completed');
    expect(saved.refund.completedAt).toBeInstanceOf(Date);
    expect(mockReverseLtv).toHaveBeenCalledTimes(1);
  });

  it('accumulates onto the Payment row behind the once-only claim, so cash shrinks gateway headroom', async () => {
    await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: offlineBody, user: ADMIN });
    expect(mockPaymentRepo.recordRefund).toHaveBeenCalledWith('payment-1', 1000, 'return_refund_offline');
  });

  it('does not write to the Payment row when the claim was already taken', async () => {
    mockReturnRepo.claimPaymentRecord.mockResolvedValue(null);
    await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: offlineBody, user: ADMIN });
    expect(mockPaymentRepo.recordRefund).not.toHaveBeenCalled();
  });

  it('records against a PAID order that has no Razorpay payment id — the legacy-import case', async () => {
    // The gateway path 422s here ("no Razorpay payment id on file"); recording it by
    // hand is exactly the gap this feature fills.
    mockOrderRepo.findById.mockResolvedValue(makeRefundOrder({ payment: null }));
    mockPaymentRepo.findById.mockResolvedValue(null);

    const { next, res } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: offlineBody, user: ADMIN });
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
    // Nothing to accumulate against when there is no Payment row.
    expect(mockPaymentRepo.recordRefund).not.toHaveBeenCalled();
  });

  it.each(['pending', 'failed', 'cancelled', 'expired'])(
    'refuses to record a refund on a %s order — headroom is order VALUE, not money collected',
    async (paymentStatus) => {
      // An offline deal whose payment link was never paid sits at `awaiting_payment` with
      // a full totalAmount. Without this gate the headroom check would wave through a
      // "refund" of money nobody ever sent.
      mockOrderRepo.findById.mockResolvedValue(makeRefundOrder({ paymentStatus }));
      const { status, error } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: offlineBody, user: ADMIN });
      expect(status).toBe(422);
      expect(error.message).toMatch(/not paid/i);
      expect(mockReturnRepo.claimForRefund).not.toHaveBeenCalled();
    },
  );

  it('flips the order payment axis to refunded when the offline payout covers the whole order', async () => {
    // No webhook is coming for an offline payout, so if this does not happen here it
    // never happens — and revenue/LTV reporting keyed on paymentStatus:'paid' keeps
    // counting a fully refunded order as a sale.
    const order = makeRefundOrder({ totalAmount: 1000 }); // refund is the full ₹1000
    mockOrderRepo.findById.mockResolvedValue(order);
    await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: offlineBody, user: ADMIN });
    expect(order.paymentStatus).toBe('refunded');
  });

  it('leaves the order `paid` on a PARTIAL offline payout', async () => {
    const order = makeRefundOrder(); // ₹1500 captured, ₹1000 refunded
    mockOrderRepo.findById.mockResolvedValue(order);
    await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: offlineBody, user: ADMIN });
    expect(order.paymentStatus).toBe('paid');
  });

  it('mirrors the refund onto the order, keeping the "Return <id>" prefix headroom keys off', async () => {
    const order = makeRefundOrder();
    mockOrderRepo.findById.mockResolvedValue(order);
    await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: offlineBody, user: ADMIN });

    expect(order.refundDetails).toMatchObject({
      amount: 1000,
      refundMethod: 'offline',
      status: 'completed',
      transactionId: 'RCPT-8821',
      notes: 'Return ret-1',
    });
    expect(mockOrderRepo.setReturnRequestStatus).toHaveBeenCalledWith('order-1', 'refund_processed');
  });

  it('deducts shipping and restocking exactly as the gateway path does', async () => {
    await run(initiateReturnRefund, {
      params: { id: 'ret-1' },
      body: { ...offlineBody, shippingDeduction: 100, restockingDeduction: 50 },
      user: ADMIN,
    });
    expect(mockReturnRepo.claimForRefund).toHaveBeenCalledWith('ret-1', expect.objectContaining({ finalAmount: 850 }));
  });

  it('still refuses to pay out more than the order has left, before anything moves', async () => {
    // A sibling return already drew ₹1200 of the ₹1500 captured.
    mockSiblings([{ _id: 'ret-other', refund: { status: 'completed', finalAmount: 1200 } }]);
    const { status, error } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: offlineBody, user: ADMIN });
    expect(status).toBe(422);
    expect(error.message).toMatch(/exceeds what is left/i);
    expect(mockReturnRepo.claimForRefund).not.toHaveBeenCalled();
  });

  it('still refuses a payout of ₹0 after deductions', async () => {
    const { status } = await run(initiateReturnRefund, {
      params: { id: 'ret-1' },
      body: { ...offlineBody, shippingDeduction: 1000 },
      user: ADMIN,
    });
    expect(status).toBe(400);
    expect(mockReturnRepo.claimForRefund).not.toHaveBeenCalled();
  });

  it('still refuses before the item is received and passed', async () => {
    mockReturnRepo.findById.mockResolvedValue(makeReturn({ inspection: { passed: null } }));
    const { status } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: offlineBody, user: ADMIN });
    expect(status).toBe(400);
    expect(mockReturnRepo.claimForRefund).not.toHaveBeenCalled();
  });

  it('requires how the money was paid back', async () => {
    const { status, error } = await run(initiateReturnRefund, {
      params: { id: 'ret-1' }, body: { method: 'offline', reference: 'X' }, user: ADMIN,
    });
    expect(status).toBe(400);
    expect(error.message).toMatch(/how the money was paid back/i);
    expect(mockReturnRepo.claimForRefund).not.toHaveBeenCalled();
  });

  it('requires a reference — it is the only evidence the money moved', async () => {
    const { status, error } = await run(initiateReturnRefund, {
      params: { id: 'ret-1' }, body: { method: 'offline', offlineMethod: 'upi', reference: '  ' }, user: ADMIN,
    });
    expect(status).toBe(400);
    expect(error.message).toMatch(/reference/i);
    expect(mockReturnRepo.claimForRefund).not.toHaveBeenCalled();
  });

  it('409s when a concurrent request already claimed the refund — never a second payout', async () => {
    mockReturnRepo.claimForRefund.mockResolvedValue(null);
    const { status } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: offlineBody, user: ADMIN });
    expect(status).toBe(409);
    expect(mockPaymentRepo.recordRefund).not.toHaveBeenCalled();
    expect(mockReverseLtv).not.toHaveBeenCalled();
  });

  it('allows a PARTIAL payout on debit-card EMI, which the gateway path must refuse', async () => {
    // The issuer can only unwind the whole loan — but cash handed over at the counter
    // never reaches the issuer, so the constraint does not apply.
    mockPaymentRepo.findById.mockResolvedValue({
      _id: 'payment-1', gatewayPaymentId: 'pay_123', method: 'emi', methodDetails: { emi: { kind: 'debitcard' } },
    });
    const { next } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: offlineBody, user: ADMIN });
    expect(next).not.toHaveBeenCalled();
    expect(mockRazorpay.refundPayment).not.toHaveBeenCalled();
  });

  it('alerts finance, and the customer only on request', async () => {
    await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: offlineBody, user: ADMIN });
    expect(mockEnqueue).toHaveBeenCalledWith('send-admin-return-refunded-alert', { returnId: 'ret-1' });
    expect(mockEnqueue).not.toHaveBeenCalledWith('send-return-status-email', expect.anything());

    jest.clearAllMocks();
    mockReturnRepo.claimForRefund.mockImplementation(async (_id, amounts) =>
      makeReturn({ refund: { status: 'processing', initiatedAt: new Date(), ...amounts } }));
    await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: { ...offlineBody, notifyCustomer: true }, user: ADMIN });
    expect(mockEnqueue).toHaveBeenCalledWith('send-return-status-email', { returnId: 'ret-1', event: 'refunded' });
  });

  it('KEEPS the payout recorded when a follow-up step fails, and reports it', async () => {
    // The money is already in the customer's hands. Rolling the record back to `failed`
    // because the order mirror failed would hide it from remainingRefundable — and a
    // later gateway refund would then pay the same money a second time.
    const order = makeRefundOrder();
    order.save = jest.fn().mockRejectedValue(new Error('mongo down'));
    mockOrderRepo.findById.mockResolvedValue(order);

    const { res, next } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: offlineBody, user: ADMIN });
    expect(next).not.toHaveBeenCalled();

    const saved = mockReturnRepo.save.mock.calls.at(-1)[0];
    expect(saved.refund.status).toBe('completed');
    expect(saved.status).toBe('refunded');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      warnings: expect.arrayContaining(['order mirror']),
    }));
    // The rest of the chain still ran — one broken step must not skip the others.
    expect(mockReverseLtv).toHaveBeenCalledTimes(1);
  });

  it('marks failed AND rewinds to `received` when the durable write itself fails, so a retry can re-claim', async () => {
    mockReturnRepo.save
      .mockRejectedValueOnce(new Error('mongo down'))   // phase 1
      .mockResolvedValue(true);                          // the rewind write

    const { status, error } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: offlineBody, user: ADMIN });
    expect(status).toBe(500);
    expect(error.message).toMatch(/Nothing was recorded/i);

    const rewound = mockReturnRepo.save.mock.calls.at(-1)[0];
    // claimForRefund's gate is `status: received` + a non-terminal refund — both restored.
    expect(rewound.status).toBe('received');
    expect(rewound.refund.status).toBe('failed');
    expect(rewound.timeline.some((t) => t.status === 'refunded')).toBe(false);
    // Nothing downstream may run when the record did not land.
    expect(mockPaymentRepo.recordRefund).not.toHaveBeenCalled();
    expect(mockReverseLtv).not.toHaveBeenCalled();
  });

  it('lets an offline payout shrink the headroom of a LATER gateway refund on the same order', async () => {
    // ₹1500 captured; a sibling return already handed ₹1200 back in cash. The gateway
    // must only be allowed the ₹300 balance — the whole point of recording cash.
    mockSiblings([{ _id: 'ret-other', refund: { status: 'completed', method: 'offline', finalAmount: 1200 } }]);
    const { status, error } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: ADMIN });
    expect(status).toBe(422);
    expect(error.message).toMatch(/₹300 of ₹1500 captured/);
    expect(mockRazorpay.refundPayment).not.toHaveBeenCalled();
  });

  it('leaves the gateway path untouched when no method is given', async () => {
    const { next } = await run(initiateReturnRefund, { params: { id: 'ret-1' }, body: {}, user: ADMIN });
    expect(next).not.toHaveBeenCalled();
    expect(mockRazorpay.refundPayment).toHaveBeenCalledWith('pay_123', 100000, expect.any(Object));
    expect(mockReturnRepo.claimForRefund).toHaveBeenCalledWith('ret-1', expect.objectContaining({ method: 'original_payment' }));
  });
});
