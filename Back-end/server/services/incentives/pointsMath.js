/**
 * Roav Points — the maths, and nothing else.
 *
 * Pure functions: no database, no clock, no I/O. Everything here is driven by a
 * rule set (config/incentiveDefaults.js shape) passed in, so a month is always
 * computed with the rules that were in force for it.
 *
 * UNITS
 *   - Money in, rupees (as stored on Order).
 *   - Ledger points are INTEGER CENTI-POINTS (1 point = 100). Order points are
 *     fractional (0.0196 per rupee) and are summed over many lines; integers make
 *     that sum exact and make a reversal an exact negation.
 *   - Month totals are rounded to WHOLE points once, at the end. Slabs compare
 *     whole points, so 67,299 is Turbo and 67,300 is Nitro, with no float edge.
 *   - Payouts are INTEGER PAISE.
 */

const EPS = 1e-9;

export const toCenti = (points) => Math.round(points * 100);
export const fromCenti = (centi) => centi / 100;

/**
 * Round half away from zero. Math.round(-0.5) is -0, and Math.round(2.5) is 3 but
 * Math.round(-2.5) is -2; a reversal must mirror its earn exactly, so be symmetric.
 */
export const roundHalfAway = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));

/**
 * Points before discount keep / sourcing: each portion of the ex-GST value is
 * multiplied by its bracket's multiplier (tax-bracket style).
 * Returns { points, flatPoints, portions } — flatPoints ignores the multipliers
 * (used only when the owner caps multipliers by slab).
 */
export function bracketPoints(valueExGst, rules) {
  const value = Math.max(0, Number(valueExGst) || 0);
  const rate = rules.basePointsPerRupee;
  let lower = 0;
  let points = 0;
  const portions = [];
  for (const b of rules.brackets) {
    const upper = b.upTo == null ? Infinity : b.upTo;
    if (value <= lower) break;
    const portion = Math.min(value, upper) - lower;
    if (portion > 0) {
      points += portion * rate * b.multiplier;
      portions.push({ from: lower, to: Math.min(value, upper), multiplier: b.multiplier });
    }
    lower = upper;
  }
  return { points, flatPoints: value * rate, portions };
}

/** Share of points kept for a discount percent (0–100). */
export function discountKeep(discountPercent, rules) {
  const pct = Math.max(0, Number(discountPercent) || 0);
  if (pct <= (rules.discountTolerancePercent ?? 0) + EPS) {
    const zero = rules.discountKeep.find((t) => t.maxPercent === 0);
    return zero ? zero.keep : 1;
  }
  for (const t of rules.discountKeep) {
    if (t.maxPercent === 0) continue;
    if (t.maxPercent == null || pct <= t.maxPercent + EPS) return t.keep;
  }
  return rules.discountKeep[rules.discountKeep.length - 1].keep;
}

/**
 * Split integer `total` across `weights` so the parts sum EXACTLY to total
 * (largest-remainder). Ties broken by index so the split is deterministic.
 */
export function allocate(total, weights) {
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (!weights.length) return [];
  if (sum <= 0) {
    const out = weights.map(() => 0);
    out[0] = total;
    return out;
  }
  const raw = weights.map((w) => (Math.max(0, w) / sum) * total);
  const out = raw.map((r) => Math.floor(r));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left -= 1) out[order[k].i] += 1;
  return out;
}

/**
 * Turn an order (already proven paid) into its ledger components.
 *
 * @param {object} input
 * @param {Array<{id:string, productId?:string, quantity:number, price:number, listPrice?:number|null}>} input.lines
 * @param {number} input.orderDiscount   order-level goods discount, rupees (coupon/karma/quotation)
 * @param {number|null} input.orderTax   GST portion of the goods, rupees (null → use rules.gstRate)
 * @param {boolean} input.isB2B
 * @param {boolean} input.specialSourcing
 * @param {object} rules
 * @returns {{ snapshot: object, components: Array<{component:string, lineId:string|null, centi:number, flatCenti:number, detail:object}> }}
 */
