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

  it('does not promise a bank settlement for money already handed over offline', () => {
    // The customer was paid at the counter. "On its way, allow 5-9 business days" reads
    // as a SECOND payment coming, which is how a support ticket (or a chargeback) starts.
    const rr = makeReturn({
      refund: { finalAmount: 600, method: 'offline', offlineMethod: 'cash', reference: 'RCPT-8821' },
    });
    const { subject, text, html } = returnEmail({ event: 'refunded', rr, order, company });
    expect(subject).toContain('Refund confirmed');
    expect(text).toContain('paid to you by cash');
    expect(text).toContain('RCPT-8821');
    expect(text).not.toMatch(/5-9 business days/);
    expect(text).not.toMatch(/original payment method/);
    expect(html).toContain('RCPT-8821');
  });

  it('names the offline method the customer actually received', () => {
    const rr = makeReturn({
      refund: { finalAmount: 600, method: 'offline', offlineMethod: 'bank_transfer', reference: 'UTR-42' },
    });
    expect(returnEmail({ event: 'refunded', rr, order, company }).text).toContain('paid to you by bank transfer');
  });

  it('still itemises deductions on an offline refund', () => {
    const rr = makeReturn({
      refund: { finalAmount: 450, shippingDeduction: 100, restockingDeduction: 50, method: 'offline', offlineMethod: 'upi', reference: 'U1' },
    });
    const { text } = returnEmail({ event: 'refunded', rr, order, company });
    expect(text).toContain('Shipping deduction: ₹100.00');
    expect(text).toContain('Restocking (10%): ₹50.00');
  });

  it('itemises deductions when the operator applied them', () => {
    const rr = makeReturn({ refund: { finalAmount: 450, shippingDeduction: 100, restockingDeduction: 50 } });
    const { text } = returnEmail({ event: 'refunded', rr, order, company });
    expect(text).toContain('Shipping deduction: ₹100.00');
    expect(text).toContain('Restocking (10%): ₹50.00');
  });

  // On EMI the loan is between the customer and their bank: we are settled in full and
  // never touch the interest. A "full refund" therefore still leaves them out of pocket
  // by the interest already billed plus any bank cancellation charge — neither of which
  // we or Razorpay can reverse. Saying so in the refund email is what keeps that from
  // becoming a chargeback.
  const emiPayment = {
    methodDetails: { emi: { kind: 'credit_card', issuer: 'HDFC', months: 6, ratePercent: 14 } },
  };

  it('warns EMI customers that only the principal comes back', () => {
    const rr = makeReturn({ refund: { finalAmount: 85000 } });
    const { text, html } = returnEmail({ event: 'refunded', rr, order, company, payment: emiPayment });
    expect(text).toContain('Credit Card EMI · HDFC · 6 months @ 14%');
    expect(text).toContain('principal only');
    expect(text).toContain('not refundable');
    expect(html).toContain('principal only');
  });

  it('stays silent about EMI for a non-EMI payment', () => {
    const rr = makeReturn({ refund: { finalAmount: 600 } });
    const { text, html } = returnEmail({
      event: 'refunded', rr, order, company, payment: { methodDetails: { rawMethod: 'upi' } },
    });
    expect(text).not.toContain('principal only');
    expect(html).not.toContain('principal only');
  });

  it('sends fine with no payment at all — the caveat is best-effort, never a throw', () => {
    const rr = makeReturn({ refund: { finalAmount: 600 } });
    expect(() => returnEmail({ event: 'refunded', rr, order, company })).not.toThrow();
  });
});
