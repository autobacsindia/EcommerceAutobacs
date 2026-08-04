/**
 * Customer return emails. Pure template builders — no DB, no provider.
 *
 * The courier_booked email is the reason the courier fields exist at all: we book the
 * pickup, so the customer has no other way to learn who is collecting or under which
 * AWB. Before 2026-08-03 the fields were captured and never sent anywhere.
 */

import { returnEmail } from '../../../utils/returnEmailTemplates.js';

const company = { name: 'Roavion', email: 'support@autobacsindia.com' };
const order = { orderNumber: 'AB-1001' };

const makeReturn = (overrides = {}) => ({
  _id: 'ret-1',
  items: [{ product: { name: 'Foam Cell Suspension Kit' }, quantity: 1 }],
  ...overrides,
});

describe('returnEmail — courier_booked', () => {
  const rr = makeReturn({ courier: { provider: 'Delhivery', trackingNumber: 'AWB123456789' } });

  it('names the courier and the AWB in both the HTML and the text part', () => {
    const { subject, text, html } = returnEmail({ event: 'courier_booked', rr, order, company });

    expect(subject).toBe('Return pickup arranged — Order #AB-1001');
    for (const body of [text, html]) {
      expect(body).toContain('Delhivery');
      expect(body).toContain('AWB123456789');
    }
    expect(text).toContain('Foam Cell Suspension Kit × 1');
  });

  it('escapes courier values into the HTML rather than interpolating them raw', () => {
    const evil = makeReturn({ courier: { provider: '<script>x</script>', trackingNumber: 'A&B"1' } });
    const { html } = returnEmail({ event: 'courier_booked', rr: evil, order, company });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A&amp;B&quot;1');
  });

  it('degrades to a sensible sentence when the courier is somehow absent', () => {
    // The controller now requires both fields, but a legacy return can predate that.
    const { text, html } = returnEmail({ event: 'courier_booked', rr: makeReturn(), order, company });
    expect(text).toContain('our courier partner');
    expect(html).not.toContain('undefined');
    expect(text).not.toContain('Tracking / AWB:');
  });
});

describe('returnEmail — refunded', () => {
  it('states the amount actually being refunded', () => {
    const rr = makeReturn({ refund: { finalAmount: 600, shippingDeduction: 0, restockingDeduction: 0 } });
    const { subject, text } = returnEmail({ event: 'refunded', rr, order, company });
    expect(subject).toContain('₹600.00');
    expect(text).toContain('₹600.00');
  });

  it('itemises deductions when the operator applied them', () => {
    const rr = makeReturn({ refund: { finalAmount: 450, shippingDeduction: 100, restockingDeduction: 50 } });
    const { text } = returnEmail({ event: 'refunded', rr, order, company });
    expect(text).toContain('Shipping deduction: ₹100.00');
    expect(text).toContain('Restocking (10%): ₹50.00');
  });
});
