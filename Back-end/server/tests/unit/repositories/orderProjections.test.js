/**
 * Projection drift guard.
 *
 * A missing field in a `.select()` fails SILENTLY: the query succeeds, the field comes
 * back `undefined`, and the screen renders nothing at all — no error in any log. That is
 * exactly how the part-cancelled badge shipped dead, because `cancellations` was added
 * to the customer list UI but not to the projection feeding it.
 *
 * So each screen's consumed fields are pinned here. Adding a field to one of those
 * screens without adding it to its projection now fails a test instead of quietly
 * producing a blank.
 */

import {
  CUSTOMER_LIST_FIELDS,
  ADMIN_LIST_FIELDS,
  LEAD_HISTORY_FIELDS,
} from '../../../repositories/orderProjections.js';

const fields = (projection) => projection.split(/\s+/).filter(Boolean);

/** `_id` is always returned by Mongo unless explicitly excluded, so it is never listed. */
const expectCovers = (projection, required) => {
  const present = new Set(fields(projection));
  const missing = required.filter((f) => !present.has(f));
  expect(missing).toEqual([]);
};

describe('CUSTOMER_LIST_FIELDS', () => {
  // Front-end/web/src/app/orders/page.tsx
  it('covers everything the customer order list renders', () => {
    expectCovers(CUSTOMER_LIST_FIELDS, [
      'orderNumber',      // card heading fallback
      'status',           // status chip + the status filter
      'totalAmount',      // card total
      'createdAt',        // "Placed on", and the sort
      'trackingNumber',   // the tracking line on the card
      'items',            // item names + count
      'shipments',        // ParcelProgressBadge
      'cancellations',    // the "Part cancelled" badge
      'buyer.type',       // the GST / business-order marker
      'buyer.gstin',      // the GSTIN shown on the card for enterprise orders
    ]);
  });
});

describe('ADMIN_LIST_FIELDS', () => {
  // Front-end/web/src/app/admin/orders/page.tsx — table, status control, refund badge,
  // and BOTH CSV exports.
  it('covers everything the admin orders table renders', () => {
    expectCovers(ADMIN_LIST_FIELDS, [
      'orderNumber',
      'createdAt',
      'status',
      'paymentStatus',
      'cancelledBy',      // the "Cancelled by …" attribution line
      'totalAmount',
      'refundDetails',    // getRefundBadge
      'user',             // customer name/email, and both CSV exports
      'items',            // item count in the CSV
      'shipments',        // ParcelProgressBadge + the delivered-all warning count
      'cancellations',
      'buyer.type',       // lets an admin spot B2B orders in the table
      'buyer.gstin',
      /*
        A PARTIAL return no longer moves Order.status to `returned` — that flip is now
        gated on the return covering every delivered line, because `returned` is
        terminal and stranded the un-returned items. Without this field the admin table
        would show a bare "Delivered" for an order with a return in flight, i.e. LESS
        than it showed before the fix. Only `.status` is projected: the mirror holds the
        latest return, so it can say "a return is open" but must not be used to count
        units.
      */
      'returnRequest.status',
    ]);
  });
});

describe('LEAD_HISTORY_FIELDS', () => {
  // Front-end/web/src/lib/leads.ts `OrderHistoryItem`, consumed by buildJourney.
  it('covers the CRM lead-detail purchase timeline', () => {
    expectCovers(LEAD_HISTORY_FIELDS, [
      'orderNumber', 'totalAmount', 'status', 'paymentStatus', 'cancelledBy', 'createdAt',
    ]);
  });

  /*
    Deliberately NARROWER than the lists: the timeline renders no basket, so it needs no
    `items` — and therefore no `items.product` join either (the caller passes
    withProducts:false). Pinned so nobody widens it by reflex.
  */
  it('deliberately excludes items, so the product join can be skipped', () => {
    expect(fields(LEAD_HISTORY_FIELDS)).not.toContain('items');
  });
});

describe('all projections', () => {
  /*
    `statusHistory` is the heaviest field on an order and grows with every transition.
    No list renders it. It was 66 KB of the 200-order sample that motivated projecting
    these reads at all.
  */
  it('never include statusHistory — the field that motivated projecting at all', () => {
    for (const p of [CUSTOMER_LIST_FIELDS, ADMIN_LIST_FIELDS, LEAD_HISTORY_FIELDS]) {
      expect(fields(p)).not.toContain('statusHistory');
    }
  });

  it('are plain inclusion projections — a single exclusion would invert the whole thing', () => {
    for (const p of [CUSTOMER_LIST_FIELDS, ADMIN_LIST_FIELDS, LEAD_HISTORY_FIELDS]) {
      expect(p).not.toMatch(/-/);
    }
  });
});
