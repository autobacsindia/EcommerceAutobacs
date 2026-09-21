/**
 * WHICH MODEL the customer bought, across every surface that names an order line.
 *
 * THE REGRESSION. A real paid order (2026-09-20) carried the line name
 * "Lightforce BEAST 230 Filter Cover (Amber / Black)" against the variant "Black".
 * The label was snapshotted on the line the whole time — `Order.items[].variantLabel`,
 * written by pricingService — but every surface rendered `name` alone, so neither the
 * admin nor the customer could tell which of the two options had been sold.
 *
 * The bug's real shape was DUPLICATION: the same `item.name || 'Item'` expression was
 * copied across the invoice, four email sites and several screens, so a fix applied to
 * some of them would look complete. These tests hold the surfaces together — each one
 * asserts the parent name is NOT enough on its own, which is the property that failed.
 *
 * Everything here reads the SNAPSHOT. A variant renamed or deleted after the sale must
 * never rewrite what a customer was charged for; orders are immutable financial records.
 */

import { orderConfirmationEmail, orderStatusEmail } from '../../../utils/emailTemplates.js';
import { variantDisplayName } from '../../../utils/orderLines.js';

/** The ambiguity in its purest form: the parent name contains BOTH options. */
const PARENT = 'Lightforce BEAST 230 Filter Cover (Amber / Black)';

const variantOrder = (over = {}) => ({
  _id: '64b7f0c2a1b2c3d4e5f60718',
  totalAmount: 2499,
  subtotal: 2499,
  shippingAddress: { fullName: 'Asha Rao' },
  statusHistory: [],
  items: [
    { _id: 'a', name: PARENT, price: 2499, quantity: 1, variantLabel: 'Black' },
  ],
  spinReward: null,
  shipments: [],
  ...over,
});

const company = { name: 'Autobacs India', email: 'support@autobacsindia.com' };

describe('order confirmation email', () => {
  it('names the variant in both the text and the HTML body', () => {
    const { text, html } = orderConfirmationEmail({ order: variantOrder(), company });
    expect(text).toContain(`${PARENT} — Black`);
    expect(html).toContain('Black');
    // The parent name alone is what the customer used to get, and it is ambiguous.
    expect(text).not.toMatch(new RegExp(`${escapeRe(PARENT)} ×`));
  });

  it('leaves a simple product line exactly as it was — no separator, no artefact', () => {
    const order = variantOrder({
      items: [{ _id: 'a', name: 'Carnauba Wax', price: 2499, quantity: 1, variantLabel: null }],
    });
    const { text } = orderConfirmationEmail({ order, company });
    expect(text).toContain('Carnauba Wax × 1');
    expect(text).not.toContain('Carnauba Wax —');
  });
});

describe('shipping / status email', () => {
  /*
    The status email builds its item list FOUR separate times (text body, HTML table,
    and the two "still to come" blocks for a partial shipment). Each was its own copy of
    the expression, so this asserts against the rendered output rather than the helper —
    a helper test would pass even if a call site still used the old expression.
  */
  // The order-level email lists its contents only on delivery (showItems).
  it('names the variant when it lists what was delivered', () => {
    const { text, html } = orderStatusEmail({
      order: variantOrder(), status: 'delivered', company,
    });
    expect(text).toContain(`${PARENT} — Black`);
    expect(html).toContain(`${PARENT} — Black`);
  });

  /*
    The partial-shipment email is the one that matters most here, and it is where the
    other two copies of the expression lived. A split order of the SAME product in two
    models renders "what is in this box" and "what is still to come" from two different
    lists — and without the label both read as the identical parent name, so the email
    says a box contains the thing it explicitly does not contain.
  */
  it('distinguishes the model in this parcel from the model still to come', () => {
    const order = variantOrder({
      items: [
        { _id: 'a', name: PARENT, price: 2499, quantity: 1, variantLabel: 'Black' },
        { _id: 'b', name: PARENT, price: 2499, quantity: 1, variantLabel: 'Amber' },
      ],
      shipments: [
        { _id: 's1', sequence: 1, status: 'shipped', lines: [{ itemId: 'a', quantity: 1 }] },
        { _id: 's2', sequence: 2, status: 'packed', lines: [{ itemId: 'b', quantity: 1 }] },
      ],
    });
    const shipment = order.shipments[0];
    const { text, html } = orderStatusEmail({ order, status: 'shipped', company, shipment });

    expect(text).toContain(`${PARENT} — Black`);
    expect(text).toContain(`${PARENT} — Amber`);
    expect(html).toContain(`${PARENT} — Black`);
    expect(html).toContain(`${PARENT} — Amber`);

    // The property that actually failed: the two lines must not be the same string.
    const shipped = text.indexOf(`${PARENT} — Black`);
    const pending = text.indexOf(`${PARENT} — Amber`);
    expect(shipped).toBeGreaterThan(-1);
    expect(pending).toBeGreaterThan(shipped);
  });
});

describe('variantDisplayName is the one formatting rule', () => {
  // Every flat-string surface (invoice PDF, admin pickers, orders-list preview, the
  // admin new-order notification) formats through this, so the packer, the invoice and
  // the customer cannot be shown three different strings for one line.
  it('formats identically to what the emails emit', () => {
    expect(variantDisplayName(PARENT, 'Black')).toBe(`${PARENT} — Black`);
  });
});

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
