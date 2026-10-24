/**
 * Payment details a GTM lead shares with a customer (services/salesPayDetailsService.js):
 * bank transfer, GPay / UPI QR, or another way — printed on the payment request PDF.
 *
 * What must hold:
 *   - only the seller / GTM head, only on an unpaid order with no transfer waiting
 *   - a QR payment needs a QR image; bank details are checked; "other" needs words
 *   - the QR is private, replaced cleanly, and served only to who may see the order
 *   - every save is posted in full to #accounts; nothing is ever marked paid here
 *   - above ₹50,000 a QR carries "please pay by bank transfer"
 *   - the PDF works with details alone, and refuses when there is nothing to pay with
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

const pd = await import('../services/salesPayDetailsService.js');
const { getPaymentRequestPdf } = await import('../services/salesPaymentService.js');
const { payDetailsLines, QR_LIMIT_NOTE } = await import('../utils/salesPayDetails.js');
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(200, 1)]);
const qrFile = (buffer = PNG) => ({ buffer, originalname: 'gpay.png', mimetype: 'image/png' });
const BANK = { accountName: 'Autobacs India Pvt Ltd', accountNumber: '50200012345678', ifsc: 'HDFC0001234', bankName: 'HDFC Bank' };

let admin, head, lead, lead2;
beforeAll(async () => { await BankTransfer.init(); });
beforeEach(async () => {
  stored.clear();
  admin = await person('admin', null, 'Owner');
  head = await person('staff', { team: 'sales', isHead: true }, 'Hari');
  lead = await person('staff', { team: 'sales' }, 'Sam');
  lead2 = await person('staff', { team: 'sales' }, 'Tara');
});

describe('saving the details', () => {
  it('bank transfer: saved on the order, shown to the seller, posted in full to #accounts', async () => {
    const order = await salesOrder(lead, { parts: null });
    const o = await pd.setPayDetails(lead, order._id, { method: 'bank', bank: JSON.stringify(BANK), note: 'Mention the order number' }, null, req);
    expect(o.payDetails).toMatchObject({ method: 'bank', bank: { accountNumber: '50200012345678', ifsc: 'HDFC0001234' }, setBy: 'Sam' });
    const [msg] = await ChatMessage.find({ kind: 'system', text: /payment details/ }).lean();
    expect(msg.text).toContain('50200012345678');
    expect(msg.text).toContain('check it is ours');
    expect((await Order.findById(order._id).lean()).paymentStatus).toBe('pending'); // nothing marked paid
  });

  it('checks the details: IFSC, a QR for a QR payment, words for "other"', async () => {
    const order = await salesOrder(lead, { parts: null });
    await expect(pd.setPayDetails(lead, order._id, { method: 'bank', bank: { ...BANK, ifsc: 'BAD' } }, null, req)).rejects.toMatchObject({ statusCode: 400 });
    await expect(pd.setPayDetails(lead, order._id, { method: 'upi_qr' }, null, req)).rejects.toMatchObject({ statusCode: 400 });
    await expect(pd.setPayDetails(lead, order._id, { method: 'upi_qr' }, qrFile(Buffer.from('not an image at all')), req)).rejects.toMatchObject({ statusCode: 400 });
    await expect(pd.setPayDetails(lead, order._id, { method: 'other', note: '' }, null, req)).rejects.toMatchObject({ statusCode: 400 });
    await expect(pd.setPayDetails(lead, order._id, { method: 'cash' }, null, req)).rejects.toMatchObject({ statusCode: 400 });
    expect(stored.size).toBe(0);
  });

  it('GPay QR: stored privately, kept on a later save, removed when switching to bank', async () => {
    const order = await salesOrder(lead, { parts: null });
    const o = await pd.setPayDetails(lead, order._id, { method: 'upi_qr', upiId: 'autobacs@okhdfcbank' }, qrFile(), req);
    expect(o.payDetails).toMatchObject({ method: 'upi_qr', hasQr: true, upiId: 'autobacs@okhdfcbank' });
    expect([...stored.keys()][0]).toMatch(new RegExp(`^sales-pay-details/${order._id}/qr-`));
    const again = await pd.setPayDetails(lead, order._id, { method: 'upi_qr', note: 'GPay only' }, null, req);
    expect(again.payDetails.hasQr).toBe(true);
    const img = await pd.readPayDetailsQr(lead, order._id);
    expect(Buffer.compare(img.buffer, PNG)).toBe(0);
    await pd.setPayDetails(lead, order._id, { method: 'bank', bank: BANK }, null, req);
    expect(stored.size).toBe(0);
  });

  it('who and when: seller and GTM head, unpaid only, not while a transfer waits', async () => {
    const order = await salesOrder(lead, { parts: null });
    await expect(pd.setPayDetails(lead2, order._id, { method: 'bank', bank: BANK }, null, req)).rejects.toMatchObject({ statusCode: 403 });
    await expect(pd.setPayDetails(head, order._id, { method: 'bank', bank: BANK }, null, req)).resolves.toBeTruthy();
    await expect(pd.readPayDetailsQr(lead2, order._id)).rejects.toMatchObject({ statusCode: 404 });
    await Order.updateOne({ _id: order._id }, { $set: { bankTransferPendingAt: new Date() } });
    await expect(pd.setPayDetails(lead, order._id, { method: 'bank', bank: BANK }, null, req)).rejects.toMatchObject({ statusCode: 409 });
    await Order.updateOne({ _id: order._id }, { $set: { paymentStatus: 'paid', status: 'processing' }, $unset: { bankTransferPendingAt: '' } });
    await expect(pd.setPayDetails(lead, order._id, { method: 'bank', bank: BANK }, null, req)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('what the customer gets', () => {
  it('above ₹50,000 a QR says to pay by bank transfer; below it does not', () => {
    const qr = { method: 'upi_qr', upiId: 'a@okhdfcbank', bank: BANK, note: '' };
    expect(payDetailsLines(qr, 52000)).toContain(QR_LIMIT_NOTE);
    expect(payDetailsLines(qr, 52000).join('\n')).toContain('50200012345678');
    expect(payDetailsLines(qr, 40000)).not.toContain(QR_LIMIT_NOTE);
  });

  it('the payment request PDF works with details alone, and refuses with nothing to pay with', async () => {
    const order = await salesOrder(lead, { parts: null });
    await expect(getPaymentRequestPdf(lead, order._id)).rejects.toMatchObject({ statusCode: 409 });
    await pd.setPayDetails(lead, order._id, { method: 'upi_qr', bank: BANK }, qrFile(), req);
    const { buffer } = await getPaymentRequestPdf(lead, order._id);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });
});
