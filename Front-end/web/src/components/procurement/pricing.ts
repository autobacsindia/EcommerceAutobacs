/**
 * The procurement price calculator — pure maths, no network, nothing saved.
 * It never changes a catalogue price; it is a scratch pad for "what should we
 * sell this at?" and "what is the most we can pay for it?".
 *
 * ── MONEY RULES ──────────────────────────────────────────────────────────────
 *   • Every amount is whole PAISE (an integer). Rupees typed in are converted
 *     from their digits (parseRupees), never by multiplying a float.
 *   • Every percentage is BASIS POINTS (1% = 100 bp), so 12.5% is exactly 1250.
 *   • Products and quotients use BigInt and one explicit rounding per step:
 *       half-up  for a price or tax we would charge,
 *       ceil     for a break-even (never below cost),
 *       floor    for a maximum buy price (never above what keeps the margin).
 *   • A GST-inclusive amount is split as ex = round(incl × 100 / (100 + r)) and
 *     gst = incl − ex, so the two parts always add back to the total exactly.
 *
 * ── ASSUMPTIONS (shown in the panel) ────────────────────────────────────────
 *   • We are GST-registered and claim the GST paid to the supplier as input
 *     credit, so it is not a cost. Untick `claimGstCredit` when it cannot be claimed.
 *   • Import duty is charged on (cost ex-GST + freight), the way customs values goods.
 *   • The customer discount comes off the price incl. GST, and GST is due on what
 *     the customer actually pays.
 */

export const GST_RATES = [0, 5, 12, 18, 28] as const;
export type GstRate = (typeof GST_RATES)[number];
const BP = BigInt(10000); // 100% in basis points (BigInt(), not a literal: the build targets below ES2020)
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);

type Round = 'half-up' | 'ceil' | 'floor';

/** a × b ÷ c on non-negative integers, rounded as asked. */
export function mulDiv(a: number, b: number, c: number, round: Round = 'half-up'): number {
  if (c === 0) throw new Error('division by zero');
  const n = BigInt(a) * BigInt(b);
  const d = BigInt(c);
  const q = n / d;
  const r = n % d;
  if (r === ZERO) return Number(q);
  if (round === 'floor') return Number(q);
  if (round === 'ceil') return Number(q + ONE);
  return Number(r * TWO >= d ? q + ONE : q);
}

/** "1,250.50", "₹ 499", "0.29" → paise; '' → null; anything else → NaN. */
export function parseRupees(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[₹,\s]/g, '');
  if (s === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return NaN;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** "12.5" → 1250 bp; '' → null; anything else → NaN. */
export function parsePercent(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[%\s]/g, '');
  if (s === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return NaN;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** paise → "₹1,250.50" (paise shown only when there are any). */
export function rupees(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const hasPaise = abs % 100 !== 0;
  const s = new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR',
    minimumFractionDigits: hasPaise ? 2 : 0, maximumFractionDigits: hasPaise ? 2 : 0,
  }).format(abs / 100);
  return neg ? `−${s}` : s;
}

