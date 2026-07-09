/**
 * Sales CRM — leadSyncService integration tests (real in-memory Mongo).
 *
 * Covers the load-bearing behaviours the feature depends on:
 *   • source ingestion + identity dedup (one person, many signals → one lead)
 *   • bidirectional Consultation ↔ Lead status mirror (loop-guarded)
 *   • order pipeline: pending/failed → lead, cancelled → order_cancelled, paid → convert
 *   • race-safe self-claim (exactly one winner)
 *   • activity logging bumps a new lead to contacted
 */

import mongoose from 'mongoose';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Consultation from '../models/Consultation.js';
import Lead from '../models/Lead.js';
import leadSyncService from '../services/leadSyncService.js';
import orderStatusService from '../services/orderStatusService.js';

const ADDRESS = {
  fullName: 'Test Buyer',
  phone: '9876543210',
  addressLine1: '1 Test St',
  city: 'Mumbai',
  state: 'MH',
  postalCode: '400001',
  country: 'India',
};

function seedOrder(overrides = {}) {
  return Order.create({
    user: overrides.user || new mongoose.Types.ObjectId(),
    source: 'web',
    items: [{ product: new mongoose.Types.ObjectId(), quantity: 1, price: 500, name: 'Widget' }],
    shippingAddress: ADDRESS,
    subtotal: 500,
    totalAmount: 500,
    status: 'awaiting_payment',
    paymentStatus: 'pending',
    guestEmail: 'buyer@example.com',
    ...overrides,
  });
}

function seedConsultation(overrides = {}) {
  return Consultation.create({
    name: 'Ravi',
    whatsapp: '+91 98765 43210',
    email: 'ravi@example.com',
    city: 'Pune',
    makeModel: 'Toyota Fortuner',
    upgrades: ['Suspension'],
    ...overrides,
  });
}

describe('leadSyncService — source ingestion & dedup', () => {
  it('creates a lead from a consultation and is idempotent on re-run', async () => {
    const c = await seedConsultation();
    const first = await leadSyncService.upsertFromConsultation(c);
    const second = await leadSyncService.upsertFromConsultation(c);

    expect(first._id.toString()).toBe(second._id.toString());
    expect(await Lead.countDocuments()).toBe(1);
    expect(first.primarySource).toBe('consultation');
    expect(first.status).toBe('new');
    expect(first.sources).toHaveLength(1);
    // Consultation anchors on email (canonical key) so it can dedup with accounts/orders.
    expect(first.identityKey).toBe('email:ravi@example.com');
    expect(first.email).toBe('ravi@example.com');
  });

  it('dedups a consultation onto the same person\'s order lead via email (no stitching)', async () => {
    // Guest consults first (phone + email), then later checks out with the same email.
    const c = await seedConsultation({ email: 'stitch@x.com', whatsapp: '+91 90000 00001' });
    await leadSyncService.upsertFromConsultation(c);

    const failed = await seedOrder({ paymentStatus: 'failed', guestEmail: 'stitch@x.com' });
    const lead = await leadSyncService.upsertFromOrder(failed);

    // One person, one lead — both signals on it, keyed by the shared email.
    expect(await Lead.countDocuments()).toBe(1);
    expect(lead.identityKey).toBe('email:stitch@x.com');
    expect(lead.sources.map((s) => s.type).sort()).toEqual(['consultation', 'payment_failed']);
    expect(lead.primarySource).toBe('payment_failed'); // hotter signal wins the badge
  });

  it('merges multiple signals from the same identity into one lead', async () => {
    const pending = await seedOrder({ paymentStatus: 'pending', guestEmail: 'same@x.com' });
    const failed = await seedOrder({ paymentStatus: 'failed', guestEmail: 'same@x.com' });

    await leadSyncService.upsertFromOrder(pending);
    const lead = await leadSyncService.upsertFromOrder(failed);

    expect(await Lead.countDocuments()).toBe(1);
    expect(lead.sources).toHaveLength(2);
    // payment_failed outranks payment_pending for the badge.
    expect(lead.primarySource).toBe('payment_failed');
  });

  it('skips a source with no usable contact info', async () => {
    // A guest cart with items but no email/phone can't be worked → no lead.
    const lead = await leadSyncService.upsertFromCart(
      { _id: new mongoose.Types.ObjectId(), items: [{ product: new mongoose.Types.ObjectId(), quantity: 1 }] },
      {}
    );
    expect(lead).toBeNull();
    expect(await Lead.countDocuments()).toBe(0);
  });
});

