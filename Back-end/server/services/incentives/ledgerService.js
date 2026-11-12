/**
 * Roav Points ledger writer: turns verified-paid sales orders into ledger rows,
 * and returns / refunds / cancellations into reversal rows.
 *
 * ── Why a sweep and not a hook on the payment path ──────────────────────────
 * The payment success path (razorpayService, bankTransferService) is money-
 * critical and owned by other work in flight. A sweep that READS the payment
 * records keeps this feature from adding a failure mode to taking money, and
 * it self-heals: a missed run is caught by the next one. Points are payroll,
 * not checkout — a few minutes' delay is fine.
 *
 * ── Idempotency ──────────────────────────────────────────────────────────────
 * Every row has a deterministic unique `key`. Running `processOrder` twice, or
 * two replicas at once, inserts each row at most once (duplicate key = done).
 * Reversal keys carry a sequence number derived from how many reversals already
 * exist for that earn row, so two concurrent runs compute the same key and only
 * one insert wins; the next run tops up any remainder.
 *
 * ── What is reversed ─────────────────────────────────────────────────────────
 *   - A return refunded (ReturnRequest.status 'refunded') that was raised within
 *     `returnWindowDays` of payment → that line's share, by quantity.
 *   - A partial line cancellation → that line's share, by quantity.
 *   - The whole order refunded or cancelled → everything left.
 *   - The order's earn set changing (seller reassigned, special-sourcing
 *     toggled) → the old rows fully, then the new rows are earned.
 * The +200 per-order points go only when every line is gone.
 *
 * A reversal lands in the earn row's month while that month is open, else in
 * the current open month (a locked month is never written to).
 */
import mongoose from 'mongoose';
import * as repo from '../../repositories/incentiveRepository.js';
import { computeOrderPoints, allocate, roundHalfAway } from './pointsMath.js';
import { verifyPaid } from './paymentProof.js';
import { rulesCache } from './ruleService.js';
import { monthOf, addMonths } from './months.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * The first month Roav Points counts. Orders paid earlier never earn (they were
 * sold under no scheme). INCENTIVES_START_MONTH, default 2026-11 (owner to confirm).
 */
export const programStartMonth = () => {
  const m = process.env.INCENTIVES_START_MONTH;
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(m || '') ? m : '2026-11';
};

/** Same format as invoiceService.orderNumber (not imported: that module pulls in PDF + email). */
export const orderRef = (order) =>
  order.wpId ? `#${order.wpId}` : `#${String(order._id).slice(-8).toUpperCase()}`;

/** Month status lookup, memoised for one run. */
export function monthStatusCache() {
  const memo = new Map();
  const get = async (month) => {
    if (!memo.has(month)) {
      memo.set(month, repo.monthDoc(month, 'status').then((m) => m?.status || 'open'));
    }
    return memo.get(month);
  };
  /** First open month at or after `month`, never before the current month when `month` is closed. */
  const landing = async (month, now) => {
    if ((await get(month)) === 'open') return month;
    let m = monthOf(now) > month ? monthOf(now) : addMonths(month, 1);
    for (let i = 0; i < 24 && (await get(m)) !== 'open'; i += 1) m = addMonths(m, 1);
    return m;
  };
  return { get, landing, forget: (month) => memo.delete(month) };
}

/**
 * Who is credited. A staff login is preferred (salesUser, then the CRM rep's
 * login); a name-only CRM rep is credited by rep id. No seller → no points.
 *
 * Two sellers would split 50/50 here. No order field records a second seller
 * today, so this returns at most one earner.
 */
export async function earnersFor(order, cache = {}) {
  const users = cache.users || new Map();
  const reps = cache.reps || new Map();
  const userName = async (id) => {
    const k = String(id);
    if (!users.has(k)) users.set(k, repo.userName(id));
    return users.get(k);
  };
  if (order.salesUser) {
    return [{ earnerKey: `u:${order.salesUser}`, user: order.salesUser, rep: null, name: await userName(order.salesUser), share: 1 }];
  }
  if (order.salesRep) {
    const k = String(order.salesRep);
    if (!reps.has(k)) reps.set(k, repo.salesRepById(order.salesRep));
    const rep = await reps.get(k);
    if (!rep) return [];
    if (rep.user) return [{ earnerKey: `u:${rep.user}`, user: rep.user, rep: rep._id, name: (await userName(rep.user)) || rep.name, share: 1 }];
    return [{ earnerKey: `r:${rep._id}`, user: null, rep: rep._id, name: rep.name, share: 1 }];
  }
  return [];
}

