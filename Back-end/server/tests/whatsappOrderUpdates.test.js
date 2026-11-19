/**
 * WhatsApp order updates — the send path, against a real database.
 *
 * What is proved here (services/whatsapp/orderWhatsAppService.js):
 *   • the same event twice — sequential retry OR two jobs at once — sends ONE message;
 *   • a transient Meta failure gives the claim back so the BullMQ retry can send;
 *     a permanent one keeps it (a retry would only be refused again);
 *   • no consent, a bad or foreign number, a stale event → nothing is sent;
 *   • the channel switched off (env vars missing) → a no-op, and the email still goes;
 *   • the email stamp and the WhatsApp stamp are independent in both directions;
 *   • the audit row carries Meta's message id for the status webhook.
 *
 * Meta itself is never called: `send` is injected.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const sentEmails = [];
jest.unstable_mockModule('../services/emailHandler.js', () => {
  const sendOrderStatusUpdate = async (args) => { sentEmails.push(args.status); return { success: true }; };
  return { default: { sendOrderStatusUpdate } };
});

const { default: Order } = await import('../models/Order.js');
const { default: NotificationLog } = await import('../models/NotificationLog.js');
const { sendOrderWhatsApp, buildTemplateParams, orderRef } = await import('../services/whatsapp/orderWhatsAppService.js');
const { emailOrderStatusUpdate } = await import('../services/orderStatusEmailService.js');
const { WhatsAppSendError } = await import('../services/whatsapp/whatsappClient.js');
const { _resetWhatsAppWarning } = await import('../config/whatsapp.js');

const ENV_KEYS = ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_TEST_RECIPIENTS', 'FRONTEND_URL'];
const savedEnv = {};

const turnOn = () => {
  process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
  process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
  process.env.FRONTEND_URL = 'https://shop.example';
  delete process.env.WHATSAPP_TEST_RECIPIENTS;
};

const seedOrder = (over = {}) => Order.create({
  user: new mongoose.Types.ObjectId(),
  items: [{ product: new mongoose.Types.ObjectId(), name: 'Wax', price: 500, quantity: 2 }],
  shippingAddress: {
    fullName: 'Asha K', phone: '98765 43210', addressLine1: '1 Road',
    city: 'Kochi', state: 'Kerala', postalCode: '682001',
  },
  subtotal: 1000, totalAmount: 1000,
  status: 'processing', paymentStatus: 'paid',
  whatsappOptIn: true, whatsappOptInBy: 'customer', whatsappOptInAt: new Date(),
  ...over,
});

/** A fake Meta: records each call, answers with a fresh wamid. */
const fakeSend = () => {
  const calls = [];
  const send = jest.fn(async (msg) => {
    calls.push(msg);
    // Yield, so two concurrent jobs genuinely interleave.
    await new Promise((r) => setTimeout(r, 5));
    return { messageId: `wamid.${calls.length}` };
  });
  return { send, calls };
};

beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});
beforeEach(() => {
  turnOn();
  sentEmails.length = 0;
  _resetWhatsAppWarning();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  await Order.deleteMany({});
  await NotificationLog.deleteMany({});
  jest.restoreAllMocks();
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('sending once', () => {
  it('sends the template to the E.164 number and stamps the key', async () => {
    const order = await seedOrder();
    const { send, calls } = fakeSend();

    const res = await sendOrderWhatsApp(order._id, 'confirmed', {}, { send });

    expect(res).toEqual({ status: 'sent', messageId: 'wamid.1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ to: '+919876543210', template: 'order_confirmed', language: 'en' });
    expect(calls[0].params).toEqual(['Asha K', '1,000', orderRef(order), 'https://shop.example/track']);
    const fresh = await Order.findById(order._id).lean();
    expect(fresh.whatsappNotified).toEqual(['confirmed']);
  });

  it('the same event twice (a job retry after success) sends one message', async () => {
    const order = await seedOrder();
    const { send } = fakeSend();

    await sendOrderWhatsApp(order._id, 'shipped', {}, { send });
    const second = await sendOrderWhatsApp(order._id, 'shipped', {}, { send });

    expect(second.status).toBe('skipped');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('two jobs for the same event at the same moment send one message', async () => {
    const order = await seedOrder();
    const { send } = fakeSend();

    const results = await Promise.all([
      sendOrderWhatsApp(order._id, 'delivered', {}, { send }),
      sendOrderWhatsApp(order._id, 'delivered', {}, { send }),
      sendOrderWhatsApp(order._id, 'delivered', {}, { send }),
    ]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === 'sent')).toHaveLength(1);
    expect((await Order.findById(order._id).lean()).whatsappNotified).toEqual(['delivered']);
  });

  it('each parcel and each courier step is its own message', async () => {
    const shipA = new mongoose.Types.ObjectId();
    const shipB = new mongoose.Types.ObjectId();
    const order = await seedOrder({
      shipments: [
        { _id: shipA, sequence: 1, status: 'shipped', trackingNumber: 'AWB1', items: [] },
        { _id: shipB, sequence: 2, status: 'shipped', trackingNumber: 'AWB2', items: [] },
      ],
    });
    const { send } = fakeSend();

    await sendOrderWhatsApp(order._id, 'shipped', { shipmentId: String(shipA) }, { send });
    await sendOrderWhatsApp(order._id, 'shipped', { shipmentId: String(shipB) }, { send });
    await sendOrderWhatsApp(order._id, 'out_for_delivery', { shipmentId: String(shipA), occurrence: 2 }, { send });
    await sendOrderWhatsApp(order._id, 'out_for_delivery', { shipmentId: String(shipA), occurrence: 2 }, { send });

    expect(send).toHaveBeenCalledTimes(3);
    expect((await Order.findById(order._id).lean()).whatsappNotified).toEqual([
      `shipped:${shipA}`, `shipped:${shipB}`, `out_for_delivery:${shipA}:2`,
    ]);
  });

  it('writes an audit row with Meta\'s message id, upserted so a retry never duplicates it', async () => {
    const order = await seedOrder();
    const { send } = fakeSend();

    await sendOrderWhatsApp(order._id, 'refund_initiated', { occurrence: 'rfnd_9', amount: 250 }, { send });

    const rows = await NotificationLog.find({ orderId: order._id }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'whatsapp', provider: 'meta', event: 'refund_started', status: 'success',
      providerId: 'wamid.1', deliveryStatus: 'accepted', recipient: '+919876543210',
      notificationId: `wa:${order._id}:refund_initiated:rfnd_9`,
    });
  });
});

describe('failures', () => {
  it('a transient failure gives the claim back and rethrows, so the BullMQ retry sends', async () => {
    const order = await seedOrder();
    const send = jest.fn()
      .mockRejectedValueOnce(new WhatsAppSendError('HTTP 503', { transient: true }))
      .mockResolvedValueOnce({ messageId: 'wamid.retry' });

    await expect(sendOrderWhatsApp(order._id, 'cancelled', {}, { send })).rejects.toThrow('HTTP 503');
    expect((await Order.findById(order._id).lean()).whatsappNotified).toEqual([]);

    const retry = await sendOrderWhatsApp(order._id, 'cancelled', {}, { send });
    expect(retry.status).toBe('sent');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('a permanent rejection is recorded, not retried, and not re-sent', async () => {
    const order = await seedOrder();
    const send = jest.fn().mockRejectedValue(
      new WhatsAppSendError('template not approved', { transient: false, code: 132001 }));

    const res = await sendOrderWhatsApp(order._id, 'cancelled', {}, { send });
    expect(res.status).toBe('failed');
    const again = await sendOrderWhatsApp(order._id, 'cancelled', {}, { send });
    expect(again.status).toBe('skipped');
    expect(send).toHaveBeenCalledTimes(1);

    const row = await NotificationLog.findOne({ orderId: order._id }).lean();
    expect(row.status).toBe('failed');
    expect(row.errorMessage).toMatch(/template not approved/);
  });
});

describe('who gets nothing', () => {
  it.each([
    ['no consent recorded (an order from before the feature)', { whatsappOptIn: undefined }, 'no-consent'],
    ['the customer unticked the box', { whatsappOptIn: false }, 'no-consent'],
    ['a landline-looking number', { 'shippingAddress.phone': '0484 2345678' }, 'bad-phone'],
    ['a foreign number', { 'shippingAddress.phone': '+44 7700 900123' }, 'bad-phone'],
  ])('%s', async (_label, over, expected) => {
    const order = await seedOrder();
    await Order.updateOne({ _id: order._id }, over.whatsappOptIn === undefined && 'whatsappOptIn' in over
      ? { $unset: { whatsappOptIn: 1 } }
      : { $set: over });
    const { send } = fakeSend();

    const res = await sendOrderWhatsApp(order._id, 'shipped', {}, { send });

    expect(res.status).toBe(expected);
    expect(send).not.toHaveBeenCalled();
    expect((await Order.findById(order._id).lean()).whatsappNotified || []).toEqual([]);
  });

  it('a "payment failed" message is not sent once the order has been paid', async () => {
    const order = await seedOrder({ status: 'processing', paymentStatus: 'paid' });
    const { send } = fakeSend();
    expect((await sendOrderWhatsApp(order._id, 'payment_failed', {}, { send })).status).toBe('stale');
    expect(send).not.toHaveBeenCalled();
  });

  it('while on the test number, only allow-listed numbers receive', async () => {
    process.env.WHATSAPP_TEST_RECIPIENTS = '+91 90000 00000';
    const order = await seedOrder();
    const { send } = fakeSend();
    expect((await sendOrderWhatsApp(order._id, 'shipped', {}, { send })).status).toBe('not-allowlisted');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('channel switched off', () => {
  it('missing env vars → no-op, one warning, nothing stamped, and the email still sends', async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    const order = await seedOrder({ guestEmail: 'asha@example.com' });
    const { send } = fakeSend();

    const first = await sendOrderWhatsApp(order._id, 'cancelled', {}, { send });
    await sendOrderWhatsApp(order._id, 'cancelled', {}, { send });
    const email = await emailOrderStatusUpdate(String(order._id), 'cancelled');

    expect(first.status).toBe('disabled');
    expect(send).not.toHaveBeenCalled();
    expect(console.warn.mock.calls.filter(([m]) => /WhatsApp order updates are OFF/.test(m))).toHaveLength(1);
    expect(email.status).toBe('sent');
    expect(sentEmails).toEqual(['cancelled']);
    const fresh = await Order.findById(order._id).lean();
    expect(fresh.notifiedStatuses).toEqual(['cancelled']);
    expect(fresh.whatsappNotified || []).toEqual([]);
  });
});

describe('the email stamp and the WhatsApp stamp are independent', () => {
  it('an email already sent does not suppress the WhatsApp message, and vice versa', async () => {
    const order = await seedOrder({ guestEmail: 'asha@example.com', notifiedStatuses: ['cancelled'] });
    const { send } = fakeSend();

    // Email already went → WhatsApp still sends.
    expect((await sendOrderWhatsApp(order._id, 'cancelled', {}, { send })).status).toBe('sent');
    // WhatsApp went for `delivered` → the email for `delivered` still sends.
    await sendOrderWhatsApp(order._id, 'delivered', {}, { send });
    expect((await emailOrderStatusUpdate(String(order._id), 'delivered')).status).toBe('sent');

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.notifiedStatuses).toEqual(['cancelled', 'delivered']);
    expect(fresh.whatsappNotified).toEqual(['cancelled', 'delivered']);
  });

  it('a WhatsApp failure does not stamp or block the email', async () => {
    const order = await seedOrder({ guestEmail: 'asha@example.com' });
    const send = jest.fn().mockRejectedValue(new WhatsAppSendError('down', { transient: true }));

    await expect(sendOrderWhatsApp(order._id, 'shipped', {}, { send })).rejects.toThrow();
    expect((await emailOrderStatusUpdate(String(order._id), 'shipped')).status).toBe('sent');

    const fresh = await Order.findById(order._id).lean();
    expect(fresh.notifiedStatuses).toEqual(['shipped']);
    expect(fresh.whatsappNotified).toEqual([]);
  });
});

describe('buildTemplateParams', () => {
  const order = {
    _id: new mongoose.Types.ObjectId('64b7f0c2a1b2c3d4e5f60718'),
    shippingAddress: { fullName: 'Asha K' },
    totalAmount: 1234.5,
    cancellationReason: 'changed_mind',
    refundDetails: { amount: 900 },
  };
  const user = { _id: 'u1', name: 'Asha', isGuest: false };

  it('fills every template in the order the owner submitted it', () => {
    const ref = 'AB-E5F60718';
    expect(buildTemplateParams(order, 'confirmed', { user })).toEqual(
      ['Asha K', '1,234.5', ref, `https://shop.example/orders/${order._id}`]);
    expect(buildTemplateParams(order, 'shipped', { user })).toEqual(
      ['Asha K', ref, 'our courier partner', 'to be shared soon', 'https://shop.example/track']);
    expect(buildTemplateParams(order, 'out_for_delivery', { user })).toEqual(['Asha K', ref]);
    expect(buildTemplateParams(order, 'delivery_failed', { user })).toEqual(['Asha K', ref, 'https://shop.example/track']);
    expect(buildTemplateParams(order, 'delivered', { user })).toEqual(['Asha K', ref, 'https://shop.example/contact']);
    expect(buildTemplateParams(order, 'cancelled', { user })).toEqual(['Asha K', ref, 'Changed my mind']);
    expect(buildTemplateParams(order, 'payment_failed', { user })).toEqual(
      ['Asha K', ref, `https://shop.example/orders/${order._id}`]);
    expect(buildTemplateParams(order, 'refund_initiated', { user, amount: 250 })).toEqual(['Asha K', '250', ref]);
    // No amount on the job → the order's recorded refund.
    expect(buildTemplateParams(order, 'refunded', { user })).toEqual(['Asha K', '900', ref]);
  });

  it('a shipped parcel uses its own courier, number and tracking link', () => {
    const shipment = { trackingNumber: 'AWB1', carrier: { name: 'Delhivery', trackingUrl: 'https://track.example/AWB1' } };
    expect(buildTemplateParams(order, 'shipped', { user, shipment })).toEqual(
      ['Asha K', 'AB-E5F60718', 'Delhivery', 'AWB1', 'https://track.example/AWB1']);
  });

  it('without FRONTEND_URL it builds nothing rather than a message with a hole in it', () => {
    delete process.env.FRONTEND_URL;
    expect(buildTemplateParams(order, 'delivered', { user })).toBeNull();
  });
});