describe('leadSyncService — Consultation ↔ Lead status mirror', () => {
  it('mirrors OUT: changing lead status writes the consultation', async () => {
    const c = await seedConsultation();
    const lead = await leadSyncService.upsertFromConsultation(c);

    await leadSyncService.applyLeadStatus(lead._id, 'contacted', { notes: 'called' });

    const refreshed = await Consultation.findById(c._id);
    expect(refreshed.status).toBe('contacted');
  });

  it('mirrors IN: consultation status change updates the lead (no write-back loop)', async () => {
    const c = await seedConsultation();
    const lead = await leadSyncService.upsertFromConsultation(c);

    const updated = await leadSyncService.syncFromConsultationStatus(c._id, 'completed');

    expect(updated._id.toString()).toBe(lead._id.toString());
    expect(updated.status).toBe('won');
    expect(updated.convertedAt).toBeTruthy();
  });
});

describe('leadSyncService — order pipeline', () => {
  it('upgrades an order source to order_cancelled (re-engagement) on cancellation', async () => {
    const order = await seedOrder({ paymentStatus: 'pending', guestEmail: 'cancelme@x.com' });
    await leadSyncService.upsertFromOrder(order); // → payment_pending source

    order.status = 'cancelled';
    order.cancelledBy = 'admin';
    const lead = await leadSyncService.upsertFromOrder(order);

    // Same order ref is upgraded in place — the person stays workable in the CRM,
    // now flagged as an order_cancelled re-engagement target (admin cancel here).
    expect(lead.status).toBe('new');
    expect(lead.sources).toHaveLength(1);
    expect(lead.primarySource).toBe('order_cancelled');
    expect(lead.sources[0].type).toBe('order_cancelled');
    expect(lead.sources[0].snapshot.cancelledBy).toBe('admin');
  });

  it('converts the identity’s lead when an order is paid', async () => {
    const pending = await seedOrder({ paymentStatus: 'pending', guestEmail: 'convert@x.com' });
    await leadSyncService.upsertFromOrder(pending);

    const paid = await seedOrder({ status: 'processing', paymentStatus: 'paid', guestEmail: 'convert@x.com' });
    const lead = await leadSyncService.upsertFromOrder(paid);

    expect(lead.status).toBe('won');
    expect(lead.hasPurchased).toBe(true);
  });

  it('creates a payment_cancelled lead when the customer cancels the popup', async () => {
    // Popup-cancel keeps the order awaiting_payment but flags paymentStatus.
    const order = await seedOrder({ status: 'awaiting_payment', paymentStatus: 'cancelled', guestEmail: 'popup@x.com' });
    const lead = await leadSyncService.upsertFromOrder(order);

    expect(lead.primarySource).toBe('payment_cancelled');
    expect(lead.status).toBe('new');
  });

  it('does NOT create a lead for a paid order with no prior signal', async () => {
    const paid = await seedOrder({ status: 'delivered', paymentStatus: 'paid', guestEmail: 'fresh@x.com' });
    const lead = await leadSyncService.upsertFromOrder(paid);
    expect(lead).toBeNull();
    expect(await Lead.countDocuments()).toBe(0);
  });
});

describe('leadSyncService — claim & activity', () => {
  it('self-claim is race-safe: exactly one of two concurrent claims wins', async () => {
    const order = await seedOrder({ paymentStatus: 'failed', guestEmail: 'claim@x.com' });
    const lead = await leadSyncService.upsertFromOrder(order);

    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    const [ra, rb] = await Promise.all([
      leadSyncService.claimLead(lead._id, a),
      leadSyncService.claimLead(lead._id, b),
    ]);

    const winners = [ra, rb].filter(Boolean);
    expect(winners).toHaveLength(1);
    const finalLead = await Lead.findById(lead._id);
    expect(finalLead.assignedTo).toBeTruthy();
  });

  it('logging a call bumps a new lead to contacted and stamps lastContactedAt', async () => {
    const order = await seedOrder({ paymentStatus: 'failed', guestEmail: 'activity@x.com' });
    const lead = await leadSyncService.upsertFromOrder(order);
    const actor = new mongoose.Types.ObjectId();

    const updated = await leadSyncService.logActivity(lead._id, { type: 'call', actorId: actor, notes: 'Left a voicemail' });

    expect(updated.status).toBe('contacted');
    expect(updated.lastContactedAt).toBeTruthy();
    expect(updated.contactedBy.toString()).toBe(actor.toString());
    expect(updated.activities.some((a) => a.type === 'call')).toBe(true);
  });
});

