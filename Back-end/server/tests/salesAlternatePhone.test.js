/**
 * Optional "Alternative phone number" on a GTM quotation → order.
 *
 * What must hold:
 *   - validation: empty/missing is fine; a non-mobile and a copy of the main
 *     mobile are refused; "+91 98…" is normalised like the main phone
 *   - it is snapshotted onto the quotation, carried to the order on accept, and
 *     saved on the customer record — without ever replacing the main phone
 *   - it is never used to find a customer: a different customer who happens to
 *     have that number as their MAIN phone is not matched
 *   - an existing order without it still reads fine
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue,
  getOrderQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue,
  enqueueNotification: () => {},
  closeQueues: () => Promise.resolve(),
}));
jest.unstable_mockModule('../services/razorpayService.js', () => ({
  default: {
    createPaymentLink: async () => ({ id: 'plink_1', shortUrl: 'https://rzp.io/i/x' }),
    cancelPaymentLink: async (id) => ({ id, status: 'cancelled' }),
    fetchPaymentLinkStatus: async () => ({ status: 'created' }),
  },
}));

const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: SalesQuotation } = await import('../models/SalesQuotation.js');
const quotes = await import('../services/salesQuotationService.js');
const sales = await import('../services/salesOrderService.js');
const { validateSalesOrder } = await import('../validators/staff.validator.js');
const { validateRequest } = await import('../middleware/validateRequest.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };
let n = 0;
const makeStaff = () => {
  n += 1;
  return User.create({
    name: `seller ${n}`, email: `altseller${n}@autobacs.test`, phone: '9000000001',
    passwordHash: 'x', role: 'staff', staff: { team: 'sales', isHead: false, active: true },
  });
};
const ADDRESS = { addressLine1: 'Suman Heights', city: 'Navi Mumbai', state: 'Maharashtra', postalCode: '400706' };
const body = (customer) => ({
  customer: { name: 'Alt Test', phone: '9820917286', ...customer },
  shippingAddress: ADDRESS,
  items: [{ custom: true, name: 'Installation', quantity: 1, price: 2500 }],
});

// The real validator chain behind POST/PUT /staff/sales/quotations, echoing
// the sanitised body so the test sees what the service would receive.
const app = express();
app.use(express.json());
app.post('/q', validateSalesOrder, validateRequest, (r, res) => res.json({ customer: r.body.customer }));

describe('validation', () => {
  it('accepts a missing or empty alternative number', async () => {
    await request(app).post('/q').send(body({})).expect(200);
    await request(app).post('/q').send(body({ alternatePhone: '' })).expect(200);
  });

  it('normalises a valid one like the main phone', async () => {
    const res = await request(app).post('/q').send(body({ alternatePhone: '+91 98765-43210' })).expect(200);
    expect(res.body.customer.alternatePhone).toBe('9876543210');
  });

  it.each(['12345', '5876543210', 'abcdefghij', '98765432101'])('refuses %s', async (alt) => {
    const res = await request(app).post('/q').send(body({ alternatePhone: alt }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/alternative mobile/i);
  });

  it('refuses the same number as the main mobile, however it is typed', async () => {
    const res = await request(app).post('/q').send(body({ phone: '98209 17286', alternatePhone: '+919820917286' }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/same as the main mobile/i);
  });
});

describe('quotation → order', () => {
  it('is carried from the quotation to the order and onto the customer', async () => {
    const rep = await makeStaff();
    const q = await quotes.createQuotation(rep, body({ email: 'altcarry@example.com', phone: '9820911111', alternatePhone: '9820922222' }), req);
    expect(q.customer.alternatePhone).toBe('9820922222');
    expect((await SalesQuotation.findById(q.id).lean()).customer.alternatePhone).toBe('9820922222');

    const { orderId } = await quotes.acceptQuotation(rep, q.id, req);
    const order = await Order.findById(orderId).lean();
    expect(order.shippingAddress).toMatchObject({ phone: '9820911111', alternatePhone: '9820922222' });

    const user = await User.findOne({ email: 'altcarry@example.com' }).lean();
    expect(user).toMatchObject({ phone: '9820911111', alternatePhone: '9820922222' });

    const shaped = await sales.getSalesOrder(rep, orderId);
    expect(shaped.customer).toMatchObject({ phone: '9820911111', alternatePhone: '9820922222' });
  });

  it('an edit can add or change it', async () => {
    const rep = await makeStaff();
    const q1 = await quotes.createQuotation(rep, body({ phone: '9820933333' }), req);
    expect(q1.customer.alternatePhone).toBe('');
    const q2 = await quotes.updateQuotation(rep, q1.id, body({ phone: '9820933333', alternatePhone: '9820944444' }), req);
    expect(q2.customer.alternatePhone).toBe('9820944444');
  });

  it('updates an existing customer\'s alternative number but never their main phone', async () => {
    const rep = await makeStaff();
    await User.create({ name: 'Existing', email: 'altexisting@example.com', phone: '9820955555', alternatePhone: '9820966666', passwordHash: 'x' });
    const q = await quotes.createQuotation(rep, body({ email: 'altexisting@example.com', phone: '9820977777', alternatePhone: '9820988888' }), req);
    await quotes.acceptQuotation(rep, q.id, req);
    const user = await User.findOne({ email: 'altexisting@example.com' }).lean();
    expect(user).toMatchObject({ phone: '9820955555', alternatePhone: '9820988888' });
  });

  it('is never used to find the customer', async () => {
    const rep = await makeStaff();
    // Someone else whose MAIN phone is our customer's alternative number.
    const other = await User.create({ name: 'Other', email: 'm9820999999@phone.autobacs.invalid', phone: '9820999999', passwordHash: 'x' });
    const q = await quotes.createQuotation(rep, body({ phone: '9820900001', alternatePhone: '9820999999' }), req);
    const { orderId } = await quotes.acceptQuotation(rep, q.id, req);
    const order = await Order.findById(orderId).lean();
    expect(String(order.user)).not.toBe(String(other._id));
    expect((await User.findById(order.user).lean()).email).toBe('m9820900001@phone.autobacs.invalid');
  });

  it('an order without one still reads fine (no field, empty string out)', async () => {
    const rep = await makeStaff();
    const q = await quotes.createQuotation(rep, body({ phone: '9820900002' }), req);
    const { orderId } = await quotes.acceptQuotation(rep, q.id, req);
    const order = await Order.findById(orderId).lean();
    expect(order.shippingAddress.alternatePhone).toBeUndefined();
    expect((await sales.getSalesOrder(rep, orderId)).customer.alternatePhone).toBe('');
  });
});

describe('printed wherever the customer number is printed', () => {
  const order = {
    _id: '6af6ead781f50c3ebbdeb5dd', createdAt: new Date(), items: [], subtotal: 0, totalAmount: 0, discount: 0, shippingCost: 0,
    shippingAddress: { fullName: 'Alt Test', phone: '9820911111', alternatePhone: '9820922222', addressLine1: 'x', city: 'Pune', state: 'Maharashtra', postalCode: '411001' },
  };

  it('invoice bill-to lines', async () => {
    const { buildBillToLines } = await import('../services/invoiceService.js');
    const { lines } = buildBillToLines(order, null);
    expect(lines).toEqual(expect.arrayContaining(['9820911111', 'Alt. phone: 9820922222']));
    const { lines: none } = buildBillToLines({ ...order, shippingAddress: { ...order.shippingAddress, alternatePhone: undefined } }, null);
    expect(none.join(' ')).not.toMatch(/Alt\./);
  });

  it('quotation built from an order', async () => {
    const { buildQuotation } = await import('../services/quotationService.js');
    expect(buildQuotation(order).customer).toMatchObject({ phone: '9820911111', alternatePhone: '9820922222' });
  });

  it('quotation details shown with a bank transfer (saved quotation)', async () => {
    const rep = await makeStaff();
    const q = await quotes.createQuotation(rep, body({ phone: '9820900003', alternatePhone: '9820900004' }), req);
    const { orderId } = await quotes.acceptQuotation(rep, q.id, req);
    const o = await Order.findById(orderId).lean();
    const details = await quotes.quotationDetailsForOrder(rep, o);
    expect(details.customer).toMatchObject({ phone: '9820900003', alternatePhone: '9820900004' });
  });
});