/** Build the earn rows this order SHOULD have right now (not yet inserted). */
export async function desiredEarnRows(order, ctx) {
  const proof = verifyPaid(order, ctx.payments, ctx.transfers);
  if (!proof.verified) return { proof, rows: [] };
  const earners = await earnersFor(order, ctx.cache);
  if (!earners.length) return { proof, rows: [] };

  const paidMonth = monthOf(proof.paidAt);
  if (!ctx.ignoreStartMonth && paidMonth < programStartMonth()) return { proof, rows: [] };
  const { version, rules } = await ctx.getRules(paidMonth);
  const rev = ctx.flag?.rev || 0;
  const { snapshot, components } = computeOrderPoints({
    lines: (order.items || []).map((it) => ({
      id: it._id, productId: it.product || null, quantity: it.quantity, price: it.price, listPrice: it.listPrice,
    })),
    orderDiscount: order.discount,
    orderTax: order.tax,
    isB2B: order.buyer?.type === 'enterprise',
    specialSourcing: !!ctx.flag?.specialSourcing,
  }, rules);

  const month = await ctx.months.landing(paidMonth, ctx.now);
  const shares = earners.map((e) => e.share);
  const rows = [];
  for (const c of components) {
    const split = earners.length === 1 ? [c.centi] : allocate(c.centi, shares);
    const flatSplit = earners.length === 1 ? [c.flatCenti] : allocate(c.flatCenti, shares);
    earners.forEach((e, i) => {
      rows.push({
        key: `earn:${order._id}:r${rev}:${c.component}:${c.lineId || 'order'}:${e.earnerKey}`,
        type: 'earn', month,
        earnerKey: e.earnerKey, earnerUser: e.user, earnerRep: e.rep, earnerName: e.name, share: e.share,
        order: order._id, orderNumber: orderRef(order), rev, lineId: c.lineId, component: c.component,
        centi: split[i], flatCenti: flatSplit[i], rulesVersion: version,
        inputs: { ...snapshot, ...c.detail, paidVia: proof.via, paidMonth, landedLate: month !== paidMonth },
        eventAt: proof.paidAt,
      });
    });
  }
  return { proof, rows };
}

/**
 * Insert rows; a duplicate key means "already written" and is not an error.
 * Returns how many were inserted and the inserted rows when EVERY row went in
 * (`docs`), else null — then the caller must re-read, because a concurrent
 * writer won some keys and its rows are the ones that count.
 */
async function insertIgnoringDuplicates(rows) {
  if (!rows.length) return { count: 0, docs: [] };
  try {
    const res = await repo.insertLedgerRows(rows);
    return { count: res.length, docs: res.map((d) => (d.toObject ? d.toObject() : d)) };
  } catch (err) {
    const writeErrors = err?.writeErrors || err?.result?.writeErrors || [];
    const nonDup = writeErrors.filter((w) => (w.code ?? w.err?.code) !== 11000);
    if (err?.code === 11000 && !writeErrors.length) return { count: 0, docs: null };
    if (!writeErrors.length || nonDup.length) throw err;
    return { count: (err.insertedDocs || []).length, docs: null };
  }
}

