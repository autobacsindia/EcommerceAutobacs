/**
 * Unit tests for the orderStatusEmail template (pure function, no I/O).
 */

import { orderStatusEmail } from '../../../utils/emailTemplates.js';

const baseOrder = () => ({
  _id: '64b7f0c2a1b2c3d4e5f60718',
  totalAmount: 2499,
  shippingAddress: { fullName: 'Asha Rao' },
  statusHistory: [],
  payment: 'pay_123',
  refundDetails: { amount: 2499 },
});

describe('orderStatusEmail', () => {
  const company = { name: 'Autobacs India', email: 'support@autobacsindia.com' };

  test.each(['shipped', 'delivered', 'cancelled', 'refunded', 'returned'])(
    'returns a non-empty subject/text/html for %s',
    (status) => {
      const { subject, text, html } = orderStatusEmail({ order: baseOrder(), status, company });
      expect(subject).toBeTruthy();
      expect(text).toBeTruthy();
      expect(html).toContain('<!DOCTYPE html>');
      // The invoice number appears in the body.
      expect(html).toContain('AB-');
    }
  );

  test('returned email uses tailored copy, not the generic status fallback', () => {
    const { subject, html } = orderStatusEmail({ order: baseOrder(), status: 'returned', company });
    expect(subject).toContain('Return completed');
    expect(html).toContain('Your return is complete');
    // Must NOT fall through to the generic "status is now: returned" default.
    expect(html).not.toContain('status is now');
  });

  test('shipped email includes the tracking number and carrier link when present', () => {
    const order = {
      ...baseOrder(),
      trackingNumber: 'TRK123456',
      carrier: { name: 'BlueDart', trackingUrl: 'https://track.example/TRK123456' },
    };
    const { html, text } = orderStatusEmail({ order, status: 'shipped', company });
    expect(html).toContain('TRK123456');
    expect(html).toContain('https://track.example/TRK123456');
    expect(text).toContain('TRK123456');
  });

  test('refunded email uses tailored refund copy', () => {
    const { subject, html } = orderStatusEmail({ order: baseOrder(), status: 'refunded', company });
    expect(subject).toContain('Refund processed');
    expect(html).toContain('Your refund has been processed');
  });

  test('cancelled email does NOT leak the internal cancellation reason to the customer', () => {
    // Internal reasons (e.g. 'fraud_suspected', 'out_of_stock') must never be surfaced
    // in a customer-facing email — the copy stays deliberately generic.
    const order = {
      ...baseOrder(),
      cancellationReason: 'fraud_suspected',
      statusHistory: [{ status: 'cancelled', reason: 'fraud_suspected' }],
    };
    const { html } = orderStatusEmail({ order, status: 'cancelled', company });
    expect(html).toContain('Your order was cancelled');
    expect(html).not.toContain('fraud_suspected');
  });

  test('falls back gracefully for an unknown status — never throws in the notification worker', () => {
    // A throw here would fail the BullMQ job and retry forever on a permanently-bad
    // status; a generic fallback email is the production-grade behavior.
    let out;
    expect(() => {
      out = orderStatusEmail({ order: baseOrder(), status: 'confirmed', company });
    }).not.toThrow();
    expect(out.subject).toBeTruthy();
    expect(out.html).toContain('<!DOCTYPE html>');
  });
});
