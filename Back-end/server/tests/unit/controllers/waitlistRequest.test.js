/**
 * "Join the waiting list" (backorder) controller + isolation guarantees:
 *   - availability gating (only BACKORDER items; variable products need a variantId)
 *   - idempotent create (201 then 200), scoped to kind:'backorder'
 *   - seeds a warm CRM lead (source backorder_waitlist)
 *   - the restock fan-out never picks up backorder rows (kind isolation)
 *   - admin list/requesters honour `kind` and pair each waitlister with its lead
 *
 * Drives the exported handlers with mocked req/res over in-memory Mongo, mirroring
 * the sibling notify-me suite (auth is asserted at the route layer).
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../../queue/queues.js', () => ({
  getSearchSyncQueue: () => ({ add: jest.fn().mockResolvedValue(undefined) }),
  getNotificationsQueue: () => ({ add: jest.fn().mockResolvedValue(undefined) }),
  enqueueNotification: jest.fn(),
}));

const { default: Product } = await import('../../../models/Product.js');
const { default: StockNotificationRequest } = await import('../../../models/StockNotificationRequest.js');
const { default: Lead } = await import('../../../models/Lead.js');
const { default: stockNotificationRequestRepository } = await import('../../../repositories/stockNotificationRequestRepository.js');
const controller = await import('../../../controllers/stockNotificationController.js');

beforeAll(async () => {
  await Product.collection.createIndex({ slug: 1 }, { unique: true });
  // The widened, kind-aware unique key (matches models/StockNotificationRequest.js).
  await StockNotificationRequest.collection.createIndex(
    { product: 1, variantId: 1, user: 1, kind: 1 },
    { unique: true, partialFilterExpression: { status: 'pending' } }
  );
}, 60_000);

const oid = () => new (Product.base.Types.ObjectId)();

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const user = () => ({ _id: oid(), email: `buyer-${oid()}@x.com`, name: 'Buyer', phone: '9876543210' });

const simple = (stock) => Product.create({
  name: `Wiper ${stock} ${oid()}`,
  description: 'A perfectly valid product description over ten characters.',
  price: 500, stock,
});

describe('createWaitlistRequest — gating', () => {
  test('409 when the item is not on backorder', async () => {
    for (const stock of ['in', 'out']) {
      const p = await simple(stock);
      const res = mockRes();
      await controller.createWaitlistRequest({ params: { id: p._id.toString() }, body: {}, user: user() }, res);
      expect(res.statusCode).toBe(409);
      expect(res.body.code).toBe('NOT_ON_BACKORDER');
    }
  });

  test('404 for a non-existent product', async () => {
    const res = mockRes();
    await controller.createWaitlistRequest({ params: { id: oid().toString() }, body: {}, user: user() }, res);
    expect(res.statusCode).toBe(404);
  });

  test('variable product requires a valid variantId', async () => {
    const p = await Product.create({
      name: `Mat ${oid()}`, description: 'A perfectly valid product description over ten characters.',
      price: 100, productType: 'variable',
      variants: [{ label: 'A', price: 100, stock: 'backorder' }],
    });

    const missing = mockRes();
    await controller.createWaitlistRequest({ params: { id: p._id.toString() }, body: {}, user: user() }, missing);
    expect(missing.statusCode).toBe(400);

    const good = mockRes();
    await controller.createWaitlistRequest(
      { params: { id: p._id.toString() }, body: { variantId: p.variants[0]._id.toString() }, user: user() },
      good
    );
    expect(good.statusCode).toBe(201);
  });
});

describe('createWaitlistRequest — signup + lead seed', () => {
  test('201 then 200 (idempotent), one backorder row, and a warm lead', async () => {
    const p = await simple('backorder');
    const u = user();

    const res1 = mockRes();
    await controller.createWaitlistRequest({ params: { id: p._id.toString() }, body: {}, user: u }, res1);
    expect(res1.statusCode).toBe(201);
    expect(res1.body.alreadyRequested).toBe(false);

    const res2 = mockRes();
    await controller.createWaitlistRequest({ params: { id: p._id.toString() }, body: {}, user: u }, res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.body.alreadyRequested).toBe(true);

    expect(await StockNotificationRequest.countDocuments({ product: p._id, kind: 'backorder', status: 'pending' })).toBe(1);

    // The waitlister is surfaced in the CRM as a backorder_waitlist lead.
    const lead = await Lead.findOne({ email: u.email });
    expect(lead).not.toBeNull();
    expect(lead.sources.some((s) => s.type === 'backorder_waitlist')).toBe(true);
    expect(lead.primarySource).toBe('backorder_waitlist');
  });

  test('leave + rejoin refreshes ONE lead source (no unbounded stacking) and re-points its ref', async () => {
    const p = await simple('backorder');
    const u = user();

    // Join → capture the first request id.
    const join1 = mockRes();
    await controller.createWaitlistRequest({ params: { id: p._id.toString() }, body: {}, user: u }, join1);
    const req1Id = join1.body.request._id.toString();

    // Leave (cancel) → the pending row is freed.
    const cancel = mockRes();
    await controller.cancelMyRequest({ params: { id: req1Id }, user: u }, cancel);

    // Rejoin → mints a NEW pending request with a different id.
    const join2 = mockRes();
    await controller.createWaitlistRequest({ params: { id: p._id.toString() }, body: {}, user: u }, join2);
    const req2Id = join2.body.request._id.toString();
    expect(req2Id).not.toBe(req1Id);

    // The lead must carry exactly ONE backorder_waitlist source for this product,
    // and its ref must point at the CURRENT (live) request so the contacted mirror
    // reverse-lookup resolves.
    const lead = await Lead.findOne({ email: u.email });
    const waitlistSources = lead.sources.filter((s) => s.type === 'backorder_waitlist');
    expect(waitlistSources).toHaveLength(1);
    expect(waitlistSources[0].ref.toString()).toBe(req2Id);
  });
});

describe('kind isolation — restock fan-out never sweeps backorder rows', () => {
  test('findPendingIdsForTarget returns only restock rows', async () => {
    const p = await simple('backorder');
    await StockNotificationRequest.create([
      { product: p._id, variantId: null, user: oid(), email: 'r@x.com', kind: 'restock' },
      { product: p._id, variantId: null, user: oid(), email: 'b@x.com', kind: 'backorder' },
    ]);

    const ids = await stockNotificationRequestRepository.findPendingIdsForTarget(p._id, null);
    expect(ids).toHaveLength(1);
    const row = await StockNotificationRequest.findById(ids[0]._id);
    expect(row.kind).toBe('restock');
  });
});

describe('admin list — kind filter + contacted join', () => {
  test('adminListRequests(kind=backorder) returns only backorder demand', async () => {
    const p = await simple('backorder');
    await StockNotificationRequest.create([
      { product: p._id, variantId: null, user: oid(), email: 'r1@x.com', kind: 'restock' },
      { product: p._id, variantId: null, user: oid(), email: 'b1@x.com', kind: 'backorder' },
      { product: p._id, variantId: null, user: oid(), email: 'b2@x.com', kind: 'backorder' },
    ]);

    const res = mockRes();
    await controller.adminListRequests({ query: { kind: 'backorder' } }, res);
    const row = res.body.items.find((i) => i.product._id.toString() === p._id.toString());
    expect(row.count).toBe(2);
  });

  test('snapshots the phone so the admin list is a call sheet, for BOTH kinds', async () => {
    // The admin screen reads the number off the request, not just the account,
    // so a row still shows a contact after the user record changes or goes.
    for (const [stock, kind, call] of [
      ['backorder', 'backorder', 'createWaitlistRequest'],
      ['out', 'restock', 'createNotifyRequest'],
    ]) {
      const p = await simple(stock);
      const u = user();
      const res1 = mockRes();
      await controller[call]({ params: { id: p._id.toString() }, body: {}, user: u }, res1);
      expect(res1.statusCode).toBe(201);

      const row = await StockNotificationRequest.findOne({ product: p._id, kind });
      expect(row.phone).toBe(u.phone);
      expect(row.email).toBe(u.email.toLowerCase());
    }
  });

  test('a repeat signup never rewrites the original contact snapshot', async () => {
    const p = await simple('backorder');
    const u = user();
    await controller.createWaitlistRequest({ params: { id: p._id.toString() }, body: {}, user: u }, mockRes());

    // Same account, different number on the second press (e.g. profile edited).
    const res2 = mockRes();
    await controller.createWaitlistRequest(
      { params: { id: p._id.toString() }, body: {}, user: { ...u, phone: '9000000000' } },
      res2,
    );
    expect(res2.statusCode).toBe(200);

    const rows = await StockNotificationRequest.find({ product: p._id, kind: 'backorder' });
    expect(rows).toHaveLength(1);
    expect(rows[0].phone).toBe(u.phone); // $setOnInsert — the first value stands
  });

  test('adminListRequesters returns the phone, and falls back to the live account', async () => {
    const p = await simple('backorder');
    const u = user();
    await controller.createWaitlistRequest({ params: { id: p._id.toString() }, body: {}, user: u }, mockRes());

    // A legacy row, written before the snapshot field existed.
    const legacy = user();
    await StockNotificationRequest.create({
      product: p._id, variantId: null, user: legacy._id, email: legacy.email, kind: 'backorder',
    });

    const res = mockRes();
    await controller.adminListRequesters({ query: { productId: p._id.toString(), kind: 'backorder' } }, res);

    const fresh = res.body.requesters.find((r) => r.email === u.email.toLowerCase());
    expect(fresh.phone).toBe(u.phone);

    const old = res.body.requesters.find((r) => r.email === legacy.email.toLowerCase());
    expect(old.phone).toBeUndefined();          // nothing snapshotted…
    expect(old.user?.phone).toBeUndefined();    // …and no User row exists in this fixture
  });

  test('adminListRequesters(kind=backorder) pairs each requester with its lead', async () => {
    const p = await simple('backorder');
    const u = user();
    const res1 = mockRes();
    await controller.createWaitlistRequest({ params: { id: p._id.toString() }, body: {}, user: u }, res1);

    const res = mockRes();
    await controller.adminListRequesters({ query: { productId: p._id.toString(), kind: 'backorder' } }, res);
    const requester = res.body.requesters.find((r) => (r.user?.email || r.email) === u.email);
    expect(requester).toBeTruthy();
    expect(requester.leadId).toBeTruthy();
    expect(requester.leadStatus).toBe('new');
  });
});