describe('order status hook — CRM side-effects', () => {
  it('paying an order (→processing) tags the buyer and converts their lead', async () => {
    const user = await User.create({ name: 'Buyer', email: 'hook@x.com', passwordHash: 'x' });
    // A prior signal exists so there is a lead to convert.
    const pending = await seedOrder({ user: user._id, paymentStatus: 'pending', guestEmail: 'hook@x.com' });
    await leadSyncService.upsertFromOrder(pending);

    const result = await orderStatusService.updateOrderStatus(pending._id.toString(), 'processing', {
      userId: user._id,
      isAdmin: true,
      reason: 'manual_confirmation',
    });
    expect(result.success).toBe(true);

    const refreshedUser = await User.findById(user._id);
    expect(refreshedUser.hasPurchased).toBe(true);
    expect(refreshedUser.paidOrderCount).toBe(1);
    expect(refreshedUser.firstPurchaseAt).toBeTruthy();
    // Net LTV threaded through the hook: ₹500 order → 50000 paise (ADR-006).
    expect(refreshedUser.totalSpentPaise).toBe(50000);
    expect(refreshedUser.lastOrderAt).toBeTruthy();

    // Payment axis is denormalized in step with the fulfillment status.
    const paidOrder = await Order.findById(pending._id);
    expect(paidOrder.paymentStatus).toBe('paid');

    const lead = await Lead.findOne({ email: 'hook@x.com' });
    expect(lead.status).toBe('won');
    expect(lead.hasPurchased).toBe(true);
  });

  it('does NOT double-count LTV when an order re-enters processing', async () => {
    const user = await User.create({ name: 'Buyer2', email: 'dbl@x.com', passwordHash: 'x' });
    const pending = await seedOrder({ user: user._id, paymentStatus: 'pending', guestEmail: 'dbl@x.com' });
    await leadSyncService.upsertFromOrder(pending);
    const opts = { userId: user._id, isAdmin: true, reason: 'admin_update' };

    await orderStatusService.updateOrderStatus(pending._id.toString(), 'processing', { ...opts, reason: 'manual_confirmation' });
    await orderStatusService.updateOrderStatus(pending._id.toString(), 'shipped', opts);
    // Admin moves it BACK to processing (allowed via admin bypass) — must not recount.
    await orderStatusService.updateOrderStatus(pending._id.toString(), 'processing', opts);

    const u = await User.findById(user._id);
    expect(u.paidOrderCount).toBe(1);      // once, not twice
    expect(u.totalSpentPaise).toBe(50000); // ₹500, not ₹1000
  });
});