/** Fraction (0–1) of each line gone by return or cancellation, plus the whole-order flag. */
export function lineGoneFractions(order, returns, paidAt, rules) {
  const qty = new Map((order.items || []).map((it) => [String(it._id), Number(it.quantity) || 0]));
  const gone = new Map();
  const events = [];
  const add = (lineId, q, reason, at) => {
    if (!lineId || !qty.has(lineId)) return;
    gone.set(lineId, { q: (gone.get(lineId)?.q || 0) + q, reason, at });
    events.push({ reason, at });
  };
  const windowMs = (rules.returnWindowDays || 0) * DAY;
  for (const r of returns) {
    if (r.status !== 'refunded') continue;
    if (paidAt && new Date(r.createdAt) - new Date(paidAt) > windowMs) continue;
    for (const it of r.items || []) {
      let lineId = it.orderItemId ? String(it.orderItemId) : null;
      if (!lineId) {
        const match = (order.items || []).find((l) => String(l.product) === String(it.product)
          && String(l.variantId || '') === String(it.variantId || ''));
        lineId = match ? String(match._id) : null;
      }
      add(lineId, Number(it.quantity) || 0, 'return', r.refund?.completedAt || r.updatedAt || r.createdAt);
    }
  }
  for (const c of order.cancellations || []) {
    for (const l of c.lines || []) add(String(l.itemId), Number(l.quantity) || 0, 'cancel', c.cancelledAt || order.updatedAt);
  }
  const fractions = new Map();
  for (const [lineId, total] of qty) {
    const g = gone.get(lineId);
    fractions.set(lineId, g && total > 0 ? { f: Math.min(1, g.q / total), reason: g.reason, at: g.at } : { f: 0 });
  }
  // A whole-order refund counts in full — UNLESS it came from returns, in which
  // case the per-line rule above applies (a return after the window keeps its points
  // even though returnRefundService flips paymentStatus to 'refunded').
  const refundedByReturn = returns.some((r) => r.status === 'refunded');
  const whole = order.status === 'cancelled' || (order.paymentStatus === 'refunded' && !refundedByReturn);
  const allLinesGone = [...fractions.values()].every((v) => v.f >= 1);
  return { fractions, whole, allLinesGone, events };
}

/**
 * Bring one order's ledger rows up to date. Safe to call any number of times.
 * @returns {{ earned:number, reversed:number }}
 */
export async function processOrder(order, ctx) {
  // The sweep preloads every order's rows in one query per batch (ctx.ledger);
  // a single-order call (admin flag toggle) reads its own.
  const existing = ctx.ledger || await repo.ledgerForOrder(order._id);
  const { proof, rows } = await desiredEarnRows(order, ctx);
  const desiredKeys = new Set(rows.map((r) => r.key));
  const existingKeys = new Set(existing.filter((e) => e.type === 'earn').map((e) => e.key));
  // A row only becomes "desired" if this order is still verified-paid. When it is
  // not (refunded / cancelled), the existing earn rows stay the reference set.
  const ins = proof.verified ? await insertIgnoringDuplicates(rows.filter((r) => !existingKeys.has(r.key))) : { count: 0, docs: [] };
  const earnedNow = ins.count;

  // Clean insert: we know exactly what is there now. A raced insert: re-read.
  const all = ins.docs ? [...existing, ...ins.docs] : await repo.ledgerForOrder(order._id);
  const earns = all.filter((e) => e.type === 'earn');
  if (!earns.length) return { earned: earnedNow, reversed: 0 };
  const reversedBy = new Map();
  for (const e of all) {
    if (e.type !== 'reverse') continue;
    const r = reversedBy.get(e.reverses) || { centi: 0, flatCenti: 0, n: 0 };
    r.centi += -e.centi; r.flatCenti += -e.flatCenti; r.n += 1;
    reversedBy.set(e.reverses, r);
  }

  const paidAt = proof.paidAt || earns[0].eventAt;
  const { rules } = await ctx.getRules(monthOf(paidAt));
  const gone = lineGoneFractions(order, ctx.returns || [], paidAt, rules);

  const out = [];
  for (const e of earns) {
    let fraction = 0; let reason = null; let at = ctx.now;
    if (proof.verified && rows.length && !desiredKeys.has(e.key)) {
      fraction = 1; reason = 'recompute';
    } else if (gone.whole) {
      fraction = 1; reason = order.status === 'cancelled' ? 'cancel' : 'refund';
    } else if (e.lineId) {
      const g = gone.fractions.get(e.lineId);
      if (g?.f) { fraction = g.f; reason = g.reason; at = g.at || ctx.now; }
    } else if (gone.allLinesGone) {
      fraction = 1; reason = gone.events.at(-1)?.reason || 'return'; at = gone.events.at(-1)?.at || ctx.now;
    }
    if (!fraction) continue;
    const target = fraction >= 1 ? e.centi : roundHalfAway(e.centi * fraction);
    const targetFlat = fraction >= 1 ? e.flatCenti : roundHalfAway(e.flatCenti * fraction);
    const done = reversedBy.get(e.key) || { centi: 0, flatCenti: 0, n: 0 };
    const delta = target - done.centi;
    const deltaFlat = targetFlat - done.flatCenti;
    if (delta <= 0 && deltaFlat <= 0) continue;
    const earnMonthStatus = await ctx.months.get(e.month);
    out.push({
      key: `rev:${e.key}:${done.n + 1}`, type: 'reverse',
      month: earnMonthStatus === 'open' ? e.month : await ctx.months.landing(monthOf(ctx.now), ctx.now),
      earnerKey: e.earnerKey, earnerUser: e.earnerUser, earnerRep: e.earnerRep, earnerName: e.earnerName, share: e.share,
      order: e.order, orderNumber: e.orderNumber, rev: e.rev, lineId: e.lineId, component: e.component,
      centi: -Math.max(0, delta), flatCenti: -Math.max(0, deltaFlat), rulesVersion: e.rulesVersion,
      inputs: { fraction, earnMonth: e.month }, eventAt: at ? new Date(at) : ctx.now, reverses: e.key, reason,
    });
  }
  const reversed = (await insertIgnoringDuplicates(out)).count;
  return { earned: earnedNow, reversed };
}

