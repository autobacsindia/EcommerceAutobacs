/**
 * Smoke tests for the fulfillment status + review-request email templates.
 * Pure functions — assert they render without throwing and include the key content
 * (delivered lists products; review email links each product to /products/<slug>?review=1).
 */

import { orderStatusEmail, reviewRequestEmail } from '../../../utils/emailTemplates.js';

const order = {
  _id: '0123456789abcdef01234567',
  shippingAddress: { fullName: 'Asha K' },
  items: [
    { name: 'Ceramic Wax', quantity: 2, image: 'http://img/wax.jpg' },
    { name: 'Microfibre Cloth', quantity: 1, image: '' },
  ],
};
const company = { name: 'Autobacs India', email: 'support@autobacsindia.com' };

describe('orderStatusEmail', () => {
  test.each(['shipped', 'delivered', 'cancelled', 'refunded'])(
    'renders a subject/text/html for status %s',
    (status) => {
      const { subject, text, html } = orderStatusEmail({ order, status, company });
      expect(subject).toBeTruthy();
      expect(text).toContain('Asha K');
      expect(html).toContain('<!DOCTYPE html>');
    }
  );

  test('delivered variant lists the ordered products', () => {
    const { text, html } = orderStatusEmail({ order, status: 'delivered', company });
    expect(html).toContain('Ceramic Wax');
    expect(html).toContain('Microfibre Cloth');
    expect(text).toContain('Ceramic Wax');
  });

  test('non-delivered variant does NOT list products', () => {
    const { html } = orderStatusEmail({ order, status: 'shipped', company });
    expect(html).not.toContain('Ceramic Wax');
  });

  test('tolerates an unknown status without throwing', () => {
    expect(() => orderStatusEmail({ order, status: 'weird', company })).not.toThrow();
  });
});

describe('reviewRequestEmail', () => {
  const products = [
    { name: 'Ceramic Wax', slug: 'ceramic-wax', image: 'http://img/wax.jpg' },
    { name: 'Microfibre Cloth', slug: 'microfibre-cloth', image: '' },
  ];

  test('links each product to /products/<slug>?review=1', () => {
    const { subject, text, html } = reviewRequestEmail({ order, products, company });
    expect(subject).toBeTruthy();
    for (const p of products) {
      expect(html).toContain(`/products/${p.slug}?review=1`);
      expect(text).toContain(`/products/${p.slug}?review=1`);
      expect(html).toContain(p.name);
    }
  });
});