/** bp → "12.5%". */
export const percent = (bp: number) => `${(bp / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;

/** Split a GST-inclusive amount; the parts always add back to `incl`. */
export function splitInclusive(incl: number, rate: number): { ex: number; gst: number } {
  const ex = mulDiv(incl, 100, 100 + rate);
  return { ex, gst: incl - ex };
}

/** GST on an ex-GST amount, rounded half-up to the paisa. */
export const gstOn = (ex: number, rate: number) => mulDiv(ex, rate, 100);

const MAX_PAISE = 10_000_000_00 * 100; // ₹10 crore — far beyond any one part

export type PriceBy = 'margin' | 'markup' | 'price';

export type ForwardInput = {
  cost: number;            // paise, as the supplier quotes it
  costIncludesGst: boolean;
  gstRate: number;         // one of GST_RATES — the product's rate, buying and selling
  claimGstCredit: boolean;
  freight: number;         // paise per unit
  dutyBp: number;          // import duty
  other: number;           // paise per unit
  priceBy: PriceBy;
  marginBp: number;        // when priceBy = margin (of the selling price ex-GST)
  markupBp: number;        // when priceBy = markup (on landed cost)
  sellingPrice: number;    // paise incl. GST, when priceBy = price
  mrp: number | null;      // paise incl. GST, optional
  discountBp: number;      // customer discount, off the price incl. GST
};

export type Step = { label: string; working: string; value: number };

export type ForwardResult = {
  costExGst: number;
  purchaseGst: number;
  duty: number;
  landed: number;
  listExGst: number;
  listGst: number;
  listPrice: number;       // incl. GST, before the customer discount
  discount: number;
  finalPrice: number;      // what the customer pays, incl. GST
  finalGst: number;
  finalExGst: number;
  gstPayable: number;      // output GST minus input credit claimed (what we pay the government)
  profit: number;
  marginBp: number | null; // profit ÷ final ex-GST
  markupBp: number | null; // profit ÷ landed
  breakEven: number;       // lowest customer price incl. GST with no loss
  maxDiscountBp: number | null; // largest discount off the list price with no loss
  mrpDiscountBp: number | null; // the final price, as a discount off MRP
  warnings: string[];
  steps: Step[];
};

export type Problem = { field: string; message: string };

/** What is wrong with the inputs (empty = fine). Checked before calculating. */
export function forwardProblems(i: ForwardInput): Problem[] {
  const p: Problem[] = [];
  const money = (field: string, v: number | null, label: string, required = false) => {
    if (v == null) { if (required) p.push({ field, message: `Enter the ${label}.` }); return; }
    if (!Number.isInteger(v) || v < 0) p.push({ field, message: `${label[0].toUpperCase()}${label.slice(1)}: enter rupees, e.g. 1250 or 1250.50.` });
    else if (v > MAX_PAISE) p.push({ field, message: `${label[0].toUpperCase()}${label.slice(1)} is too large.` });
  };
  const pct = (field: string, v: number, label: string, max: number) => {
    if (!Number.isInteger(v) || v < 0) p.push({ field, message: `${label}: enter a percentage, e.g. 12.5.` });
    else if (v > max) p.push({ field, message: `${label} must be under ${max / 100}%.` });
  };
  money('cost', i.cost, 'supplier price', true);
  if (i.cost === 0) p.push({ field: 'cost', message: 'Supplier price must be more than ₹0.' });
  if (!(GST_RATES as readonly number[]).includes(i.gstRate)) p.push({ field: 'gstRate', message: 'GST must be 0, 5, 12, 18 or 28%.' });
  money('freight', i.freight, 'freight');
  money('other', i.other, 'other charges');
  pct('dutyBp', i.dutyBp, 'Import duty', 100000);
  if (i.priceBy === 'margin') {
    pct('marginBp', i.marginBp, 'Margin', 9999);
  } else if (i.priceBy === 'markup') {
    pct('markupBp', i.markupBp, 'Markup', 100000);
  } else {
    money('sellingPrice', i.sellingPrice, 'selling price', true);
    if (i.sellingPrice === 0) p.push({ field: 'sellingPrice', message: 'Selling price must be more than ₹0.' });
  }
  money('mrp', i.mrp, 'MRP');
  pct('discountBp', i.discountBp, 'Customer discount', 10000);
  return p;
}

/** Cost → landed cost → selling price → what the customer pays → profit. */
export function calculateForward(i: ForwardInput): ForwardResult {
  const problems = forwardProblems(i);
  if (problems.length) throw new Error(problems[0].message);
  const r = i.gstRate;
  const steps: Step[] = [];
  const warnings: string[] = [];

  // 1. Supplier price → ex-GST cost and the GST paid on it.
  const { ex: costExGst, gst: purchaseGst } = i.costIncludesGst
    ? splitInclusive(i.cost, r)
    : { ex: i.cost, gst: gstOn(i.cost, r) };
  steps.push(i.costIncludesGst
    ? { label: 'Supplier price without GST', working: `${rupees(i.cost)} × 100 ÷ ${100 + r}`, value: costExGst }
    : { label: 'Supplier price without GST', working: 'as entered', value: costExGst });
  steps.push({ label: `GST paid to supplier (${r}%)`, working: i.costIncludesGst ? `${rupees(i.cost)} − ${rupees(costExGst)}` : `${rupees(costExGst)} × ${r}%`, value: purchaseGst });

  // 2. Landed cost: what one unit really costs us, on the shelf.
  const duty = mulDiv(costExGst + i.freight, i.dutyBp, Number(BP));
  if (i.dutyBp) steps.push({ label: `Import duty (${percent(i.dutyBp)})`, working: `(${rupees(costExGst)} + freight ${rupees(i.freight)}) × ${percent(i.dutyBp)}`, value: duty });
  const gstCost = i.claimGstCredit ? 0 : purchaseGst;
  const landed = costExGst + gstCost + i.freight + duty + i.other;
  steps.push({
    label: 'Landed cost (per unit)',
    working: [rupees(costExGst), gstCost ? `GST not claimable ${rupees(gstCost)}` : '', i.freight ? `freight ${rupees(i.freight)}` : '', duty ? `duty ${rupees(duty)}` : '', i.other ? `other ${rupees(i.other)}` : '']
      .filter(Boolean).join(' + '),
    value: landed,
  });

  // 3. List price (before any customer discount).
  let listExGst: number;
  let listGst: number;
  let listPrice: number;
  if (i.priceBy === 'price') {
    listPrice = i.sellingPrice;
    ({ ex: listExGst, gst: listGst } = splitInclusive(listPrice, r));
    steps.push({ label: 'Selling price without GST', working: `${rupees(listPrice)} × 100 ÷ ${100 + r}`, value: listExGst });
  } else {
    listExGst = i.priceBy === 'margin'
      ? mulDiv(landed, Number(BP), Number(BP) - i.marginBp)
      : mulDiv(landed, Number(BP) + i.markupBp, Number(BP));
    steps.push(i.priceBy === 'margin'
      ? { label: `Selling price without GST (${percent(i.marginBp)} margin)`, working: `${rupees(landed)} ÷ (1 − ${percent(i.marginBp)})`, value: listExGst }
      : { label: `Selling price without GST (${percent(i.markupBp)} markup)`, working: `${rupees(landed)} × (1 + ${percent(i.markupBp)})`, value: listExGst });
    listGst = gstOn(listExGst, r);
    listPrice = listExGst + listGst;
    steps.push({ label: `Selling price with GST (${r}%)`, working: `${rupees(listExGst)} + GST ${rupees(listGst)}`, value: listPrice });
  }

  // 4. Customer discount, then what the customer pays and the GST inside it.
  const discount = mulDiv(listPrice, i.discountBp, Number(BP));
  const finalPrice = listPrice - discount;
  if (i.discountBp) steps.push({ label: `Customer discount (${percent(i.discountBp)})`, working: `${rupees(listPrice)} × ${percent(i.discountBp)}`, value: discount });
  const { ex: finalExGst, gst: finalGst } = splitInclusive(finalPrice, r);
  steps.push({ label: 'Customer pays', working: i.discountBp ? `${rupees(listPrice)} − ${rupees(discount)}` : 'selling price with GST', value: finalPrice });
  steps.push({ label: 'GST collected from customer', working: `${rupees(finalPrice)} − ${rupees(finalExGst)}`, value: finalGst });
  const credit = i.claimGstCredit ? purchaseGst : 0;
  const gstPayable = finalGst - credit;
  if (credit) steps.push({ label: 'GST to pay the government', working: `${rupees(finalGst)} collected − ${rupees(credit)} credit`, value: gstPayable });

  // 5. Profit.
  const profit = finalExGst - landed;
  steps.push({ label: 'Profit (per unit)', working: `${rupees(finalExGst)} − landed ${rupees(landed)}`, value: profit });
  const marginBp = finalExGst > 0 ? signedRatioBp(profit, finalExGst) : null;
  const markupBp = landed > 0 ? signedRatioBp(profit, landed) : null;

  // 6. Break-even: the lowest price incl. GST that covers the landed cost.
  const breakEven = landed + mulDiv(landed, r, 100, 'ceil');
  const maxDiscountBp = listPrice > 0 && listPrice >= breakEven
    ? mulDiv(listPrice - breakEven, Number(BP), listPrice, 'floor')
    : null;

  // MRP: the law says we may not charge above it.
  let mrpDiscountBp: number | null = null;
  if (i.mrp != null && i.mrp > 0) {
    if (finalPrice > i.mrp) warnings.push(`The customer price ${rupees(finalPrice)} is above the MRP ${rupees(i.mrp)} — we cannot charge more than MRP.`);
    else mrpDiscountBp = mulDiv(i.mrp - finalPrice, Number(BP), i.mrp);
  }
  if (profit < 0) warnings.push(`This sells at a loss of ${rupees(-profit)} per unit. Break-even is ${rupees(breakEven)} incl. GST.`);
  else if (profit === 0) warnings.push('This sells at exactly break-even — no profit.');

  return {
    costExGst, purchaseGst, duty, landed, listExGst, listGst, listPrice, discount, finalPrice, finalGst, finalExGst,
    gstPayable, profit, marginBp, markupBp, breakEven, maxDiscountBp, mrpDiscountBp, warnings, steps,
  };
}

/** a ÷ b in basis points, rounded half away from zero (profit can be negative). */
function signedRatioBp(a: number, b: number): number {
  const v = mulDiv(Math.abs(a), Number(BP), b);
  return a < 0 ? -v : v;
}

// ── Reverse: from the price we can sell at, the most we can pay ─────────────

export type ReverseInput = {
  sellingPrice: number;   // paise incl. GST — what the customer will pay (after any discount)
  gstRate: number;
  claimGstCredit: boolean;
  marginBp: number;       // margin we want, of the selling price ex-GST
  freight: number;
  dutyBp: number;
  other: number;
};

export type ReverseResult = {
  sellingExGst: number;
  sellingGst: number;
  profit: number;          // at the max buy price
  maxLanded: number;
  maxBuyExGst: number;     // the most to pay the supplier, before GST
  maxBuyGst: number;
  maxBuyInclGst: number;   // the same, as the supplier would quote it with GST
  steps: Step[];
  warnings: string[];
};

export function reverseProblems(i: ReverseInput): Problem[] {
  const p: Problem[] = [];
  if (i.sellingPrice == null || Number.isNaN(i.sellingPrice)) p.push({ field: 'sellingPrice', message: 'Enter the selling price.' });
  else if (!Number.isInteger(i.sellingPrice) || i.sellingPrice <= 0) p.push({ field: 'sellingPrice', message: 'Selling price must be more than ₹0.' });
  else if (i.sellingPrice > MAX_PAISE) p.push({ field: 'sellingPrice', message: 'Selling price is too large.' });
  if (!(GST_RATES as readonly number[]).includes(i.gstRate)) p.push({ field: 'gstRate', message: 'GST must be 0, 5, 12, 18 or 28%.' });
  if (!Number.isInteger(i.marginBp) || i.marginBp < 0 || i.marginBp > 9999) p.push({ field: 'marginBp', message: 'Margin must be from 0 to under 100%.' });
  for (const [field, v, label] of [['freight', i.freight, 'Freight'], ['other', i.other, 'Other charges']] as const) {
    if (!Number.isInteger(v) || v < 0 || v > MAX_PAISE) p.push({ field, message: `${label}: enter rupees, e.g. 120.` });
  }
  if (!Number.isInteger(i.dutyBp) || i.dutyBp < 0 || i.dutyBp > 100000) p.push({ field: 'dutyBp', message: 'Import duty: enter a percentage, e.g. 10.' });
  return p;
}

/**
 * The most we can pay a supplier and still make `marginBp` at `sellingPrice`.
 * Every step rounds DOWN, so paying the answer never earns less than the margin.
 */
export function calculateReverse(i: ReverseInput): ReverseResult {
  const problems = reverseProblems(i);
  if (problems.length) throw new Error(problems[0].message);
  const r = i.gstRate;
  const steps: Step[] = [];
  const warnings: string[] = [];
  const { ex: sellingExGst, gst: sellingGst } = splitInclusive(i.sellingPrice, r);
  steps.push({ label: 'Selling price without GST', working: `${rupees(i.sellingPrice)} × 100 ÷ ${100 + r}`, value: sellingExGst });
  const maxLanded = mulDiv(sellingExGst, Number(BP) - i.marginBp, Number(BP), 'floor');
  steps.push({ label: `Most the landed cost can be (${percent(i.marginBp)} margin)`, working: `${rupees(sellingExGst)} × (1 − ${percent(i.marginBp)})`, value: maxLanded });

  // landed = c × (1 + g) + freight + duty × (c + freight) + other, where g is the GST
  // that cannot be claimed (0 when we take credit). Solve for c and round down.
  const g = i.claimGstCredit ? 0 : r * 100; // in bp
  const left = maxLanded - i.other - i.freight - mulDiv(i.freight, i.dutyBp, Number(BP), 'ceil');
  let maxBuyExGst = left > 0 ? mulDiv(left, Number(BP), Number(BP) + i.dutyBp + g, 'floor') : 0;
  // Rounding duty/GST up per step can still nudge landed past the cap by a paisa: step down until it fits.
  const landedAt = (c: number) => c + (i.claimGstCredit ? 0 : gstOn(c, r)) + i.freight + mulDiv(c + i.freight, i.dutyBp, Number(BP)) + i.other;
  // …and half-up rounding can leave room for a paisa more. Either walk is a step or two.
  while (maxBuyExGst > 0 && landedAt(maxBuyExGst) > maxLanded) maxBuyExGst -= 1;
  while (left > 0 && landedAt(maxBuyExGst + 1) <= maxLanded) maxBuyExGst += 1;
  const costs = [i.freight ? `freight ${rupees(i.freight)}` : '', i.dutyBp ? `duty ${percent(i.dutyBp)}` : '', i.other ? `other ${rupees(i.other)}` : '', i.claimGstCredit ? '' : `GST ${r}% not claimable`].filter(Boolean);
  steps.push({ label: 'Most to pay the supplier, without GST', working: costs.length ? `after ${costs.join(', ')}` : 'same as the landed cost', value: maxBuyExGst });
  const maxBuyGst = gstOn(maxBuyExGst, r);
  const maxBuyInclGst = maxBuyExGst + maxBuyGst;
  steps.push({ label: `Same, with GST (${r}%)`, working: `${rupees(maxBuyExGst)} + ${rupees(maxBuyGst)}`, value: maxBuyInclGst });
  const profit = maxBuyExGst > 0 ? sellingExGst - landedAt(maxBuyExGst) : 0;
  if (maxBuyExGst <= 0) warnings.push('Freight, duty and other charges alone use up this margin — no buy price works. Lower the margin or the charges.');
  return { sellingExGst, sellingGst, profit, maxLanded, maxBuyExGst, maxBuyGst, maxBuyInclGst, steps, warnings };
}
