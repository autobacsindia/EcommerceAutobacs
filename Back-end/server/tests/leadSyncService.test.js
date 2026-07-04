/**
 * Sales CRM — leadSyncService integration tests (real in-memory Mongo).
 *
 * Covers the load-bearing behaviours the feature depends on:
 *   • source ingestion + identity dedup (one person, many signals → one lead)
 *   • bidirectional Consultation ↔ Lead status mirror (loop-guarded)
 *   • order pipeline: pending/failed → lead, cancelled → detach, paid → convert
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
    status: 'pending',
    guestEmail: 'buyer@example.com',
    ...overrides,
  });
}

function seedConsultation(overrides = {}) {
  return Consultation.create({
    name: 'Ravi',
    whatsapp: '+91 98765 43210',
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
  });

  it('merges multiple signals from the same identity into one lead', async () => {
    const pending = await seedOrder({ status: 'pending', guestEmail: 'same@x.com' });
    const failed = await seedOrder({ status: 'failed', guestEmail: 'same@x.com' });

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
  it('detaches an order source and loses a now-empty lead on cancellation', async () => {
    const order = await seedOrder({ status: 'pending', guestEmail: 'cancelme@x.com' });
    await leadSyncService.upsertFromOrder(order);

    order.status = 'cancelled';
    const lead = await leadSyncService.upsertFromOrder(order);

    expect(lead.status).toBe('lost');
    expect(lead.lostReason).toBe('order_cancelled');
    expect(lead.sources).toHaveLength(0);
  });

  it('converts the identity’s lead when an order is paid', async () => {
    const pending = await seedOrder({ status: 'pending', guestEmail: 'convert@x.com' });
    await leadSyncService.upsertFromOrder(pending);

    const paid = await seedOrder({ status: 'confirmed', guestEmail: 'convert@x.com' });
    const lead = await leadSyncService.upsertFromOrder(paid);

    expect(lead.status).toBe('won');
    expect(lead.hasPurchased).toBe(true);
  });

  it('does NOT create a lead for a paid order with no prior signal', async () => {
    const paid = await seedOrder({ status: 'delivered', guestEmail: 'fresh@x.com' });
    const lead = await leadSyncService.upsertFromOrder(paid);
    expect(lead).toBeNull();
    expect(await Lead.countDocuments()).toBe(0);
  });
});

describe('leadSyncService — claim & activity', () => {
  it('self-claim is race-safe: exactly one of two concurrent claims wins', async () => {
    const order = await seedOrder({ status: 'failed', guestEmail: 'claim@x.com' });
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
    const order = await seedOrder({ status: 'failed', guestEmail: 'activity@x.com' });
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
  it('confirming an order tags the buyer and converts their lead', async () => {
    const user = await User.create({ name: 'Buyer', email: 'hook@x.com', passwordHash: 'x' });
    // A prior signal exists so there is a lead to convert.
    const pending = await seedOrder({ user: user._id, status: 'pending', guestEmail: 'hook@x.com' });
    await leadSyncService.upsertFromOrder(pending);

    const result = await orderStatusService.updateOrderStatus(pending._id.toString(), 'confirmed', {
      userId: user._id,
      isAdmin: true,
      reason: 'manual_confirmation',
    });
    expect(result.success).toBe(true);

    const refreshedUser = await User.findById(user._id);
    expect(refreshedUser.hasPurchased).toBe(true);
    expect(refreshedUser.paidOrderCount).toBe(1);
    expect(refreshedUser.firstPurchaseAt).toBeTruthy();

    const lead = await Lead.findOne({ email: 'hook@x.com' });
    expect(lead.status).toBe('won');
    expect(lead.hasPurchased).toBe(true);
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