export function computeOrderPoints(input, rules) {
  const lines = (input.lines || []).filter((l) => Number(l.quantity) > 0);
  const gross = lines.map((l) => Number(l.price) * Number(l.quantity));
  const grossTotal = gross.reduce((a, b) => a + b, 0);
  const orderDiscount = Math.min(Math.max(0, Number(input.orderDiscount) || 0), grossTotal);
  const billedGross = grossTotal - orderDiscount;

  // Reference price: what the customer would have paid with no seller discount.
  // `listPrice` is snapshotted on a line only when the seller charged below list.
  const websiteRef = lines.reduce(
    (a, l) => a + Number(l.listPrice != null && l.listPrice > l.price ? l.listPrice : l.price) * Number(l.quantity),
    0
  );
  const reference = input.isB2B
    ? websiteRef * (1 - (rules.b2bDealerDiscountPercent || 0) / 100)
    : websiteRef;
  const discountPercent = reference > 0 ? Math.max(0, ((reference - billedGross) / reference) * 100) : 0;

  const tax = input.orderTax != null && input.orderTax > 0 && input.orderTax < billedGross
    ? Number(input.orderTax)
    : billedGross - billedGross / (1 + rules.gstRate);
  const valueExGst = Math.max(0, billedGross - tax);

  const keep = discountKeep(discountPercent, rules);
  const sourcingKeep = input.specialSourcing ? rules.specialSourcingKeep : 1;
  const br = bracketPoints(valueExGst, rules);
  const coreCenti = toCenti(br.points * keep * sourcingKeep);
  const coreFlatCenti = toCenti(br.flatPoints * keep * sourcingKeep);

  // Each line's share of the order discount, by gross value, for allocation only.
  const lineNet = gross.map((g) => (grossTotal > 0 ? g - (g / grossTotal) * orderDiscount : 0));
  const coreSplit = allocate(coreCenti, lineNet);
  const flatSplit = allocate(coreFlatCenti, lineNet);

  const components = lines.map((l, i) => ({
    component: 'core',
    lineId: String(l.id),
    centi: coreSplit[i],
    flatCenti: flatSplit[i],
    detail: { quantity: l.quantity, unitPrice: l.price, listPrice: l.listPrice ?? null, lineNet: round2(lineNet[i]) },
  }));

  // Priority-product bonus: flat, per unit, by buyer type. Not scaled by keep.
  const priority = rules.priorityProducts || [];
  for (const l of lines) {
    if (!l.productId) continue;
    const hit = priority.find((p) => (p.productIds || []).map(String).includes(String(l.productId)));
    if (!hit) continue;
    const per = input.isB2B ? hit.b2b : hit.b2c;
    if (!per) continue;
    const centi = toCenti(per * Number(l.quantity));
    components.push({
      component: `bonus:${hit.key}`,
      lineId: String(l.id),
      centi,
      flatCenti: centi,
      detail: { label: hit.label, perUnit: per, quantity: l.quantity },
    });
  }

  if (rules.perOrderBonus && valueExGst + EPS >= (rules.perOrderBonusMinValue || 0)) {
    const centi = toCenti(rules.perOrderBonus);
    components.push({ component: 'order', lineId: null, centi, flatCenti: centi, detail: {} });
  }

  return {
    snapshot: {
      grossTotal: round2(grossTotal),
      orderDiscount: round2(orderDiscount),
      billedGross: round2(billedGross),
      tax: round2(tax),
      valueExGst: round2(valueExGst),
      referenceValue: round2(reference),
      discountPercent: round4(discountPercent),
      discountKeep: keep,
      isB2B: !!input.isB2B,
      specialSourcing: !!input.specialSourcing,
      sourcingKeep,
      bracketPoints: round4(br.points),
      portions: br.portions,
    },
    components,
  };
}

/** The slab reached by whole `points`, or null below the first slab. */
export function slabFor(points, slabs) {
  const sorted = [...slabs].sort((a, b) => a.minPoints - b.minPoints);
  let hit = null;
  for (const s of sorted) if (points >= s.minPoints) hit = s;
  return hit;
}

/** The next slab above `points` and how far away it is (null at the top). */
export function nextSlab(points, slabs) {
  const sorted = [...slabs].sort((a, b) => a.minPoints - b.minPoints);
  const next = sorted.find((s) => points < s.minPoints);
  return next ? { name: next.name, minPoints: next.minPoints, pointsToGo: next.minPoints - points } : null;
}

export const ratePaise = (ratePerPoint) => Math.round(ratePerPoint * 100);

/**
 * The month factors for one person.
 * @param {{orders:number, returnedOrders:number, ratingCount:number, ratingAvg:number|null}} m
 */
export function monthFactors(m, rules) {
  const returnRate = m.orders > 0 ? (m.returnedOrders / m.orders) * 100 : 0;
  const returnFactor = returnRate > rules.returnRateThresholdPercent + EPS ? rules.returnPenaltyMultiplier : 1;
  let ratingFactor = 1;
  const r = rules.rating;
  if (m.ratingCount >= r.minCount && m.ratingAvg != null) {
    if (m.ratingAvg >= r.highAvg - EPS) ratingFactor = r.highMultiplier;
    else if (m.ratingAvg < r.lowAvg - EPS) ratingFactor = r.lowMultiplier;
  }
  return { returnRate: round4(returnRate), returnFactor, ratingFactor };
}

/**
 * One person's month: ledger centi-points → final whole points → slab → paise.
 *
 * @param {{centi:number, flatCenti:number, orders:number, returnedOrders:number, ratingCount:number, ratingAvg:number|null}} m
 */
export function monthResult(m, rules) {
  const f = monthFactors(m, rules);
  const finalOf = (centi) => Math.max(0, roundHalfAway(fromCenti(centi) * f.returnFactor * f.ratingFactor));
  let finalPoints = finalOf(m.centi);
  let slab = slabFor(finalPoints, rules.slabs);
  let multipliersDropped = false;
  if (rules.multiplierSlabCap && slab) {
    const sorted = [...rules.slabs].sort((a, b) => a.minPoints - b.minPoints);
    const capIdx = sorted.findIndex((s) => s.name === rules.multiplierSlabCap);
    const idx = sorted.findIndex((s) => s.name === slab.name);
    if (capIdx >= 0 && idx > capIdx) {
      finalPoints = finalOf(m.flatCenti);
      slab = slabFor(finalPoints, rules.slabs);
      multipliersDropped = true;
    }
  }
  const rate = slab ? ratePaise(slab.ratePerPoint) : 0;
  return {
    ledgerPoints: round2(fromCenti(m.centi)),
    ...f,
    finalPoints,
    slab: slab ? slab.name : null,
    ratePerPoint: slab ? slab.ratePerPoint : 0,
    payoutPaise: finalPoints * rate,
    multipliersDropped,
    next: nextSlab(finalPoints, rules.slabs),
  };
}

const round2 = (x) => Math.round(x * 100) / 100;
const round4 = (x) => Math.round(x * 10000) / 10000;
