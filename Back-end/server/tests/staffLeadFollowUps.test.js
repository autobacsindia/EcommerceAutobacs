/**
 * GTM leads sheet (/api/v1/staff/leads), two asks from the GTM team:
 *
 *  1. "Which product?" — a lead card names the products behind its signal (name,
 *     variant, qty), for old leads too (read from the order / cart), and says
 *     "removed" when the product is gone.
 *  2. Follow-up statuses — each follow-up records Responded / WhatsApp / Converted /
 *     No response / Not interested / Others (+ note; Others needs one), kept as
 *     history, newest shown as a badge and filterable. Who may record, what each
 *     does to the lead's status, double clicks, and the lead moving meanwhile.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Lead } = await import('../models/Lead.js');
const { default: Order } = await import('../models/Order.js');
const { default: Cart } = await import('../models/Cart.js');
const { default: Product } = await import('../models/Product.js');

const BASE = '/api/v1';

jest.setTimeout(120000);
beforeAll(async () => { await dbHandler.connect(); });
afterEach(async () => { await dbHandler.clearDatabase(); });
afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

let n = 0;
async function login(role, staff, name) {
  n += 1;
  const email = `fu${n}@autobacs.test`;
  const password = 'SecurePass123!';
  const user = await User.create({
    name: name || `User ${n}`, email, phone: '9000000001', passwordHash: await bcrypt.hash(password, 4), role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password });
  const token = (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='))
    .split(';')[0].slice('accessToken='.length);
  return { token, user };
}
const as = (who) => ({ Authorization: `Bearer ${who.token}` });
const gtmLead = (name) => login('staff', { team: 'sales', subRole: 'lead' }, name);
const gtmHead = (name) => login('staff', { team: 'sales', isHead: true }, name);

let k = 0;
async function makeLead(over = {}) {
  k += 1;
  return Lead.create({
    name: `Customer ${k}`, phone: `98765${String(k).padStart(5, '0')}`, email: `c${k}@mail.test`,
    identityKey: `phone:98765${String(k).padStart(5, '0')}`,
    primarySource: 'payment_failed', status: 'new', leadScore: 50,
    sources: [{ type: 'payment_failed', snapshot: { total: 18400, itemCount: 2 } }],
    ...over,
  });
}

// Raw inserts: these tests are about reading lines back, not about creating products/carts.
async function product(name) {
  const _id = new mongoose.Types.ObjectId();
  await Product.collection.insertOne({ _id, name, slug: `p-${_id}` });
  return _id;
}
async function order(items) {
  return Order.create({
    user: new mongoose.Types.ObjectId(),
    items: items.map((it) => ({ product: it.product || new mongoose.Types.ObjectId(), quantity: it.quantity || 1, price: 500, ...it })),
    shippingAddress: {
      fullName: 'Thomson', phone: '9876500000', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001', country: 'India',
    },
    subtotal: 500, totalAmount: 500, status: 'awaiting_payment', paymentStatus: 'pending',
  });
}

const list = (who, qs = '') => request(app).get(`${BASE}/staff/leads${qs}`).set(as(who));
const record = (who, lead, body) => request(app).post(`${BASE}/staff/leads/${lead._id}/follow-ups`).set(as(who)).send(body);
const takeLead = (who, lead) => request(app).post(`${BASE}/staff/leads/${lead._id}/follow-up`).set(as(who)).expect(200);

describe('1. which product the lead is about', () => {
  it('an old "left at checkout" lead (no lines in its snapshot) reads them from the order, with variant and qty', async () => {
    const o = await order([
      { name: 'Pioneer SPH-10BT', variantLabel: 'Black', quantity: 1 },
      { name: '3D floor mats', quantity: 2 },
    ]);
    await makeLead({
      primarySource: 'payment_pending',
      sources: [{ type: 'payment_pending', ref: o._id, refModel: 'Order', snapshot: { total: 15980, itemCount: 2 } }],
    });
    const head = await gtmHead();
    const res = await list(head).expect(200);
    expect(res.body.leads[0].detail.items).toEqual([
      { name: 'Pioneer SPH-10BT', variantLabel: 'Black', quantity: 1, removed: false },
      { name: '3D floor mats', variantLabel: null, quantity: 2, removed: false },
    ]);
    expect(res.body.leads[0].detail.total).toBe(15980);
  });

  it('a line without its own name takes the product\'s; a deleted product shows as removed', async () => {
    const kept = await product('Godrej dash cam');
    const o = await order([{ product: kept, quantity: 1 }, { product: new mongoose.Types.ObjectId(), quantity: 3 }]);
    // Order lines normally carry a name; very old ones did not.
    await Order.collection.updateOne({ _id: o._id }, { $unset: { 'items.0.name': '', 'items.1.name': '' } });
    await makeLead({ sources: [{ type: 'payment_failed', ref: o._id, refModel: 'Order', snapshot: { total: 900 } }] });
    const head = await gtmHead();
    const [row] = (await list(head).expect(200)).body.leads;
    expect(row.detail.items).toEqual([
      { name: 'Godrej dash cam', variantLabel: null, quantity: 1, removed: false },
      { name: null, variantLabel: null, quantity: 3, removed: true },
    ]);
  });

  it('when the order itself is gone, the saved snapshot lines are shown', async () => {
    await makeLead({
      sources: [{
        type: 'payment_failed', ref: new mongoose.Types.ObjectId(), refModel: 'Order',
        snapshot: { total: 2000, items: [{ name: 'Seat covers', quantity: 1 }, { name: null, quantity: 1 }] },
      }],
    });
    const head = await gtmHead();
    const [row] = (await list(head).expect(200)).body.leads;
    expect(row.detail.items).toEqual([
      { name: 'Seat covers', variantLabel: null, quantity: 1, removed: false },
      { name: null, variantLabel: null, quantity: 1, removed: true },
    ]);
  });

  it('an abandoned cart names its products (one read for the whole page), and the detail view agrees', async () => {
    const mats = await product('7D car mats');
    const cartId = new mongoose.Types.ObjectId();
    await Cart.collection.insertOne({ _id: cartId, items: [{ product: mats, variantLabel: 'Hilux', quantity: 2, price: 3000 }] });
    const lead = await makeLead({ primarySource: 'cart_abandoned', sources: [{ type: 'cart_abandoned', ref: cartId, refModel: 'Cart', snapshot: { itemCount: 1 } }] });
    const head = await gtmHead();
    const expected = [{ name: '7D car mats', variantLabel: 'Hilux', quantity: 2, removed: false }];
    expect((await list(head).expect(200)).body.leads[0].detail.items).toEqual(expected);
    const one = await request(app).get(`${BASE}/staff/leads/${lead._id}`).set(as(head)).expect(200);
    expect(one.body.lead.detail.items).toEqual(expected);
  });

  it('a waiting-list lead shows its product; a consultation has no product lines', async () => {
    await makeLead({ primarySource: 'backorder_waitlist', leadScore: 60, sources: [{ type: 'backorder_waitlist', snapshot: { productName: 'Android stereo', variantLabel: '9 inch' } }] });
    await makeLead({ primarySource: 'consultation', leadScore: 10, sources: [{ type: 'consultation', snapshot: { makeModel: 'Creta' } }] });
    const head = await gtmHead();
    const rows = (await list(head).expect(200)).body.leads;
    expect(rows[0].detail.items).toEqual([{ name: 'Android stereo', variantLabel: '9 inch', quantity: null, removed: false }]);
    expect(rows[1].detail.items).toBeNull();
  });
});

describe('2. follow-up statuses', () => {
  it('records each follow-up as history (who, when, status, note), newest first, with the newest as the badge', async () => {
    const nevin = await gtmLead('Nevin');
    const lead = await makeLead();
    await takeLead(nevin, lead);
    const first = await record(nevin, lead, { status: 'no_response', note: 'rang twice' }).expect(200);
    expect(first.body.outcome).toBe('saved');
    expect(first.body.lead.followUpStatus).toMatchObject({ status: 'no_response', label: 'No response' });
    await record(nevin, lead, { status: 'whatsapp' }).expect(200);

    const one = await request(app).get(`${BASE}/staff/leads/${lead._id}`).set(as(nevin)).expect(200);
    const fus = one.body.lead.history.filter((h) => h.type === 'follow_up');
    expect(fus.map((h) => [h.label, h.followUpStatus, h.notes, h.who])).toEqual([
      ['WhatsApp', 'whatsapp', '', 'Nevin'],
      ['No response', 'no_response', 'rang twice', 'Nevin'],
    ]);
    expect(one.body.lead.followUpStatus.status).toBe('whatsapp');
    // WhatsApp reached the customer: a new lead becomes contacted. No response did not.
    expect((await Lead.findById(lead._id)).status).toBe('contacted');
  });

  it('rejects "Others" without text, an unknown status and an over-long note — nothing is saved', async () => {
    const nevin = await gtmLead();
    const lead = await makeLead();
    await takeLead(nevin, lead);
    const others = await record(nevin, lead, { status: 'other' }).expect(400);
    expect(others.body.message).toMatch(/Others/);
    await record(nevin, lead, { status: 'other', note: '    ' }).expect(400);
    await record(nevin, lead, { status: 'maybe' }).expect(400);
    await record(nevin, lead, {}).expect(400);
    await record(nevin, lead, { status: 'responded', note: 'x'.repeat(501) }).expect(400);
    await record(nevin, lead, { status: 'responded', note: { $gt: '' } }).expect(400);
    const saved = await Lead.findById(lead._id);
    expect(saved.activities.filter((a) => a.type === 'follow_up')).toHaveLength(0);
    expect(saved.followUpStatus).toBeUndefined();

    const ok = await record(nevin, lead, { status: 'other', note: '  Asked for a quote on email  ' }).expect(200);
    expect(ok.body.lead.followUpStatus.label).toBe('Others');
    expect((await Lead.findById(lead._id)).activities.at(-2).notes).toBe('Asked for a quote on email');
  });

  it('only the person following up, the GTM head and admin may record; everyone else is refused', async () => {
    const nevin = await gtmLead('Nevin');
    const other = await gtmLead('Other seller');
    const exec = await login('staff', { team: 'sales', subRole: 'executive' });
    const procurement = await login('staff', { team: 'procurement' });
    const customer = await login('customer');
    const head = await gtmHead('Head');
    const admin = await login('admin');
    const lead = await makeLead();
    await takeLead(nevin, lead);

    await record(other, lead, { status: 'responded' }).expect(403);
    await record(exec, lead, { status: 'responded' }).expect(403);
    await record(procurement, lead, { status: 'responded' }).expect(403);
    await record(customer, lead, { status: 'responded' }).expect(403);
    await request(app).post(`${BASE}/staff/leads/${lead._id}/follow-ups`).set({ Authorization: 'Bearer nope' }).send({ status: 'responded' }).expect(401);
    expect((await Lead.findById(lead._id)).activities.filter((a) => a.type === 'follow_up')).toHaveLength(0);

    await record(head, lead, { status: 'responded', note: 'head called' }).expect(200);
    await record(admin, lead, { status: 'no_response' }).expect(200);
    const one = await request(app).get(`${BASE}/staff/leads/${lead._id}`).set(as(head)).expect(200);
    expect(one.body.lead.history.filter((h) => h.type === 'follow_up').map((h) => h.who)).toEqual([admin.user.name, 'Head']);
  });

  it('needs someone following up, and an open lead (409 with the lead, nothing saved)', async () => {
    const nevin = await gtmLead();
    const free = await makeLead();
    const res = await record(nevin, free, { status: 'responded' }).expect(409);
    expect(res.body.outcome).toBe('not_following');
    expect(res.body.lead.id).toBe(String(free._id));

    const closed = await makeLead({ status: 'lost' });
    expect((await record(nevin, closed, { status: 'responded' }).expect(409)).body.outcome).toBe('closed');
  });

  it('Not interested closes the lead as lost, with the note as the reason', async () => {
    const nevin = await gtmLead();
    const lead = await makeLead();
    await takeLead(nevin, lead);
    const res = await record(nevin, lead, { status: 'not_interested', note: 'bought elsewhere' }).expect(200);
    expect(res.body.lead.status).toBe('lost');
    const saved = await Lead.findById(lead._id);
    expect(saved.lostReason).toBe('bought elsewhere');
    expect(saved.leadScore).toBe(0);
    // Closed now: no more follow-ups on this cycle.
    await record(nevin, lead, { status: 'responded' }).expect(409);
    // Off the default (open) list; still found under "all".
    expect((await list(nevin)).body.leads).toHaveLength(0);
    expect((await list(nevin, '?status=all')).body.leads).toHaveLength(1);
  });

  it('Converted keeps the lead open (qualified) — only a paid order marks it won', async () => {
    const nevin = await gtmLead();
    const lead = await makeLead();
    await takeLead(nevin, lead);
    const res = await record(nevin, lead, { status: 'converted', note: 'paying tonight' }).expect(200);
    expect(res.body.lead.status).toBe('qualified');
    expect(res.body.lead.followUpStatus.label).toBe('Converted');
    expect(res.body.lead.followingUp).not.toBeNull();
    const saved = await Lead.findById(lead._id);
    expect(saved.status).not.toBe('won');
    expect(saved.convertedAt).toBeNull();
    // Converted again: no backwards move, no error.
    await new Promise((r) => setTimeout(r, 5));
    await record(nevin, lead, { status: 'converted', note: 'still paying' }).expect(200);
    expect((await Lead.findById(lead._id)).status).toBe('qualified');
  });

  it('a double click records one follow-up, not two', async () => {
    const nevin = await gtmLead();
    const lead = await makeLead();
    await takeLead(nevin, lead);
    await record(nevin, lead, { status: 'no_response', note: 'busy' }).expect(200);
    const again = await record(nevin, lead, { status: 'no_response', note: 'busy' }).expect(200);
    expect(again.body.outcome).toBe('duplicate');
    expect((await Lead.findById(lead._id)).activities.filter((a) => a.type === 'follow_up')).toHaveLength(1);
  });

  it('a follow-up does not land if the lead was handed to someone else meanwhile', async () => {
    const nevin = await gtmLead('Nevin');
    const head = await gtmHead();
    const priya = await gtmLead('Priya');
    const lead = await makeLead();
    await takeLead(nevin, lead);
    await request(app).post(`${BASE}/staff/leads/${lead._id}/reassign`).set(as(head)).send({ userId: String(priya.user._id) }).expect(200);
    await record(nevin, lead, { status: 'responded' }).expect(403);
  });

  it('filters the sheet by the newest follow-up status, or by none yet', async () => {
    const nevin = await gtmLead();
    const a = await makeLead({ leadScore: 90 });
    const b = await makeLead({ leadScore: 80 });
    await makeLead({ leadScore: 70 });
    await takeLead(nevin, a);
    await takeLead(nevin, b);
    await record(nevin, a, { status: 'no_response' }).expect(200);
    await record(nevin, b, { status: 'whatsapp' }).expect(200);
    const ids = async (qs) => (await list(nevin, qs).expect(200)).body.leads.map((l) => l.name);
    expect(await ids('?followUp=no_response')).toEqual([a.name]);
    expect(await ids('?followUp=whatsapp')).toEqual([b.name]);
    expect(await ids('?followUp=none')).toHaveLength(1);
    await list(nevin, '?followUp=bogus').expect(400);
  });

  it('a reopened lead starts its new cycle with no follow-up badge', async () => {
    const { default: leadSyncService } = await import('../services/leadSyncService.js');
    const lead = await makeLead({ status: 'lost', followUpStatus: 'not_interested', followUpStatusAt: new Date() });
    const doc = await Lead.findById(lead._id);
    leadSyncService._closeCycleAndReset(doc, 'payment_failed');
    await doc.save();
    const saved = await Lead.findById(lead._id).lean();
    expect(saved.followUpStatus).toBeUndefined();
    expect(saved.status).toBe('new');
  });
});
