/**
 * What an order's delivery fees were, and which of them the customer actually paid —
 * read ONLY from the order's own `deliveryFees` snapshot (an order is an immutable
 * financial record; today's rate card must never change what an old invoice says).
 *
 * Shared by the invoice PDF and the order-confirmation email so both say the same:
 *   - Black Friday offer applied → every fee is shown at its full price, struck
 *     through, as ₹0, plus "You saved ₹X". Those fees were NOT supplied for a price:
 *     they are informational, never part of the taxable total.
 *   - No offer → each fee is a normal payable line.
 *   - A free-delivery coupon (charged < total, no offer) → payable lines plus the
 *     coupon's reduction, as before.
 *
 * Money is rounded to paise; nothing here re-prices anything.
 */

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {object} order — an Order (lean or doc) with optional `deliveryFees`.
 * @returns {null | {
 *   waived: boolean,                  // the Black Friday offer zeroed every fee
 *   lines: Array<{code:string,label:string,amount:number}>,  // full price of each fee
 *   total: number,                    // all fees before any waiver
 *   charged: number,                  // fees the customer paid (0 when waived)
 *   saving: number,                   // Black Friday saving (0 when not waived)
 *   couponSaving: number,             // free-delivery coupon reduction (no offer)
 *   payable: { products: number, gst: number, fees: number, total: number },
 *   savingsLines: Array<{label:string, amount:number, total?:boolean}>,  // Black Friday only
 * }}
 */
export function deliveryFeeBreakdown(order) {
  const fees = order?.deliveryFees;
  if (!fees) return null;

  const waived = Boolean(fees.offer?.applied);
  const lines = (Array.isArray(fees.lines) ? fees.lines : [])
    .map((l) => ({ code: String(l.code || ''), label: String(l.label || ''), amount: r2(l.amount) }));
  const total = r2(fees.total);
  const charged = waived ? 0 : r2(fees.charged);
  const orderTotal = r2(order.totalAmount);

  const saving = waived ? r2(fees.offer?.saving ?? total) : 0;
  // Sachin's breakdown, from the order's own savings snapshot: delivery fees waived,
  // the goods discount, and the total. Older orders (no snapshot) get the fee saving.
  const snap = order.savings;
  let savingsLines = [];
  if (waived && snap) {
    savingsLines = [
      { label: 'Shipping & fees waived', amount: r2(snap.deliveryFees) },
      ...(r2(snap.discount) > 0 ? [{ label: 'Discount', amount: r2(snap.discount) }] : []),
      { label: 'Total savings', amount: r2(snap.total), total: true },
    ];
  } else if (waived) {
    savingsLines = [{ label: 'Total savings', amount: saving, total: true }];
  }

  return {
    waived,
    lines,
    total,
    charged,
    saving,
    savingsLines,
    couponSaving: !waived && charged < total ? r2(total - charged) : 0,
    payable: {
      // What the customer paid for the goods: the order total minus the fees they
      // were charged. GST is the (indicative) tax included in those goods.
      products: r2(Math.max(0, orderTotal - charged)),
      gst: r2(order.tax),
      fees: charged,
      total: orderTotal,
    },
  };
}

export default deliveryFeeBreakdown;