describe('leadSyncService — cycle reopen (reopen-with-history)', () => {
  it('reopens a WON lead into a fresh cycle when a new workable signal arrives', async () => {
    // Win a lead: prior pending signal, then the order pays.
    const pending = await seedOrder({ paymentStatus: 'pending', guestEmail: 'return@x.com' });
    await leadSyncService.upsertFromOrder(pending);
    const paid = await seedOrder({ status: 'processing', paymentStatus: 'paid', guestEmail: 'return@x.com' });
    const won = await leadSyncService.upsertFromOrder(paid);
    expect(won.status).toBe('won');

    // Later: the same person submits a NEW consultation.
    const c = await seedConsultation({ email: 'return@x.com', whatsapp: '+91 90000 11111' });
    const reopened = await leadSyncService.upsertFromConsultation(c);

    expect(reopened._id.toString()).toBe(won._id.toString()); // same person
    expect(reopened.status).toBe('new');       // fresh cycle
    expect(reopened.assignedTo).toBeNull();     // back to the pool
    expect(reopened.reopenCount).toBe(1);
    expect(reopened.cycles).toHaveLength(1);
    expect(reopened.cycles[0].outcome).toBe('won');
    expect(reopened.hasPurchased).toBe(true);   // permanent fact preserved
    expect(reopened.sources).toHaveLength(1);   // only the NEW signal is live
    expect(reopened.sources[0].type).toBe('consultation');
    expect(reopened.primarySource).toBe('consultation');
  });

  it('reopens a WON lead when its paid order is later cancelled (same ref, type progresses)', async () => {
    // Win via pending→paid: a payment_pending source (ref=order) is recorded first.
    const order = await seedOrder({ paymentStatus: 'pending', guestEmail: 'woncancel@x.com' });
    await leadSyncService.upsertFromOrder(order);
    order.paymentStatus = 'paid';
    order.status = 'processing';
    const won = await leadSyncService.upsertFromOrder(order);
    expect(won.status).toBe('won');
    expect(won.sources.some((s) => s.type === 'payment_pending')).toBe(true);

    // Admin cancels the paid order — SAME ref, but type progresses to order_cancelled.
    order.status = 'cancelled';
    order.cancelledBy = 'admin';
    const reopened = await leadSyncService.upsertFromOrder(order);

    expect(reopened.status).toBe('new');   // re-engaged, not stuck 'won'
    expect(reopened.reopenCount).toBe(1);
    expect(reopened.cycles[0].outcome).toBe('won');
    expect(reopened.sources.map((s) => s.type)).toEqual(['order_cancelled']);
  });

  it('does NOT reopen when the SAME source ref re-syncs on a closed lead', async () => {
    const order = await seedOrder({ paymentStatus: 'failed', guestEmail: 'refresh@x.com' });
    const lead = await leadSyncService.upsertFromOrder(order);
    await leadSyncService.applyLeadStatus(lead._id, 'lost', { lostReason: 'no answer' });

    // Same order syncs again (e.g. webhook retry) — a refresh, not a new signal.
    const again = await leadSyncService.upsertFromOrder(order);
    expect(again.status).toBe('lost');
    expect(again.reopenCount).toBe(0);
    expect(again.cycles).toHaveLength(0);
  });

  it('does NOT reopen a closed lead on a passive dormant-user sweep', async () => {
    const user = await User.create({ name: 'Back', email: 'dormantback@x.com', passwordHash: 'x' });
    const order = await seedOrder({ user: user._id, paymentStatus: 'failed', guestEmail: 'dormantback@x.com' });
    const lead = await leadSyncService.upsertFromOrder(order);
    await leadSyncService.applyLeadStatus(lead._id, 'lost', { lostReason: 'cold' });

    const swept = await leadSyncService.upsertFromDormantUser(user);
    expect(swept.status).toBe('lost');   // a time-based signal must not resurrect
    expect(swept.reopenCount).toBe(0);
    expect(swept.cycles).toHaveLength(0);
    expect(swept.sources.some((s) => s.type === 'dormant_user')).toBe(true); // still recorded
  });

  it('reopens a LOST lead on a new cart, archiving the lost cycle', async () => {
    const order = await seedOrder({ paymentStatus: 'failed', guestEmail: 'twice@x.com' });
    const lead = await leadSyncService.upsertFromOrder(order);
    await leadSyncService.applyLeadStatus(lead._id, 'lost', { lostReason: 'later' });

    const cart = {
      _id: new mongoose.Types.ObjectId(),
      items: [{ product: new mongoose.Types.ObjectId(), quantity: 1 }],
      guestEmail: 'twice@x.com',
    };
    const reopened = await leadSyncService.upsertFromCart(cart, {});
    expect(reopened.status).toBe('new');
    expect(reopened.reopenCount).toBe(1);
    expect(reopened.cycles[0].outcome).toBe('lost');
    expect(reopened.sources.map((s) => s.type)).toEqual(['cart_abandoned']);
  });

  it('does NOT reopen an ACTIVE (non-terminal) lead — just appends the signal', async () => {
    const order = await seedOrder({ paymentStatus: 'pending', guestEmail: 'active@x.com' });
    const lead = await leadSyncService.upsertFromOrder(order);
    await leadSyncService.applyLeadStatus(lead._id, 'contacted', {});

    const c = await seedConsultation({ email: 'active@x.com', whatsapp: '+91 90000 22222' });
    const updated = await leadSyncService.upsertFromConsultation(c);
    expect(updated.status).toBe('contacted'); // unchanged
    expect(updated.reopenCount).toBe(0);
    expect(updated.cycles).toHaveLength(0);
    expect(updated.sources).toHaveLength(2);   // appended, not reset
  });
});

describe('leadSyncService — dormant users', () => {
  it('creates a re-engagement lead from a dormant user', async () => {
    const user = await User.create({ name: 'Dormant', email: 'dormant@x.com', passwordHash: 'x' });
    const lead = await leadSyncService.upsertFromDormantUser(user);

    expect(lead.primarySource).toBe('dormant_user');
    expect(lead.linkedUser.toString()).toBe(user._id.toString());
    expect(lead.email).toBe('dormant@x.com');
  });
});
