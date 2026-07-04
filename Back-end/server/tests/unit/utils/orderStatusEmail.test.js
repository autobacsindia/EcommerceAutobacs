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

  test.each(['shipped', 'delivered', 'cancelled', 'refunded'])(
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

  test('refunded email shows the refund amount', () => {
    const { html } = orderStatusEmail({ order: baseOrder(), status: 'refunded', company });
    // ₹2,499.00 formatted
    expect(html).toMatch(/2,499\.00/);
  });

  test('cancelled email includes the transition reason from statusHistory', () => {
    const order = {
      ...baseOrder(),
      statusHistory: [{ status: 'cancelled', reason: 'out_of_stock' }],
    };
    const { html } = orderStatusEmail({ order, status: 'cancelled', company });
    expect(html).toContain('out_of_stock');
  });

  test('throws on an unsupported status (defensive)', () => {
    expect(() => orderStatusEmail({ order: baseOrder(), status: 'confirmed', company })).toThrow(
      /unsupported status/i
    );
  });
});
