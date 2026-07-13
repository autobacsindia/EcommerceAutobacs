/**
 * Sales CRM — end-to-end offline-deal journey (real in-memory Mongo).
 *
 * Exercises the whole rep-driven flow the way the business actually uses it:
 *   1. A sales rep is provisioned (isSalesRep) and shows up as assignable.
 *   2. A pre-payment order surfaces the buyer as a workable lead; the rep
 *      claims it (race-safe), works the status, logs contact.
 *   3. The rep closes the deal as an OFFLINE order → the buyer's account is
 *      created, the order lands in their history, LTV/purchase denorm updates,
 *      and the lead converts to `won`.
 *   4. The brand-new buyer claims their account via the emailed magic link and
 *      SETS A PASSWORD for the first time.
 *   5. The buyer can then log in with that password and see their order history.
 *
 * Steps 3–5 are the seams that had no coverage — the offline controller, the
 * set-password (magic-link) claim, and the paid/payment-status stamping.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// The offline controller enqueues invoice + magic-link emails only when a queue
// Redis is configured. Turn it on and stub the queue so the token is generated
// but no real Redis/email is touched.
process.env.REDIS_URL = 'redis://localhost:6379';
// Plain functions (not jest.fn) so the suite's resetMocks doesn't wipe the
// resolved-promise implementation between tests. Capture enqueued jobs so a test
// can read the RAW magic-link token (only the hash is persisted on the user).
const enqueued = [];
const mockAdd = (name, data) => { enqueued.push({ name, data }); return Promise.resolve({}); };
const mockQueue = { add: mockAdd };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue,
  getOrderQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue,
  enqueueNotification: () => {},
  closeQueues: () => Promise.resolve(),
}));

// Stub the Razorpay payment-link creation (no real API call); capture the calls.
const paymentLinks = [];
jest.unstable_mockModule('../services/razorpayService.js', () => ({
  default: {
    createPaymentLink: async (order, customer) => {
      paymentLinks.push({ order, customer });
      return { id: 'plink_test_123', shortUrl: 'https://rzp.io/i/testlink' };
    },
  },
}));

const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: Lead } = await import('../models/Lead.js');
const { default: SalesRep } = await import('../models/SalesRep.js');
const { createOfflineOrder } = await import('../controllers/orderController.js');
const { verifyMagicLink } = await import('../controllers/magicLinkController.js');
const { default: leadSyncService } = await import('../services/leadSyncService.js');
const { default: leadRepository } = await import('../repositories/leadRepository.js');
const { default: orderRepository } = await import('../repositories/orderRepository.js');
const { isSalesRep } = await import('../utils/salesReps.js');

// ── Minimal req/res doubles (controllers take (req, res)) ────────────────────
const makeRes = () => {
  const res = {};
  res.statusCode = 200;
  res.cookies = {};
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  res.cookie = jest.fn((name, value, opts) => { res.cookies[name] = { value, opts }; return res; });
  return res;
};

async function makeRep(overrides = {}) {
  const passwordHash = await bcrypt.hash('RepPass123!', 10);
  return User.create({
    name: 'Rep One', email: `rep${Math.random().toString(36).slice(2)}@abx.com`,
    phone: '9000000001', passwordHash, role: 'admin', isSalesRep: true, ...overrides,
  });
}

const BUYER = { email: 'walkin.buyer@example.com', phone: '9812345678', name: 'Walk In Buyer' };
// A valid delivery address for offline-order requests (now required).
const OFF_ADDR = { addressLine1: '12 MG Road', city: 'Pune', state: 'MH', postalCode: '411001', country: 'India' };

async function seedPendingOrder(identity) {
  // A created-but-unpaid order → the "left at checkout" lead signal.
  return Order.create({
    user: new mongoose.Types.ObjectId(),
    source: 'web',
    items: [{ product: new mongoose.Types.ObjectId(), quantity: 1, price: 1500, name: 'Alloy Wheel' }],
    shippingAddress: { fullName: identity.name, phone: identity.phone, addressLine1: '1 St', city: 'Mumbai', state: 'MH', postalCode: '400001', country: 'India' },
    subtotal: 1500, totalAmount: 1500, status: 'awaiting_payment', paymentStatus: 'pending',
    guestEmail: identity.email,
  });
}

describe('CRM — sales rep provisioning', () => {
  it('flags a rep as assignable; a plain admin is not', async () => {
    const rep = await makeRep();
    const plainAdmin = await User.create({
      name: 'Ops', email: 'ops@abx.com', phone: '9000000002',
      passwordHash: await bcrypt.hash('x', 10), role: 'admin',
    });

    expect(isSalesRep(rep)).toBe(true);
    expect(isSalesRep(plainAdmin)).toBe(false);

    const reps = await User.find({ isSalesRep: true }).lean();
    expect(reps.map((r) => r.email)).toContain(rep.email);
    expect(reps.map((r) => r.email)).not.toContain(plainAdmin.email);
  });
});

describe('CRM — lead surfaced, claimed, worked', () => {
  it('a pre-payment order becomes a claimable lead the rep can work', async () => {
    const order = await seedPendingOrder(BUYER);
    const lead = await leadSyncService.upsertFromOrder(order);

    expect(lead).toBeTruthy();
    expect(lead.status).toBe('new');
    expect(lead.assignedTo).toBeNull();
    expect(lead.sources.map((s) => s.type)).toContain('payment_pending');

    // Two named reps race to claim the same pooled lead → exactly one wins.
    const admin = await makeRep();
    const [repA, repB] = await Promise.all([SalesRep.create({ name: 'Rahul' }), SalesRep.create({ name: 'Amit' })]);
    const [claimA, claimB] = await Promise.all([
      leadSyncService.claimLead(lead._id, repA._id, admin._id),
      leadSyncService.claimLead(lead._id, repB._id, admin._id),
    ]);
    const winners = [claimA, claimB].filter(Boolean);
    expect(winners).toHaveLength(1);
    // The lead now shows a named owner (who claimed it).
    expect(winners[0].assignedRep).toBeTruthy();

    // Logging a call bumps a brand-new lead to `contacted` and credits the rep.
    const worked = await leadSyncService.logActivity(lead._id, {
      type: 'call', actorId: admin._id, repId: winners[0].assignedRep, notes: 'Discussed fitment',
    });
    expect(worked.status).toBe('contacted');
    expect(worked.lastContactedAt).toBeTruthy();
    expect(worked.activities.some((x) => x.type === 'call' && x.rep?.toString() === winners[0].assignedRep.toString())).toBe(true);
  });
});

describe('CRM — offline deal → account → set password → order history', () => {
  it('closes an offline order for a new buyer and creates their account (paid)', async () => {
    const admin = await makeRep();
    const closingRep = await SalesRep.create({ name: 'Priya' });
    // A live lead for this buyer so we can assert conversion on close.
    const lead = await leadSyncService.upsertFromOrder(await seedPendingOrder(BUYER));

    const req = {
      user: { id: admin._id.toString(), role: 'admin', isSalesRep: true },
      body: {
        email: BUYER.email, phone: BUYER.phone, name: BUYER.name,
        items: [{ product: new mongoose.Types.ObjectId().toString(), quantity: 2, price: 1200, name: 'Wiper' }],
        shippingAddress: OFF_ADDR,
        status: 'processing',
        leadId: lead._id.toString(),
        repId: closingRep._id.toString(),
      },
    };
    const res = makeRes();
    await createOfflineOrder(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.customer.isNewUser).toBe(true);

    const order = await orderRepository.findById(res.body.order._id);
    expect(order.source).toBe('offline');
    expect(order.status).toBe('processing');
    // The deal is DONE — this is a paid order on the payment axis, not "pending".
    expect(order.paymentStatus).toBe('paid');
    // The closing rep is credited on the order.
    expect(order.salesRep?.toString()).toBe(closingRep._id.toString());
    // The real delivery address is stored (not the old 'N/A' / '000000' placeholders).
    expect(order.shippingAddress.addressLine1).toBe(OFF_ADDR.addressLine1);
    expect(order.shippingAddress.city).toBe('Pune');
    expect(order.shippingAddress.postalCode).toBe('411001');

    const user = await User.findOne({ email: BUYER.email });
    expect(user).toBeTruthy();
    expect(user.mustResetPassword).toBe(true);   // forced to set a password
    expect(user.magicLinkToken).toBeTruthy();     // claim link was issued
    expect(user.paidOrderCount).toBe(1);
    expect(user.hasPurchased).toBe(true);
    expect(user.totalSpentPaise).toBe(order.totalAmount * 100);

    // The originating lead converted, crediting the closing rep on the conversion.
    const closedLead = await leadRepository.findById(lead._id);
    expect(closedLead.status).toBe('won');
    expect(closedLead.hasPurchased).toBe(true);
    expect(closedLead.activities.some((x) => x.type === 'conversion' && x.rep?.toString() === closingRep._id.toString())).toBe(true);
  });

  it('creates a STANDALONE offline order (no lead) → account + paid order + set-password token, no lead', async () => {
    const admin = await makeRep();
    const closingRep = await SalesRep.create({ name: 'Standalone Rep' });
    enqueued.length = 0;
    const req = {
      user: { id: admin._id.toString(), role: 'admin' },
      body: {
        email: 'meta.lead@example.com', phone: '9700000123', name: 'Meta Lead',
        items: [{ product: new mongoose.Types.ObjectId().toString(), quantity: 1, price: 800, name: 'Cover' }],
        shippingAddress: OFF_ADDR,
        status: 'processing',
        repId: closingRep._id.toString(),
        // no leadId — this buyer is not in the CRM pipeline
      },
    };
    const res = makeRes();
    await createOfflineOrder(req, res);

    expect(res.statusCode).toBe(201);
    const user = await User.findOne({ email: 'meta.lead@example.com' });
    expect(user).toBeTruthy();
    expect(user.mustResetPassword).toBe(true);                 // first-time password set
    expect(user.magicLinkToken).toBeTruthy();                   // set-password link issued
    expect(enqueued.some((j) => j.name === 'send-magic-link-email')).toBe(true);

    const order = await orderRepository.findById(res.body.order._id);
    expect(order.paymentStatus).toBe('paid');
    expect(order.salesRep?.toString()).toBe(closingRep._id.toString()); // credited to the rep

    // A direct sale does not spin up a CRM lead.
    expect(await Lead.findOne({ email: 'meta.lead@example.com' })).toBeNull();
  });

  it('LINK mode: creates an awaiting-payment order + Razorpay link, does NOT convert the lead yet', async () => {
    const admin = await makeRep();
    const closingRep = await SalesRep.create({ name: 'Link Rep' });
    const lead = await leadSyncService.upsertFromOrder(
      await seedPendingOrder({ email: 'linkbuyer@example.com', phone: '9811122233', name: 'Link Buyer' })
    );
    paymentLinks.length = 0;
    enqueued.length = 0;

    const req = {
      user: { id: admin._id.toString(), role: 'admin' },
      body: {
        email: 'linkbuyer@example.com', phone: '9811122233', name: 'Link Buyer',
        items: [{ product: new mongoose.Types.ObjectId().toString(), quantity: 1, price: 2500, name: 'Speaker' }],
        shippingAddress: OFF_ADDR,
        paymentMode: 'link',
        leadId: lead._id.toString(),
        repId: closingRep._id.toString(),
      },
    };
    const res = makeRes();
    await createOfflineOrder(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.paymentLink?.shortUrl).toBe('https://rzp.io/i/testlink');
    // A link was requested for the order total.
    expect(paymentLinks).toHaveLength(1);
    expect(paymentLinks[0].order.totalAmount).toBe(2500);

    const order = await orderRepository.findById(res.body.order._id);
    expect(order.status).toBe('awaiting_payment');       // NOT processing yet
    expect(order.paymentStatus).not.toBe('paid');         // not paid until the webhook
    expect(order.paymentLinkId).toBe('plink_test_123');
    expect(order.paymentLinkUrl).toBe('https://rzp.io/i/testlink');
    expect(order.salesRep?.toString()).toBe(closingRep._id.toString());

    // Lead stays open — it converts to won only when the link is paid.
    expect((await leadRepository.findById(lead._id)).status).not.toBe('won');

    // New buyer account + set-password link issued; invoice is deferred to payment.
    const user = await User.findOne({ email: 'linkbuyer@example.com' });
    expect(user.mustResetPassword).toBe(true);
    expect(user.magicLinkToken).toBeTruthy();
    expect(enqueued.some((j) => j.name === 'send-magic-link-email')).toBe(true);
    expect(enqueued.some((j) => j.name === 'send-order-invoice')).toBe(false);
  });

  it('rejects an offline order with no / incomplete delivery address (400, nothing created)', async () => {
    const rep = await makeRep();
    const req = {
      user: { id: rep._id.toString(), role: 'admin' },
      body: {
        email: 'noaddr@example.com', phone: '9800000000', name: 'No Addr',
        items: [{ product: new mongoose.Types.ObjectId().toString(), quantity: 1, price: 100, name: 'x' }],
        status: 'processing', // no shippingAddress
      },
    };
    const res = makeRes();
    await createOfflineOrder(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/address/i);
    expect(await User.findOne({ email: 'noaddr@example.com' })).toBeNull(); // no account created on a rejected order

    // A bad PIN is also rejected.
    const res2 = makeRes();
    await createOfflineOrder({ ...req, body: { ...req.body, shippingAddress: { ...OFF_ADDR, postalCode: '12' } } }, res2);
    expect(res2.statusCode).toBe(400);
  });

  it('mints a claimable set-password token even when the queue Redis is down', async () => {
    const savedRedis = process.env.REDIS_URL;
    delete process.env.REDIS_URL; // simulate queue outage at creation time
    try {
      const rep = await makeRep();
      const req = {
        user: { id: rep._id.toString(), role: 'admin', isSalesRep: true },
        body: {
          email: 'noredis.buyer@example.com', phone: '9811111111', name: 'No Redis',
          items: [{ product: new mongoose.Types.ObjectId().toString(), quantity: 1, price: 500, name: 'Bulb' }],
          shippingAddress: OFF_ADDR,
          status: 'processing',
        },
      };
      const res = makeRes();
      await createOfflineOrder(req, res);
      expect(res.statusCode).toBe(201);

      const user = await User.findOne({ email: 'noredis.buyer@example.com' });
      // Account is still claimable — token was persisted despite no queue.
      expect(user.magicLinkToken).toBeTruthy();
      expect(user.mustResetPassword).toBe(true);
    } finally {
      process.env.REDIS_URL = savedRedis;
    }
  });

  it('the new buyer claims their account and sets a password they can log in with', async () => {
    const rep = await makeRep();
    const req = {
      user: { id: rep._id.toString(), role: 'admin', isSalesRep: true },
      body: {
        email: BUYER.email, phone: BUYER.phone, name: BUYER.name,
        items: [{ product: new mongoose.Types.ObjectId().toString(), quantity: 1, price: 999, name: 'Mat' }],
        shippingAddress: OFF_ADDR,
        status: 'processing',
      },
    };
    enqueued.length = 0;
    await createOfflineOrder(req, makeRes());

    const created = await User.findOne({ email: BUYER.email });
    // The user stores only the HASH; the buyer gets the RAW token by email.
    expect(created.magicLinkToken).toBeTruthy();
    expect(created.magicLinkToken).not.toBe('');
    const token = enqueued.find((j) => j.name === 'send-magic-link-email')?.data.token;
    expect(token).toBeTruthy();
    expect(token).not.toBe(created.magicLinkToken); // raw ≠ stored hash

    // The buyer opens the claim link and sets their first password.
    const NEW_PASSWORD = 'BuyerChosen123!';
    const vres = makeRes();
    await verifyMagicLink({ body: { token, password: NEW_PASSWORD }, headers: {}, connection: {} }, vres);
    expect(vres.statusCode).toBe(200);
    expect(vres.body.success).toBe(true);
    // The buyer is actually logged in: httpOnly auth cookies were set (not just an
    // access token dropped in the body the cookie-based frontend ignores).
    expect(vres.cookies.accessToken?.value).toBeTruthy();
    expect(vres.cookies.refreshToken?.value).toBeTruthy();

    const claimed = await User.findOne({ email: BUYER.email });
    // Password actually persisted and matches what they typed.
    expect(await bcrypt.compare(NEW_PASSWORD, claimed.passwordHash)).toBe(true);
    // No longer forced through a reset — normal password login now works.
    expect(claimed.mustResetPassword).toBe(false);
    // Magic-link token is single-use: consumed, not left live.
    expect(claimed.magicLinkToken == null).toBe(true);
    expect(claimed.isVerified).toBe(true);

    // Their offline order is visible in their history.
    const history = await orderRepository.findByUser(claimed._id, { limit: 20 });
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].source).toBe('offline');
  });
});

describe('CRM — returning customer reopens a closed cycle', () => {
  it('a fresh signal on a won lead starts a new cycle, preserving history', async () => {
    // Convert a buyer (won), then a later cancelled order re-engages them.
    const order = await seedPendingOrder({ email: 're@ex.com', phone: '9700000000', name: 'Returning' });
    await leadSyncService.upsertFromOrder(order);
    order.paymentStatus = 'paid';
    await order.save();
    const won = await leadSyncService.upsertFromOrder(order); // → converts to won
    expect(won.status).toBe('won');

    // A new, workable signal (cancelled order) lands on the closed lead.
    const cancelled = await seedPendingOrder({ email: 're@ex.com', phone: '9700000000', name: 'Returning' });
    cancelled.status = 'cancelled';
    cancelled.paymentStatus = 'paid';
    await cancelled.save();
    const reopened = await leadSyncService.upsertFromOrder(cancelled);

    expect(reopened.status).toBe('new');            // back in the pool
    expect(reopened.reopenCount).toBe(1);
    expect(reopened.cycles).toHaveLength(1);        // the won cycle is archived
    expect(reopened.cycles[0].outcome).toBe('won');
    expect(reopened.hasPurchased).toBe(true);       // permanent customer fact survives
  });
});