/** Load the per-order context rows for a batch of orders in four queries. */
export async function loadBatchContext(orders) {
  const ids = orders.map((o) => o._id);
  const [payments, transfers, flags, returns, ledger] = await Promise.all([
    repo.paymentsFor(ids), repo.confirmedTransfersFor(ids), repo.flagsFor(ids), repo.refundedReturnsFor(ids),
    repo.ledgerForOrders(ids),
  ]);
  const group = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const k = String(r.order);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  };
  return {
    payments: group(payments), transfers: group(transfers), returns: group(returns), ledger: group(ledger),
    flags: new Map(flags.map((f) => [String(f.order), f])),
  };
}

export const { ORDER_FIELDS } = repo;

/**
 * The scheduled sweep. Looks at sales orders paid in the last `lookbackDays`
 * (long enough for the return window plus refund processing), in batches.
 */
export async function runSweep({ now = new Date(), lookbackDays = 120, batchSize = 200, log = console } = {}) {
  const since = new Date(now.getTime() - lookbackDays * DAY);
  const shared = { getRules: rulesCache(), months: monthStatusCache(), now, cache: { users: new Map(), reps: new Map() } };
  let after = null;
  const totals = { orders: 0, earned: 0, reversed: 0, failed: 0 };
  for (;;) {
    const orders = await repo.salesOrdersPage({ from: since, after, limit: batchSize });
    if (!orders.length) break;
    const b = await loadBatchContext(orders);
    for (const order of orders) {
      const k = String(order._id);
      try {
        const r = await processOrder(order, {
          ...shared, payments: b.payments.get(k) || [], transfers: b.transfers.get(k) || [],
          returns: b.returns.get(k) || [], flag: b.flags.get(k) || null, ledger: b.ledger.get(k) || [],
        });
        totals.earned += r.earned; totals.reversed += r.reversed;
      } catch (err) {
        totals.failed += 1;
        log.error?.(`[Incentives] order ${k} failed: ${err.message}`);
      }
      totals.orders += 1;
    }
    after = orders[orders.length - 1];
    if (orders.length < batchSize) break;
  }
  return totals;
}

/** Re-run one order now (admin toggled a flag). */
export async function processOrderById(orderId, now = new Date()) {
  if (!mongoose.isValidObjectId(orderId)) return { earned: 0, reversed: 0 };
  const order = await repo.orderById(orderId);
  if (!order) return { earned: 0, reversed: 0 };
  const b = await loadBatchContext([order]);
  const k = String(order._id);
  return processOrder(order, {
    getRules: rulesCache(), months: monthStatusCache(), now, cache: {},
    payments: b.payments.get(k) || [], transfers: b.transfers.get(k) || [],
    returns: b.returns.get(k) || [], flag: b.flags.get(k) || null, ledger: b.ledger.get(k) || [],
  });
}
