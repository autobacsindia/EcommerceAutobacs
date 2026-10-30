/**
 * Bank-transfer payments for sales orders (services/bankTransferService.js).
 * Razorpay, private storage and the queue are doubles; Mongo (with transactions),
 * the order status machine and chat are real.
 *
 * What must hold:
 *   - recording changes nothing about the money: the order stays unpaid until
 *     accounts or the admin confirms; GTM can never confirm
 *   - recording first cancels every live payment link; if Razorpay refuses (the
 *     customer may have just paid), nothing is recorded, nothing is stored
 *   - full amount only; a part already paid by link blocks it
 *   - one waiting transfer per order; one UTR per order (pending or confirmed)
 *   - while one waits: no new link, no cancelling the order
 *   - confirm is once-only (double click, two people at once): one paid
 *     transition, one run of the post-payment routine
 *   - confirm refuses an order that got paid or changed meanwhile
 *   - reject needs a reason, frees the order (and the UTR) again
 *   - who sees what: accounts, admin and the GTM head see all; a lead sees their own
 *   - screenshots are checked by their bytes and stored privately
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

jest.setTimeout(120000);

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));

const rz = { cancelled: [], failCancel: false, afterPaid: [], created: [] };
jest.unstable_mockModule('../services/razorpayService.js', () => ({
  default: {
    createPaymentLink: async () => {
      const id = `plink_new_${rz.created.length + 1}`;
      rz.created.push(id);
      return { id, shortUrl: `https://rzp.io/i/${id}` };
    },
    cancelPaymentLink: async (id) => {
      if (rz.failCancel) throw new Error('Failed to cancel payment link: paid');
      rz.cancelled.push(id);
      return { id, status: 'cancelled' };
    },
    fetchPaymentLinkStatus: async () => ({ status: 'paid' }),
    _afterOrderPaid: (orderId) => { rz.afterPaid.push(String(orderId)); },
  },
}));

const stored = new Map();
const storageMock = {
  resourceTypeFor: (t) => (String(t).startsWith('image/') ? 'image' : 'raw'),
  putPrivateAsset: async ({ buffer, folder, basename }) => {
    const publicId = `${folder}/${basename}`;
    stored.set(publicId, buffer);
    return { publicId, provider: 'r2', bytes: buffer.length, url: '' };
  },
  deletePrivateAsset: async ({ publicId }) => { stored.delete(publicId); return true; },
  readPrivateAsset: async (ref) => stored.get(ref.publicId),
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));

const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: BankTransfer } = await import('../models/BankTransfer.js');
const { default: ChatMessage } = await import('../models/ChatMessage.js');
const bt = await import('../services/bankTransferService.js');
const sales = await import('../services/salesOrderService.js');
const payments = await import('../services/salesPaymentService.js');
const { summaryFor } = await import('../services/notificationService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(300, 1)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32)]);
const shot = (buffer = JPEG, name = 'transfer.jpg', mimetype = 'image/jpeg') => ({ buffer, originalname: name, mimetype });

let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({ name: name || `${role} ${n}`, email: `p${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role, ...(staff && { staff: { active: true, isHead: false, ...staff } }) });
};
const DAY = 24 * 60 * 60 * 1000;
const isoDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

async function salesOrder(seller, { total = 52000, parts = [{ amount: 52000 }], legacyLink = false } = {}) {
  return Order.create({
    user: new mongoose.Types.ObjectId(), source: 'offline', salesUser: seller._id,
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Lift kit', price: total, quantity: 1 }],
    shippingAddress: { fullName: 'Ravi Kumar', phone: '9812345678', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: total, totalAmount: total, status: 'awaiting_payment', paymentStatus: 'pending',
    ...(parts && !legacyLink && {
      paymentParts: parts.map((p, i) => ({
        amount: p.amount, linkId: `plink_${n}_${i}`, linkUrl: `https://rzp.io/i/${i}`,
        expiresAt: new Date(Date.now() + (p.expired ? -DAY : DAY)), status: p.status || 'pending',
      })),
    }),
    ...(legacyLink && { paymentLinkId: `plink_legacy_${n}`, paymentLinkUrl: 'https://rzp.io/i/legacy', paymentLinkExpiresAt: new Date(Date.now() + DAY) }),
  });
}

const input = (over = {}) => ({ amount: 52000, reference: 'HDFCR52024102112345', paidOn: isoDay(0), note: 'NEFT from Ravi', ...over });

let admin, accounts, head, lead, lead2, ops;
beforeAll(async () => { await BankTransfer.init(); });
beforeEach(async () => {
  rz.cancelled.length = 0; rz.afterPaid.length = 0; rz.created.length = 0; rz.failCancel = false;
  stored.clear();
  admin = await person('admin', null, 'Owner');
  accounts = await person('staff', { team: 'accounts' }, 'Anu');
  head = await person('staff', { team: 'sales', isHead: true }, 'Hari');
  lead = await person('staff', { team: 'sales' }, 'Sam');
  lead2 = await person('staff', { team: 'sales' }, 'Tara');
  ops = await person('staff', { team: 'operations' }, 'Omar');
});

describe('recording', () => {
  it('waits for accounts: order still unpaid, links cancelled, screenshots kept privately, accounts and GTM told', async () => {
    const order = await salesOrder(lead, { parts: [{ amount: 30000 }, { amount: 22000 }] });
    const t = await bt.recordBankTransfer(lead, order._id, input(), [shot(), shot(PDF, 'statement.pdf', 'application/pdf')], req);

    expect(t).toMatchObject({ status: 'pending', amount: 52000, reference: 'HDFCR52024102112345', salesPerson: 'Sam', can: { confirm: false, reject: false } });
    expect(t.files.map((f) => f.contentType)).toEqual(['image/jpeg', 'application/pdf']);
    expect([...stored.keys()].every((k) => k.startsWith('bank-transfers/'))).toBe(true);

    const fresh = await Order.findById(order._id).lean();
    expect(fresh).toMatchObject({ status: 'awaiting_payment', paymentStatus: 'pending' });
    expect(fresh.bankTransferPendingAt).toBeInstanceOf(Date);
    expect(fresh.paymentParts.map((p) => p.status)).toEqual(['cancelled', 'cancelled']);
    expect(rz.cancelled.sort()).toEqual(order.paymentParts.map((p) => p.linkId).sort());
    expect(rz.afterPaid).toEqual([]);

    const posts = await ChatMessage.find({ kind: 'system', text: /bank transfer/ }).lean();
    expect(posts).toHaveLength(2); // #accounts and #GTM
    expect(posts[0].text).toMatch(/Accounts: please check the bank/);
  });

  it('cancels the old single payment link too', async () => {
    const order = await salesOrder(lead, { legacyLink: true });
    await bt.recordBankTransfer(lead, order._id, input(), [shot()], req);
    expect(rz.cancelled).toEqual([order.paymentLinkId]);
    expect((await Order.findById(order._id).lean()).paymentLinkExpiresAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('takes up to 20 screenshots at once, photos and PDFs mixed; the stored type comes from the bytes', async () => {
    const order = await salesOrder(lead);
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(100, 1)]);
    const files = Array.from({ length: 20 }, (_, i) => (i % 2 ? shot(PDF, `s${i}.pdf`, 'application/pdf') : shot(PNG, `s${i}.jpg`, 'image/jpeg')));
    const t = await bt.recordBankTransfer(lead, order._id, input(), files, req);
    expect(t.files).toHaveLength(20);
    expect(stored.size).toBe(20);
    expect(t.files[0]).toMatchObject({ contentType: 'image/png', name: 's0.jpg' }); // labelled JPEG, bytes say PNG
    expect(t.files[1]).toMatchObject({ contentType: 'application/pdf', name: 's1.pdf' });
  });

  it('if Razorpay will not cancel a link (customer may have just paid), records nothing', async () => {
    const order = await salesOrder(lead);
    rz.failCancel = true;
    await expect(bt.recordBankTransfer(lead, order._id, input(), [shot()], req)).rejects.toMatchObject({ statusCode: 409 });
    const fresh = await Order.findById(order._id).lean();
    expect(fresh.bankTransferPendingAt).toBeUndefined();
    expect(fresh.paymentParts[0].status).toBe('pending');
    expect(await BankTransfer.countDocuments()).toBe(0);
    expect(stored.size).toBe(0);
  });

  it('checks every input before touching anything', async () => {
    const order = await salesOrder(lead);
    const bad = [
      [input({ amount: 30000 }), [shot()], /full order amount: ₹52,000/],
      [input({ amount: 'abc' }), [shot()], /full order amount/],
      [input({ reference: '12' }), [shot()], /UTR/],
      [input({ reference: 'abc$%^def' }), [shot()], /UTR/],
      [input({ paidOn: isoDay(3) }), [shot()], /future/],
      [input({ paidOn: isoDay(-100) }), [shot()], /90 days/],
      [input({ paidOn: '2026-02-30' }), [shot()], /date/],
      [input(), [], /screenshot/],
      [input(), [shot(Buffer.from('not an image at all'))], /photo/],
      [input(), Array.from({ length: 21 }, () => shot()), /up to 20 screenshots/],
      [input(), [shot(Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10 * 1024 * 1024)]), 'big.pdf', 'application/pdf')], /too large \(10 MB/],
      [input(), Array.from({ length: 5 }, () => shot(Buffer.concat([JPEG, Buffer.alloc(9 * 1024 * 1024)]))), /add up to more than 40 MB/],
      [input(), [shot(Buffer.from('<html><script>alert(1)</script>'), 'slip.pdf', 'application/pdf')], /not a photo .* or a PDF/],
    ];
    for (const [i, files, message] of bad) {
      await expect(bt.recordBankTransfer(lead, order._id, i, files, req)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(message) });
    }
    expect((await Order.findById(order._id).lean()).bankTransferPendingAt).toBeUndefined();
    expect(rz.cancelled).toEqual([]);
    expect(stored.size).toBe(0);
  });

  it('who: the seller, the GTM head, the admin — not another lead, not other teams', async () => {
    const order = await salesOrder(lead);
    await expect(bt.recordBankTransfer(lead2, order._id, input(), [shot()], req)).rejects.toMatchObject({ statusCode: 403 });
    await expect(bt.recordBankTransfer(ops, order._id, input(), [shot()], req)).rejects.toMatchObject({ statusCode: 403 });
    await expect(bt.recordBankTransfer(accounts, order._id, input(), [shot()], req)).rejects.toMatchObject({ statusCode: 403 });
    expect((await bt.recordBankTransfer(head, order._id, input(), [shot()], req)).status).toBe('pending');
    const o2 = await salesOrder(lead);
    expect((await bt.recordBankTransfer(admin, o2._id, input({ reference: 'UTR2222222222' }), [shot()], req)).status).toBe('pending');
  });

  it('refuses a paid, cancelled, website or part-paid order', async () => {
    const paidPart = await salesOrder(lead, { parts: [{ amount: 20000, status: 'paid' }, { amount: 32000 }] });
    await expect(bt.recordBankTransfer(lead, paidPart._id, input(), [shot()], req)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/already paid by link/) });
    const closed = await salesOrder(lead);
    await Order.updateOne({ _id: closed._id }, { status: 'cancelled' });
    await expect(bt.recordBankTransfer(lead, closed._id, input(), [shot()], req)).rejects.toMatchObject({ statusCode: 409 });
    const web = await salesOrder(lead);
    await Order.updateOne({ _id: web._id }, { $set: { salesUser: null } });
    await expect(bt.recordBankTransfer(admin, web._id, input(), [shot()], req)).rejects.toMatchObject({ statusCode: 404 });
    expect(await BankTransfer.countDocuments()).toBe(0);
  });

  it('one waiting transfer per order, and one UTR per order — even when two arrive at once', async () => {
    const order = await salesOrder(lead);
    await bt.recordBankTransfer(lead, order._id, input(), [shot()], req);
    await expect(bt.recordBankTransfer(lead, order._id, input({ reference: 'OTHER1234567' }), [shot()], req)).rejects.toMatchObject({ statusCode: 409 });

    // Same UTR, different spacing/case, on another order → refused.
    const other = await salesOrder(lead);
    await expect(bt.recordBankTransfer(lead, other._id, input({ reference: 'hdfcr5-2024 1021 12345' }), [shot()], req))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/already recorded on order/) });
    expect((await Order.findById(other._id).lean()).bankTransferPendingAt).toBeUndefined();

    // Two orders, one new UTR, at the same moment: exactly one is recorded.
    const a = await salesOrder(lead);
    const b = await salesOrder(lead2);
    const results = await Promise.allSettled([
      bt.recordBankTransfer(lead, a._id, input({ reference: 'RACE99887766' }), [shot()], req),
      bt.recordBankTransfer(lead2, b._id, input({ reference: 'RACE99887766' }), [shot()], req),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await BankTransfer.countDocuments({ referenceKey: 'RACE99887766' })).toBe(1);
    const losing = results[0].status === 'rejected' ? a : b;
    expect((await Order.findById(losing._id).lean()).bankTransferPendingAt).toBeUndefined();
  });

  it('while it waits: no new payment link, no cancelling the order', async () => {
    const order = await salesOrder(lead, { parts: null });
    await bt.recordBankTransfer(lead, order._id, input(), [shot()], req);
    await expect(payments.requestPayment(lead, order._id, [52000], req)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/bank transfer is waiting/) });
    await expect(sales.cancelUnpaidSalesOrder(lead, order._id, req)).rejects.toMatchObject({ statusCode: 409 });
    await expect(sales.reissuePaymentLink(lead, order._id, req)).rejects.toMatchObject({ statusCode: 409 });
    expect(rz.created).toEqual([]);
    expect((await sales.getSalesOrder(lead, order._id)).bankTransferPending).toBe(true);
  });
});

describe('confirming', () => {
  const recorded = async (seller = lead, ref = 'HDFCR52024102112345') => {
    const order = await salesOrder(seller);
    const t = await bt.recordBankTransfer(seller, order._id, input({ reference: ref }), [shot()], req);
    return { order, t };
  };

  it('accounts confirms → the order is paid, enters the workflow, and the post-payment routine runs once', async () => {
    const { order, t } = await recorded();
    expect((await bt.getBankTransfer(accounts, t.id)).can).toEqual({ confirm: true, reject: true, edit: false, withdraw: false });
    const done = await bt.confirmBankTransfer(accounts, t.id, req);
    expect(done).toMatchObject({ status: 'confirmed', reviewedBy: 'Anu', can: { confirm: false, reject: false } });

    const fresh = await Order.findById(order._id).lean();
    expect(fresh).toMatchObject({ status: 'processing', paymentStatus: 'paid' });
    expect(fresh.workflow.enteredAt).toBeInstanceOf(Date);
    expect(fresh.bankTransferPendingAt).toBeUndefined();
    expect(fresh.offlinePayment).toMatchObject({ method: 'bank_transfer', reference: 'HDFCR52024102112345', amount: 52000, confirmedByName: 'Anu' });
    expect(fresh.statusHistory.at(-1)).toMatchObject({ status: 'processing', reason: 'manual_confirmation' });
    expect(rz.afterPaid).toEqual([String(order._id)]);
    expect(await ChatMessage.countDocuments({ text: /confirmed by Anu/ })).toBe(2);
    expect((await sales.getSalesOrder(lead, order._id)).offlinePayment).toEqual({ method: 'bank_transfer', reference: 'HDFCR52024102112345', confirmedBy: 'Anu' });
  });

  it('a double click, or accounts and the admin at once: paid once, routine once', async () => {
    const { order, t } = await recorded();
    await Promise.all([
      bt.confirmBankTransfer(accounts, t.id, req),
      bt.confirmBankTransfer(admin, t.id, req),
      bt.confirmBankTransfer(accounts, t.id, req),
    ]);
    await bt.confirmBankTransfer(accounts, t.id, req);
    expect(rz.afterPaid).toEqual([String(order._id)]);
    const fresh = await Order.findById(order._id).lean();
    expect(fresh.statusHistory.filter((h) => h.status === 'processing')).toHaveLength(1);
    expect((await BankTransfer.findById(t.id).lean()).history.map((h) => h.action)).toEqual(['recorded', 'confirmed']);
  });

  it('GTM — head or seller — and other teams cannot confirm or reject', async () => {
    const { t } = await recorded();
    for (const u of [lead, head, ops]) {
      await expect(bt.confirmBankTransfer(u, t.id, req)).rejects.toMatchObject({ statusCode: 403 });
      await expect(bt.rejectBankTransfer(u, t.id, { note: 'nope' }, req)).rejects.toMatchObject({ statusCode: 403 });
    }
    expect((await BankTransfer.findById(t.id).lean()).status).toBe('pending');
  });

  it('refuses if the order got paid or its total changed meanwhile — and changes nothing', async () => {
    const { order, t } = await recorded();
    await Order.updateOne({ _id: order._id }, { $set: { paymentStatus: 'paid', status: 'processing' } });
    await expect(bt.confirmBankTransfer(accounts, t.id, req)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/go back to the customer/) });
    expect((await BankTransfer.findById(t.id).lean()).status).toBe('pending');

    const second = await recorded(lead2, 'UTR5555566666');
    await Order.updateOne({ _id: second.order._id }, { $set: { totalAmount: 60000 } });
    await expect(bt.confirmBankTransfer(accounts, second.t.id, req)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/total changed/) });
    expect((await Order.findById(second.order._id).lean()).paymentStatus).toBe('pending');
    expect(rz.afterPaid).toEqual([]);
  });

  it('reject: needs a reason, frees the order and the UTR, tells GTM; it cannot then be confirmed', async () => {
    const { order, t } = await recorded();
    await expect(bt.rejectBankTransfer(accounts, t.id, { note: '' }, req)).rejects.toMatchObject({ statusCode: 400 });
    const r = await bt.rejectBankTransfer(accounts, t.id, { note: 'Not in the HDFC statement' }, req);
    expect(r).toMatchObject({ status: 'rejected', reviewNote: 'Not in the HDFC statement' });
    expect(await bt.rejectBankTransfer(accounts, t.id, { note: 'again' }, req)).toMatchObject({ reviewNote: 'Not in the HDFC statement' });
    await expect(bt.confirmBankTransfer(accounts, t.id, req)).rejects.toMatchObject({ statusCode: 409 });

    const fresh = await Order.findById(order._id).lean();
    expect(fresh).toMatchObject({ status: 'awaiting_payment', paymentStatus: 'pending' });
    expect(fresh.bankTransferPendingAt).toBeUndefined();
    expect(await ChatMessage.countDocuments({ text: /rejected by Anu: Not in the HDFC statement/ })).toBe(2);

    // GTM can ask for payment by link again: the old links were cancelled, so the full amount is open.
    const summary = await payments.requestPayment(lead, order._id, [52000], req);
    expect(summary).toMatchObject({ amountRequested: 52000, amountPaid: 0 });
    expect(rz.created).toHaveLength(1);
  });

  it('after a rejection the same UTR can be recorded again, and confirmed', async () => {
    const { order, t } = await recorded();
    await bt.rejectBankTransfer(accounts, t.id, { note: 'Wrong amount on screenshot' }, req);
    const again = await bt.recordBankTransfer(lead, order._id, input(), [shot()], req);
    expect(again.status).toBe('pending');
    await bt.confirmBankTransfer(admin, again.id, req);
    expect((await Order.findById(order._id).lean()).paymentStatus).toBe('paid');
    await expect(bt.rejectBankTransfer(accounts, again.id, { note: 'too late' }, req)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('seeing them', () => {
  it('accounts, admin and the GTM head see all; a lead sees their own; other teams nothing', async () => {
    const o1 = await salesOrder(lead);
    const o2 = await salesOrder(lead2);
    const t1 = await bt.recordBankTransfer(lead, o1._id, input({ reference: 'UTRAAAA11111' }), [shot()], req);
    await bt.recordBankTransfer(lead2, o2._id, input({ reference: 'UTRBBBB22222' }), [shot()], req);
    for (const u of [accounts, admin, head]) expect((await bt.listBankTransfers(u)).transfers).toHaveLength(2);
    expect((await bt.listBankTransfers(lead)).transfers.map((t) => t.id)).toEqual([t1.id]);
    await expect(bt.listBankTransfers(ops)).rejects.toMatchObject({ statusCode: 403 });
    await expect(bt.getBankTransfer(lead2, t1.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(bt.getTransferFile(lead2, t1.id, t1.files[0].id)).rejects.toMatchObject({ statusCode: 404 });
    const file = await bt.getTransferFile(head, t1.id, t1.files[0].id);
    expect(Buffer.compare(file.buffer, JPEG)).toBe(0);

    await bt.confirmBankTransfer(accounts, t1.id, req);
    expect((await bt.listBankTransfers(accounts, { status: 'pending' })).transfers).toHaveLength(1);
    expect((await bt.listBankTransfers(accounts, { status: 'confirmed' })).transfers.map((t) => t.id)).toEqual([t1.id]);
    expect((await bt.listBankTransfers(accounts, { status: 'all' })).transfers).toHaveLength(2);
  });

  it('pages with a cursor, newest first', async () => {
    for (let i = 0; i < 27; i += 1) {
      const o = await salesOrder(lead);
      await bt.recordBankTransfer(lead, o._id, input({ reference: `UTRPAGE${String(i).padStart(6, '0')}` }), [shot()], req);
    }
    const p1 = await bt.listBankTransfers(accounts);
    expect(p1.transfers).toHaveLength(25);
    const p2 = await bt.listBankTransfers(accounts, { cursor: p1.nextCursor });
    expect(p2.transfers).toHaveLength(2);
    expect(p2.nextCursor).toBeNull();
    expect(new Set([...p1.transfers, ...p2.transfers].map((t) => t.id)).size).toBe(27);
  });

  it('the bell: accounts and the admin are told what to check; GTM is not', async () => {
    const o = await salesOrder(lead);
    const t = await bt.recordBankTransfer(lead, o._id, input(), [shot()], req);
    const item = async (u) => (await summaryFor(u)).items.find((i) => i.key === 'bank_transfers_to_verify');
    expect(await item(accounts)).toMatchObject({ count: 1, href: '/team/bank-transfers' });
    expect(await item(admin)).toMatchObject({ count: 1, href: '/admin/bank-transfers' });
    expect(await item(lead)).toBeUndefined();
    expect(await item(head)).toBeUndefined();
    await bt.confirmBankTransfer(accounts, t.id, req);
    expect((await item(accounts)).count).toBe(0);
  });
});

describe('correcting a recorded transfer', () => {
  it('the person who recorded it fixes the UTR / date / note; history says what changed', async () => {
    const order = await salesOrder(lead);
    const t = await bt.recordBankTransfer(lead, order._id, input(), [shot()], req);
    expect(t.can.edit).toBe(true);
    expect(t.editableUntil).toBeNull(); // no time limit
    const fixed = await bt.editBankTransfer(lead, t.id, { reference: 'HDFCR52024102199999', note: 'NEFT, corrected' }, req);
    expect(fixed).toMatchObject({ reference: 'HDFCR52024102199999', note: 'NEFT, corrected', status: 'pending' });
    const doc = await BankTransfer.findById(t.id).lean();
    expect(doc.history.at(-1)).toMatchObject({ action: 'edited', note: expect.stringContaining('HDFCR52024102199999') });
    await expect(bt.editBankTransfer(lead2, t.id, { note: 'x' }, req)).rejects.toMatchObject({ statusCode: expect.any(Number) });
  });

  it('no time limit: still editable days later — by the recorder, the GTM head or the admin; closed once accounts has checked it', async () => {
    const order = await salesOrder(lead);
    const t = await bt.recordBankTransfer(lead, order._id, input(), [shot()], req);
    await BankTransfer.collection.updateOne({ _id: new mongoose.Types.ObjectId(t.id) }, { $set: { createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000) } });
    await expect(bt.editBankTransfer(lead, t.id, { note: 'days later' }, req)).resolves.toMatchObject({ note: 'days later' });
    await expect(bt.editBankTransfer(head, t.id, { note: 'head fix' }, req)).resolves.toMatchObject({ note: 'head fix' });
    await expect(bt.editBankTransfer(admin, t.id, { note: 'admin fix' }, req)).resolves.toMatchObject({ note: 'admin fix' });
    await expect(bt.editBankTransfer(ops, t.id, { note: 'other team' }, req)).rejects.toMatchObject({ statusCode: expect.any(Number) });
    await bt.confirmBankTransfer(accounts, t.id, req);
    await expect(bt.editBankTransfer(admin, t.id, { note: 'after' }, req)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('a UTR already used on another order is refused', async () => {
    const a = await bt.recordBankTransfer(lead, (await salesOrder(lead))._id, input(), [shot()], req);
    const b = await bt.recordBankTransfer(lead, (await salesOrder(lead))._id, input({ reference: 'HDFCR52024102100000' }), [shot()], req);
    await expect(bt.editBankTransfer(lead, b.id, { reference: a.reference }, req)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('withdrawing a transfer recorded by mistake', () => {
  it('the recorder withdraws it: order unpaid again, UTR free, accounts told; not after accounts checked', async () => {
    const order = await salesOrder(lead);
    const t = await bt.recordBankTransfer(lead, order._id, input(), [shot()], req);
    expect(t.can.withdraw).toBe(true);
    await expect(bt.withdrawBankTransfer(lead2, t.id, {}, req)).rejects.toMatchObject({ statusCode: expect.any(Number) });
    const w = await bt.withdrawBankTransfer(lead, t.id, { note: 'Wrong order' }, req);
    expect(w).toMatchObject({ status: 'withdrawn', statusLabel: 'Withdrawn by GTM' });
    expect((await Order.findById(order._id).lean()).bankTransferPendingAt).toBeFalsy();
    // The UTR can be used again (on the right order).
    const again = await bt.recordBankTransfer(lead, (await salesOrder(lead))._id, input(), [shot()], req);
    expect(again.status).toBe('pending');
    await bt.confirmBankTransfer(accounts, again.id, req);
    await expect(bt.withdrawBankTransfer(lead, again.id, {}, req)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('no time limit for the recorder: withdrawn days later, while still pending', async () => {
    const order = await salesOrder(lead);
    const t = await bt.recordBankTransfer(lead, order._id, input(), [shot()], req);
    await BankTransfer.collection.updateOne({ _id: new mongoose.Types.ObjectId(t.id) }, { $set: { createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000) } });
    await expect(bt.withdrawBankTransfer(lead, t.id, {}, req)).resolves.toMatchObject({ status: 'withdrawn' });
  });
});
