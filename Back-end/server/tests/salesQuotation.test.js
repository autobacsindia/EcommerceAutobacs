/**
 * Sales quotation PDF (services/quotationService.js).
 *
 * What must hold:
 *   - the quotation shows exactly the order the server priced: same lines, same
 *     offer prices, same total the payment link charges — never a second pricing path
 *   - discount = list − offer, summed; the total in words matches the figure
 *   - valid 7 days from the order; the payment QR appears only while the link is live
 *   - the seller gets their own, a sales head and an admin get any, everyone else
 *     (another seller, other teams) is refused; a cancelled order has no quotation
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

// Plain functions (not jest.fn): the suite's resetMocks would wipe implementations.
const enqueued = [];
const mockQueue = { add: (name, data) => { enqueued.push({ name, data }); return Promise.resolve({}); } };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue,
  getOrderQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue,
  enqueueNotification: () => {},
  closeQueues: () => Promise.resolve(),
}));

// Razorpay double: records links made / cancelled; behaviour switchable per test.
const rz = { created: [], cancelled: [], failCancel: false, remoteStatus: 'created', seq: 0 };
jest.unstable_mockModule('../services/razorpayService.js', () => ({
  default: {
    createPaymentLink: async (order, customer, opts = {}) => {
      rz.seq += 1;
      const link = { id: `plink_${rz.seq}`, shortUrl: `https://rzp.io/i/l${rz.seq}` };
      rz.created.push({ order, customer, opts, link });
      return link;
    },
    cancelPaymentLink: async (id) => {
      if (rz.failCancel) throw new Error('Failed to cancel payment link: paid');
      rz.cancelled.push(id);
      return { id, status: 'cancelled' };
    },
    fetchPaymentLinkStatus: async () => ({ status: rz.remoteStatus }),
  },
}));

const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: Product } = await import('../models/Product.js');
const svc = await import('../services/salesOrderService.js');
const { getQuotationPdf, buildQuotation, quotationNumber } = await import('../services/quotationService.js');
const { rupeesInWords } = await import('../utils/amountInWords.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };

let n = 0;
async function makeStaff(team, { isHead = false, active = true, name } = {}) {
  n += 1;
  return User.create({
    name: name || `${team} person ${n}`,
    email: `${team}${n}@autobacs.test`,
    phone: '9000000001',
    passwordHash: 'x',
    role: 'staff',
    staff: { team, isHead, active },
  });
}

async function makeProduct(overrides = {}) {
  n += 1;
  return Product.create({
    name: `Seat Cover ${n}`, slug: `seat-cover-${n}`, sku: `SKU-${n}`,
    description: 'x'.repeat(30), price: 5000, stock: 'in', isActive: true,
    ...overrides,
  });
}

const CUSTOMER = { name: 'Call In Customer', email: 'caller@example.com', phone: '9812345678' };
const ADDRESS = { addressLine1: '12 MG Road', city: 'Pune', state: 'Maharashtra', postalCode: '411001' };

const orderInput = (product, extra = {}) => ({
  customer: CUSTOMER,
  shippingAddress: ADDRESS,
  items: [{ product: String(product._id), quantity: 2, ...extra }],
});

beforeEach(() => {
  enqueued.length = 0;
  rz.created.length = 0;
  rz.cancelled.length = 0;
  rz.failCancel = false;
  rz.remoteStatus = 'created';
  rz.seq = 0;
});

const ORIGINAL_REDIS_URL = process.env.REDIS_URL;
process.env.REDIS_URL = 'redis://localhost:6379';
afterAll(() => {
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL;
});


const isPdf = (buf) => buf.subarray(0, 5).toString() === '%PDF-';

describe('what the quotation says', () => {
  it('mirrors the server-priced order: offer lines, discount, total and words', async () => {
    const rep = await makeStaff('sales', { name: 'Asha' });
    const a = await makeProduct({ price: 5000 });
    const b = await makeProduct({ price: 1200 });
    const { order } = await svc.createSalesOrder(rep, {
      customer: CUSTOMER, shippingAddress: ADDRESS,
      items: [{ product: String(a._id), quantity: 2, offerPrice: 4500 }, { product: String(b._id), quantity: 1 }],
    }, req);

    const saved = await Order.findById(order.id).populate('user', 'name email phone').populate('salesUser', 'name phone').lean();
    const q = buildQuotation(saved);
    expect(q.lines.map((l) => [l.quantity, l.listPrice, l.offerPrice, l.amount, l.discounted])).toEqual([
      [2, 5000, 4500, 9000, true],
      [1, 1200, 1200, 1200, false],
    ]);
    expect(q.subtotalAtList).toBe(11200);
    expect(q.discount).toBe(1000);
    expect(q.total).toBe(saved.totalAmount);
    expect(q.total).toBe(10200);
    expect(q.consistent).toBe(true);
    expect(q.totalInWords).toBe('Rupees Ten Thousand Two Hundred Only');
    expect(q.salesPerson.name).toBe('Asha');
    expect(q.customer).toMatchObject({ name: CUSTOMER.name, phone: CUSTOMER.phone, email: CUSTOMER.email });
    expect(q.number).toBe(quotationNumber(saved));
    expect(q.number).toMatch(/^QT-/);
  });

  it('is valid for 7 days, and shows the pay QR only while the link is live', () => {
    const created = new Date('2026-10-15T06:00:00Z');
    const base = {
      _id: new mongoose.Types.ObjectId(), createdAt: created, items: [{ name: 'X', quantity: 1, price: 100 }],
      totalAmount: 100, status: 'awaiting_payment', paymentStatus: 'pending', paymentLinkUrl: 'https://rzp.io/i/x',
    };
    const now = created.getTime() + 3600e3;
    const live = buildQuotation({ ...base, paymentLinkExpiresAt: new Date(now + 3600e3) }, { now });
    expect(live.validUntil.toISOString()).toBe('2026-10-22T06:00:00.000Z');
    expect(live.payment).toMatchObject({ status: 'link', url: 'https://rzp.io/i/x' });

    const expired = buildQuotation({ ...base, paymentLinkExpiresAt: new Date(now - 1) }, { now });
    expect(expired.payment).toEqual({ status: 'no_link', url: null, linkExpiresAt: null });

    const paid = buildQuotation({ ...base, paymentStatus: 'paid', status: 'processing', paymentLinkExpiresAt: new Date(now + 3600e3) }, { now });
    expect(paid.payment.status).toBe('paid');
    expect(paid.payment.url).toBeNull();
  });

  it('prints the charged total even if the lines ever disagree, and flags it', () => {
    const q = buildQuotation({
      _id: new mongoose.Types.ObjectId(), createdAt: new Date(), items: [{ name: 'X', quantity: 1, price: 100 }],
      totalAmount: 150, shippingCost: 0, status: 'awaiting_payment', paymentStatus: 'pending',
    });
    expect(q.total).toBe(150);
    expect(q.consistent).toBe(false);
  });

  it('treats a stored list price equal to the offer as full price (no fake discount)', () => {
    const q = buildQuotation({
      _id: new mongoose.Types.ObjectId(), createdAt: new Date(), totalAmount: 100,
      items: [{ name: 'X', quantity: 1, price: 100, listPrice: 100 }], status: 'awaiting_payment', paymentStatus: 'pending',
    });
    expect(q.discount).toBe(0);
    expect(q.lines[0].discounted).toBe(false);
  });
});

describe('amount in words', () => {
  it.each([
    [205000, 'Rupees Two Lakh Five Thousand Only'],
    [110000, 'Rupees One Lakh Ten Thousand Only'],
    [4499.5, 'Rupees Four Thousand Four Hundred Ninety Nine and Fifty Paise Only'],
    [10000000, 'Rupees One Crore Only'],
    [1001, 'Rupees One Thousand One Only'],
    [0, 'Rupees Zero Only'],
  ])('%p → %s', (n, words) => {
    expect(rupeesInWords(n)).toBe(words);
  });
});

describe('who may download it', () => {
  async function salesOrderBy(rep) {
    const product = await makeProduct();
    const { order } = await svc.createSalesOrder(rep, orderInput(product, { offerPrice: 4500 }), req);
    return order.id;
  }

  it('the seller gets their own as a PDF', async () => {
    const rep = await makeStaff('sales');
    const id = await salesOrderBy(rep);
    const { buffer, filename } = await getQuotationPdf(rep, id);
    expect(isPdf(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(5000);
    expect(filename).toMatch(/^Quotation-QT-.+\.pdf$/);
  });

  it('a sales head and an admin get any sales order; another seller and other teams do not', async () => {
    const rep = await makeStaff('sales');
    const id = await salesOrderBy(rep);
    const head = await makeStaff('sales', { isHead: true });
    const admin = await User.create({ name: 'Owner', email: `owner${++n}@autobacs.test`, passwordHash: 'x', role: 'admin' });
    expect(isPdf((await getQuotationPdf(head, id)).buffer)).toBe(true);
    expect(isPdf((await getQuotationPdf(admin, id)).buffer)).toBe(true);

    await expect(getQuotationPdf(await makeStaff('sales'), id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(getQuotationPdf(await makeStaff('procurement'), id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(getQuotationPdf(await makeStaff('sales', { active: false }), id)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('a cancelled order has no quotation; a website order is not a sales quotation', async () => {
    const rep = await makeStaff('sales');
    const id = await salesOrderBy(rep);
    await svc.cancelUnpaidSalesOrder(rep, id, req);
    await expect(getQuotationPdf(rep, id)).rejects.toMatchObject({ statusCode: 409 });

    const web = await Order.create({
      user: new mongoose.Types.ObjectId(), items: [{ product: new mongoose.Types.ObjectId(), name: 'W', price: 10, quantity: 1 }],
      shippingAddress: { fullName: 'W', phone: '9876543210', addressLine1: '1', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
      subtotal: 10, totalAmount: 10, status: 'processing', paymentStatus: 'paid',
    });
    const head = await makeStaff('sales', { isHead: true });
    await expect(getQuotationPdf(head, String(web._id))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('renders many lines across pages without failing', async () => {
    const rep = await makeStaff('sales');
    const products = await Promise.all(Array.from({ length: 30 }, () => makeProduct()));
    const { order } = await svc.createSalesOrder(rep, {
      customer: CUSTOMER, shippingAddress: ADDRESS,
      items: products.map((p) => ({ product: String(p._id), quantity: 1 })),
    }, req);
    const { buffer } = await getQuotationPdf(rep, order.id);
    expect(isPdf(buffer)).toBe(true);
    expect((buffer.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(1);
  });
});

describe('starting a new order for the same customer', () => {
  it('the seller can read their own order; another seller gets 404; a head can read any', async () => {
    const rep = await makeStaff('sales');
    const product = await makeProduct();
    const { order } = await svc.createSalesOrder(rep, orderInput(product), req);
    const mine = await svc.getSalesOrder(rep, order.id);
    expect(mine.customer).toMatchObject({ name: CUSTOMER.name, phone: CUSTOMER.phone, email: CUSTOMER.email });
    expect(mine.shippingAddress).toMatchObject({ addressLine1: ADDRESS.addressLine1, city: ADDRESS.city });
    await expect(svc.getSalesOrder(await makeStaff('sales'), order.id)).rejects.toMatchObject({ statusCode: 404 });
    expect((await svc.getSalesOrder(await makeStaff('sales', { isHead: true }), order.id)).id).toBe(order.id);
  });
});
