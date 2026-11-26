/**
 * An optional file (photo / screenshot / PDF) on a parcel's reason for overdue,
 * over HTTP (multer → validators → teamWorkflowService.setParcelOverdueReason →
 * the stored parcel → the panel's view → the private file route), against a real
 * in-memory Mongo. Storage is mocked (an in-memory map).
 *
 * What must hold:
 *   - a reason without a file works exactly as before (JSON or multipart)
 *   - a photo or PDF is stored privately, shown on the reason and its history entry
 *     with a staff-only link that returns the bytes, never cached
 *   - the type is decided by the BYTES: a renamed .exe is refused, so is a Word file
 *   - a file over the limit is refused with a clear message
 *   - a refused or failed file means NOTHING is saved (no silent loss); the same
 *     reason saves fine without the file
 *   - changing the reason keeps the old file in history (append-only, never deleted)
 *   - the same save sent twice (double-click / retry, same requestId) → ONE history entry
 *   - only procurement / operations / admin may save; a refusal is never a 200
 *   - the file link only opens files recorded on THAT parcel, and not for a customer
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const stored = new Map();
const deleted = [];
let failNextPut = false;
const storageMock = {
  resourceTypeFor: () => 'image',
  putPrivateAsset: async ({ buffer, folder, basename }) => {
    if (failNextPut) { failNextPut = false; throw new Error('R2 down'); }
    const publicId = `${folder}/${basename}`;
    stored.set(publicId, buffer);
    return { publicId, provider: 'r2', bytes: buffer.length, resourceType: 'image', url: '' };
  },
  deletePrivateAsset: async ({ publicId }) => { deleted.push(publicId); return true; },
  readPrivateAsset: async (ref) => {
    if (!stored.has(ref.publicId)) throw new Error('missing');
    return stored.get(ref.publicId);
  },
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: orderStatusService } = await import('../services/orderStatusService.js');
const { istDay, addDays } = await import('../utils/parcelEta.js');
const { MAX_ATTACHMENT_BYTES } = await import('../config/attachments.js');

const BASE = '/api/v1';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(400, 3)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(400, 0x20)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(400, 1)]);

beforeAll(async () => { await dbHandler.connect(); });
afterEach(async () => { await dbHandler.clearDatabase(); stored.clear(); deleted.length = 0; failNextPut = false; });
afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

let n = 0;
async function login(role, staff) {
  n += 1;
  const email = `odf${n}@autobacs.test`;
  const password = 'SecurePass123!';
  await User.create({ name: `User ${n}`, email, phone: '9000000001', passwordHash: await bcrypt.hash(password, 10), role, ...(staff && { staff: { active: true, isHead: false, ...staff } }) });
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password });
  return (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='))
    .split(';')[0].slice('accessToken='.length);
}
const as = (token) => ({ Authorization: `Bearer ${token}` });

/** A paid order shipped from our warehouse whose expected date passed two days ago. */
async function overdueOrder(procurement) {
  const o = await Order.create({
    user: new mongoose.Types.ObjectId(),
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Snorkel', price: 30000, quantity: 1 }],
    shippingAddress: { fullName: 'Ravi', phone: '9876543210', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 30000, totalAmount: 30000, status: 'awaiting_payment', paymentStatus: 'pending',
  });
  await orderStatusService.updateOrderStatus(String(o._id), 'processing', { isAdmin: true, reason: 'payment_verified', paymentVerification: { source: 'razorpay', reference: 'pay_test' } });
  const id = String(o._id);
  const itemId = String(o.items[0]._id);
  const work = `${BASE}/staff/work/orders/${id}`;
  await request(app).post(`${work}/lines/${itemId}/stock`).set(as(procurement)).send({ stock: 'own_stock' }).expect(200);
  await request(app).post(`${work}/dispatch-own`).set(as(procurement)).field('courierCode', 'DTDC').field('courierName', 'DTDC').field('trackingNumber', 'D1').expect(200);
  const sid = String((await Order.findById(id).lean()).shipments[0]._id);
  await request(app).put(`${work}/parcels/${sid}/eta`).set(as(procurement)).send({ date: addDays(istDay(), 1) }).expect(200);
  const day = addDays(istDay(), -2);
  await Order.updateOne({ _id: id }, { $set: { 'shipments.$[].eta.day': day } });
  return { id, sid, day, path: `${work}/parcels/${sid}/overdue-reason` };
}

const parcelOf = async (id) => (await Order.findById(id).lean()).shipments[0];
const fileGet = (url) => request(app).get(url.replace(/^\/api\/v1/, BASE));

describe('a reason without a file', () => {
  it('works exactly as before, as JSON and as a form', async () => {
    const p = await login('staff', { team: 'procurement' });
    const { id, path, day } = await overdueOrder(p);
    const json = await request(app).put(path).set(as(p)).send({ code: 'courier_delay', note: 'hub', expectedDate: day }).expect(200);
    expect(json.body.order.parcels[0].overdueReason).toMatchObject({ code: 'courier_delay', note: 'hub', attachment: null });
    const form = await request(app).put(path).set(as(p)).field('code', 'address_issue').field('expectedDate', day).expect(200);
    expect(form.body.order.parcels[0].overdueReason).toMatchObject({ code: 'address_issue', attachment: null });
    expect((await parcelOf(id)).overdueReasonHistory).toHaveLength(2);
    expect(stored.size).toBe(0);
  });
});

describe('with a file', () => {
  it('stores a photo privately and shows it on the reason and its history entry; the link returns the bytes, never cached', async () => {
    const p = await login('staff', { team: 'procurement' });
    const { id, path, day } = await overdueOrder(p);
    const res = await request(app).put(path).set(as(p))
      .field('code', 'courier_delay').field('note', 'see courier page').field('expectedDate', day)
      .attach('file', PNG, { filename: 'courier page.png', contentType: 'image/png' })
      .expect(200);
    const view = res.body.order.parcels[0];
    expect(view.overdueReason.attachment).toMatchObject({ name: 'courier page.png', mime: 'image/png', size: PNG.length });
    expect(view.overdueReason.attachment.url).toMatch(/\/overdue-files\/overdue-[a-f0-9]{24}-[a-f0-9]{12}\.png$/);
    expect(view.overdueReasonHistory[0].attachment).toEqual(view.overdueReason.attachment);

    const saved = await parcelOf(id);
    expect(saved.overdueReason.attachment).toMatchObject({ key: expect.stringMatching(/^shipping-slips\/overdue-/), provider: 'r2', name: 'courier page.png', mime: 'image/png', size: PNG.length, by: expect.anything(), uploadedAt: expect.any(Date) });
    expect(saved.overdueReasonHistory[0].attachment.key).toBe(saved.overdueReason.attachment.key);

    const file = await fileGet(view.overdueReason.attachment.url).set(as(p)).expect(200);
    expect(file.headers['content-type']).toMatch(/^image\/png/);
    expect(file.headers['cache-control']).toBe('private, no-store');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(file.body, PNG)).toBe(0);
  });

  it('takes a PDF too', async () => {
    const ops = await login('staff', { team: 'operations' });
    const p = await login('staff', { team: 'procurement' });
    const { path } = await overdueOrder(p);
    const res = await request(app).put(path).set(as(ops)).field('code', 'customer_unreachable')
      .attach('file', PDF, { filename: 'calls.pdf', contentType: 'application/pdf' }).expect(200);
    expect(res.body.order.parcels[0].overdueReason.attachment).toMatchObject({ name: 'calls.pdf', mime: 'application/pdf' });
  });

  it('a renamed .exe or a Word file is refused by its bytes, and nothing is saved', async () => {
    const p = await login('staff', { team: 'procurement' });
    const { id, path } = await overdueOrder(p);
    const exe = await request(app).put(path).set(as(p)).field('code', 'courier_delay')
      .attach('file', EXE, { filename: 'proof.png', contentType: 'image/png' });
    expect(exe.status).toBe(400);
    expect(exe.body.message).toMatch(/not a photo \(JPG, PNG, WebP\) or a PDF/);
    const word = await request(app).put(path).set(as(p)).field('code', 'courier_delay')
      .attach('file', Buffer.from('PK\u0003\u0004 word'), { filename: 'note.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    expect(word.status).toBe(400);
    expect(word.body.message).toMatch(/not a photo/);
    const saved = await parcelOf(id);
    expect(saved.overdueReason?.code).toBeUndefined();
    expect(saved.overdueReasonHistory || []).toHaveLength(0);
    expect(stored.size).toBe(0);
  });

  it('a file over the limit is refused with the limit in the message', async () => {
    const p = await login('staff', { team: 'procurement' });
    const { id, path } = await overdueOrder(p);
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_ATTACHMENT_BYTES, 1)]);
    const res = await request(app).put(path).set(as(p)).field('code', 'courier_delay')
      .attach('file', big, { filename: 'huge.png', contentType: 'image/png' });
    expect([400, 413]).toContain(res.status);
    expect(res.body.message).toMatch(/too large|too big|MB/i);
    expect((await parcelOf(id)).overdueReasonHistory || []).toHaveLength(0);
  });

  it('only one file per reason', async () => {
    const p = await login('staff', { team: 'procurement' });
    const { id, path } = await overdueOrder(p);
    const res = await request(app).put(path).set(as(p)).field('code', 'courier_delay')
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
      .attach('file', PNG, { filename: 'b.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect((await parcelOf(id)).overdueReasonHistory || []).toHaveLength(0);
  });

  it('when the upload fails the reason is NOT saved (502); the same reason then saves without the file', async () => {
    const p = await login('staff', { team: 'procurement' });
    const { id, path } = await overdueOrder(p);
    failNextPut = true;
    const failed = await request(app).put(path).set(as(p)).field('code', 'courier_delay').field('note', 'hub').field('requestId', 'save-attempt-1')
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(failed.status).toBe(502);
    expect(failed.body.message).toMatch(/save the reason without the file/);
    expect((await parcelOf(id)).overdueReasonHistory || []).toHaveLength(0);

    const ok = await request(app).put(path).set(as(p)).send({ code: 'courier_delay', note: 'hub', requestId: 'save-attempt-2' }).expect(200);
    expect(ok.body.order.parcels[0].overdueReason).toMatchObject({ note: 'hub', attachment: null });
  });
});

describe('history keeps every file', () => {
  it('changing the reason (with or without a new file) keeps the old file in history; nothing is deleted', async () => {
    const p = await login('staff', { team: 'procurement' });
    const a = await login('admin');
    const { id, path } = await overdueOrder(p);
    const first = await request(app).put(path).set(as(p)).field('code', 'courier_delay')
      .attach('file', PNG, { filename: 'first.png', contentType: 'image/png' }).expect(200);
    const firstUrl = first.body.order.parcels[0].overdueReason.attachment.url;
    await request(app).put(path).set(as(a)).send({ code: 'address_issue', note: 'wrong pin' }).expect(200);
    const third = await request(app).put(path).set(as(p)).field('code', 'other').field('note', 'reattempt')
      .attach('file', PDF, { filename: 'third.pdf', contentType: 'application/pdf' }).expect(200);

    const v = third.body.order.parcels[0];
    expect(v.overdueReason.attachment.name).toBe('third.pdf');
    expect(v.overdueReasonHistory.map((h) => h.attachment?.name ?? null)).toEqual(['third.pdf', null, 'first.png']);
    expect(deleted).toEqual([]);
    // The old file still opens.
    const old = await fileGet(firstUrl).set(as(a)).expect(200);
    expect(Buffer.compare(old.body, PNG)).toBe(0);
    expect(stored.size).toBe(2);
    expect((await parcelOf(id)).overdueReasonHistory).toHaveLength(3);
  });
});

describe('the same save twice', () => {
  it('a double-click / retry with the same requestId adds ONE history entry and stores one file', async () => {
    const p = await login('staff', { team: 'procurement' });
    const { id, path } = await overdueOrder(p);
    const send = () => request(app).put(path).set(as(p)).field('code', 'courier_delay').field('requestId', 'abc12345-retry')
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    const [r1, r2] = await Promise.all([send(), send()]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const r3 = await send();
    expect(r3.status).toBe(200);
    const saved = await parcelOf(id);
    expect(saved.overdueReasonHistory).toHaveLength(1);
    // A racing copy that stored its file before losing is cleaned up.
    expect(stored.size - deleted.length).toBe(1);
    expect(saved.overdueReasonHistory[0].requestId).toBe('abc12345-retry');
  });

  it('a malformed requestId is refused', async () => {
    const p = await login('staff', { team: 'procurement' });
    const { path } = await overdueOrder(p);
    const res = await request(app).put(path).set(as(p)).send({ code: 'courier_delay', requestId: 'x y' });
    expect(res.status).toBe(400);
  });
});

describe('who may', () => {
  it('sales and accounts cannot save (403, nothing stored); a customer and no-login cannot either', async () => {
    const p = await login('staff', { team: 'procurement' });
    const { id, path } = await overdueOrder(p);
    for (const t of [await login('staff', { team: 'sales' }), await login('staff', { team: 'accounts' })]) {
      const res = await request(app).put(path).set(as(t)).field('code', 'courier_delay')
        .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
      expect(res.status).toBe(403);
    }
    const customer = await login('customer');
    expect((await request(app).put(path).set(as(customer)).send({ code: 'courier_delay' })).status).toBeGreaterThanOrEqual(400);
    expect((await request(app).put(path).send({ code: 'courier_delay' })).status).toBeGreaterThanOrEqual(400);
    expect(stored.size).toBe(0);
    expect((await parcelOf(id)).overdueReasonHistory || []).toHaveLength(0);
  });

  it('the file link: only names recorded on this parcel resolve; a customer gets no file', async () => {
    const p = await login('staff', { team: 'procurement' });
    const { path } = await overdueOrder(p);
    const other = await overdueOrder(p);
    const res = await request(app).put(path).set(as(p)).field('code', 'courier_delay')
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' }).expect(200);
    const { url } = res.body.order.parcels[0].overdueReason.attachment;
    const name = url.split('/').pop();

    // Same name on another order's parcel: not found there.
    await fileGet(`${BASE}/staff/work/orders/${other.id}/parcels/${other.sid}/overdue-files/${name}`).set(as(p)).expect(404);
    // A well-formed name that was never stored.
    await fileGet(url.replace(/-[a-f0-9]{12}\.png$/, '-000000000000.png')).set(as(p)).expect(404);
    // Anything that is not one of our names (path tricks) is refused by the validator.
    expect((await fileGet(url.replace(name, '..%2F..%2Fsecret.png')).set(as(p))).status).toBeGreaterThanOrEqual(400);

    const customer = await login('customer');
    const cust = await fileGet(url).set(as(customer));
    expect(cust.status).toBeGreaterThanOrEqual(400);
    expect(cust.headers['content-type'] || '').not.toMatch(/^image\//);
    expect((await fileGet(url)).status).toBeGreaterThanOrEqual(400);
  });
});
