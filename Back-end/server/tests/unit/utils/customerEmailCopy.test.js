/**
 * Customer email wording guardrails (owner decision, 2026-11).
 *
 * Automated customer emails must not promise dispatch/delivery dates or business-day
 * timelines, and the shipped email must point at our Track Order page built from
 * FRONTEND_URL — never a hardcoded host. Pure templates, no I/O.
 */

import { orderStatusEmail, orderConfirmationEmail } from '../../../utils/emailTemplates.js';
import { returnEmail } from '../../../utils/returnEmailTemplates.js';
import { trackOrderUrl, storefrontOrigin } from '../../../utils/storefrontUrl.js';

// Phrases that read as a promise about WHEN something happens.
const PROMISE_PATTERNS = [
  /estimated delivery/i,
  /dispatch(ed)? (today|tomorrow|on)/i,
  /deliver(ed|y)? (by|on) /i,
  /\b\d+\s*[–-]\s*\d+\s*business days\b/i,
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  // A month followed by a day number ("November 2"); bare "may" is an ordinary word.
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d/i,
];
const expectNoPromises = (s) => PROMISE_PATTERNS.forEach((re) => expect(s).not.toMatch(re));

const company = { name: 'Autobacs India', email: 'support@autobacsindia.com' };
const ORIGINAL = process.env.FRONTEND_URL;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = ORIGINAL;
});

const order = (over = {}) => ({
  _id: '64b7f0c2a1b2c3d4e5f60718',
  totalAmount: 2499,
  shippingAddress: { fullName: 'Sunny' },
  statusHistory: [],
  items: [],
  trackingNumber: 'AWB 123/9',
  carrier: { name: 'BlueDart', trackingUrl: 'https://courier.example/AWB123' },
  // A Thursday in November: if any template rendered it, the patterns above catch it.
  estimatedDelivery: new Date('2026-11-05T06:00:00Z'),
  ...over,
});

describe('trackOrderUrl', () => {
  test('builds /track from FRONTEND_URL and URL-encodes the tracking number', () => {
    process.env.FRONTEND_URL = 'https://shop.example.com/';
    expect(storefrontOrigin()).toBe('https://shop.example.com');
    expect(trackOrderUrl('AWB 123/9')).toBe('https://shop.example.com/track?number=AWB%20123%2F9');
    expect(trackOrderUrl()).toBe('https://shop.example.com/track');
    expect(trackOrderUrl('   ')).toBe('https://shop.example.com/track');
  });

  test('takes the first origin of a comma list', () => {
    process.env.FRONTEND_URL = 'https://a.example, https://b.example';
    expect(trackOrderUrl()).toBe('https://a.example/track');
  });

  test('returns null — never a hardcoded host — when FRONTEND_URL is unset', () => {
    delete process.env.FRONTEND_URL;
    expect(trackOrderUrl('X')).toBeNull();
  });
});

describe('order status emails', () => {
  test('shipped: no delivery date, has the Track Order button deep-linked to the order AWB', () => {
    process.env.FRONTEND_URL = 'https://shop.example.com';
    const { text, html } = orderStatusEmail({ order: order(), status: 'shipped', company });
    expectNoPromises(text);
    expectNoPromises(html);
    const url = 'https://shop.example.com/track?number=AWB%20123%2F9';
    expect(text).toContain(url);
    expect(html).toContain(url);
    expect(html).toContain('Track your order');
    // The courier's own page stays as a secondary link.
    expect(html).toContain('https://courier.example/AWB123');
  });

  test('shipped parcel with its own AWB links the plain /track page (that lookup only knows order-level AWBs)', () => {
    process.env.FRONTEND_URL = 'https://shop.example.com';
    const shipment = {
      _id: 'sh1', trackingNumber: 'PARCEL-2', lines: [], carrier: { name: 'DTDC' },
      estimatedDelivery: new Date('2026-11-06T06:00:00Z'),
    };
    const o = order({ shipments: [shipment] });
    const { text, html } = orderStatusEmail({ order: o, status: 'shipped', company, shipment });
    expectNoPromises(text);
    expect(text).toContain('PARCEL-2');
    expect(html).toContain('href="https://shop.example.com/track"');
    expect(html).not.toContain('number=PARCEL-2');
  });

  test('shipped with FRONTEND_URL unset: no Track Order link at all rather than a guessed host', () => {
    delete process.env.FRONTEND_URL;
    const { html } = orderStatusEmail({ order: order(), status: 'shipped', company });
    expect(html).not.toContain('/track');
    expect(html).not.toMatch(/autobacsindia\.com\/track/);
  });

  test.each(['delivered', 'cancelled', 'refunded'])('%s: no date or timeline promises', (status) => {
    const { text, html } = orderStatusEmail({ order: order(), status, company });
    expectNoPromises(text);
    expectNoPromises(html);
  });

  test('order confirmation: no dates, says a tracking link follows once shipped', () => {
    const o = order({ items: [], subtotal: 2499, invoiceNumber: 1 });
    const { text, html } = orderConfirmationEmail({ order: o, company });
    expectNoPromises(text);
    expect(text).toMatch(/tracking link as soon as your order ships/);
    expect(html).toMatch(/tracking link as soon as your order ships/);
  });
});

describe('return emails', () => {
  const rr = (over = {}) => ({
    _id: 'r1',
    refund: { finalAmount: 999, method: 'razorpay' },
    order: { _id: '64b7f0c2a1b2c3d4e5f60718', orderNumber: 'R-1' },
    items: [],
    ...over,
  });

  test.each(['submitted', 'refunded'])('%s: no business-day timeline promise', (event) => {
    const { text, html } = returnEmail({ event, rr: rr(), order: rr().order, company });
    expectNoPromises(text);
    expectNoPromises(html);
  });
});
