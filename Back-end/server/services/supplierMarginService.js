/**
 * Minimum margin on what procurement buys for an order (owner, 2026-11-26).
 *
 *   • checkRequest   — run by paymentRequestService when a supplier payment for an
 *                      order is raised or edited. Works out the margin on the server
 *                      (never from client figures) and returns the snapshot stored on
 *                      the request. Below the minimum with no reason → refused, code
 *                      MARGIN_BELOW, with the numbers procurement needs.
 *   • refreshOrder   — rebuilds the order's rows in the Margins report cache
 *                      (models/OrderLineMargin.js). Idempotent; never throws.
 *   • settings       — the admin's minimum % (models/MarginConfig.js).
 *   • lines / products / totals / exceptions — the admin's Margins panel.
 *
 * The maths lives in utils/supplierMargin.js.
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import marginConfigRepository, { MARGIN_MIN_BP_MAX } from '../repositories/marginConfigRepository.js';
import orderLineMarginRepository from '../repositories/orderLineMarginRepository.js';
import paymentRequestRepository from '../repositories/paymentRequestRepository.js';
import supplierDealRepository from '../repositories/supplierDealRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import { DEFAULT_BUY_MIN_BP } from '../config/supplierPortal.js';
import { liveQuantityByItem } from '../utils/orderCancellation.js';
import { variantDisplayName } from '../utils/orderLines.js';
import { fromPaise } from '../utils/money.js';
import { orderNumber as orderNumberOf } from '../utils/invoiceFormat.js';
import {
  BASE_CURRENCY, MARGIN_REASON_MIN, cleanMarginReason, groupMargin, lineCosts, marginBp, maxCostPaise, pctText,
} from '../utils/supplierMargin.js';

const fail = (message, status, code) => Object.assign(new AppError(message, status, { expose: true }), code ? { code } : {});
const idOf = (v) => (v == null ? '' : String(v._id ?? v));
const isAdmin = (u) => u?.role === 'admin';
const rupees = (paise) => `₹${fromPaise(paise).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const MARGIN_BELOW = 'MARGIN_BELOW';
const PAGE_MAX = 100;

// ── The minimum ────────────────────────────────────────────────────────────────

/** The minimum margin in basis points: the admin's setting, else 30%. */
export async function minBp() {
  const doc = await marginConfigRepository.get();
  return Number.isInteger(doc?.minBp) ? doc.minBp : DEFAULT_BUY_MIN_BP;
}

export async function settings(actor) {
  if (!isAdmin(actor)) throw fail('Only the admin sees the margin settings.', 403);
  const doc = await marginConfigRepository.get();
  return {
    minPct: (Number.isInteger(doc?.minBp) ? doc.minBp : DEFAULT_BUY_MIN_BP) / 100,
    defaultPct: DEFAULT_BUY_MIN_BP / 100,
    updatedByName: doc?.updatedByName || '',
    updatedAt: doc?.updatedAt || null,
  };
}

export async function setSettings(actor, { minPct } = {}, req) {
  if (!isAdmin(actor)) throw fail('Only the admin changes the minimum margin.', 403);
  const n = Number(minPct);
  const bp = Math.round(n * 100);
  if (minPct === '' || minPct == null || !Number.isFinite(n) || bp < 0 || bp > MARGIN_MIN_BP_MAX || Math.abs(n * 100 - bp) > 1e-6) {
    throw fail(`Enter the minimum margin as a percent between 0 and ${MARGIN_MIN_BP_MAX / 100}, e.g. 30 or 27.5.`, 400);
  }
  const was = await minBp();
  await marginConfigRepository.setMinBp(bp, actor);
  auditLogger.logAction(req, 'UPDATE', 'MarginConfig', 'default', { minBp: { from: was, to: bp } });
  return settings(actor);
}

// ── The check on a supplier payment ────────────────────────────────────────────

async function dealsFor(requests, extraDeal) {
  const ids = [...new Set(requests.map((r) => idOf(r.deal)).filter(Boolean))];
  const rows = ids.length ? await supplierDealRepository.findByIds(ids) : [];
  const map = new Map(rows.map((d) => [idOf(d._id), d]));
  if (extraDeal) map.set(idOf(extraDeal._id), extraDeal);
  return map;
}

/**
 * The margin snapshot for a supplier payment being raised or edited.
 *
 * @param {object} p.order      the Order (as orderRepository.findForWorkflow reads it)
 * @param {object} p.request    the payment as it WILL be: { itemIds, partId, deal, amount,
 *                              currency, foreignAmount, credit, payee, number? }
 * @param {string} [p.exceptId] the payment's own id when editing (its old figures don't count)
 * @param {string} [p.reason]   procurement's reason, needed only when below the minimum
 * @param {string} [p.keptReason] the reason already on the payment (an edit keeps it)
 * @param {object} [p.deal]     the payment's deal, already read
 * @returns {Promise<object>} PaymentRequest.margin
 * @throws 422 MARGIN_BELOW when below the minimum and no reason was given
 */
export async function checkRequest({ order, request, exceptId = null, reason = '', keptReason = '', deal = null }) {
  const others = (await paymentRequestRepository.findCostsForOrder(order._id))
    .filter((r) => !exceptId || idOf(r._id) !== idOf(exceptId));
  const mine = { ...request, kind: 'supplier', status: 'submitted' };
  const requests = [...others, mine];
  const lines = lineCosts(order, requests, await dealsFor(requests, deal));
  const itemIds = (deal?.itemIds?.length ? deal.itemIds : request.itemIds || []).map(idOf);
  const min = await minBp();
  const g = groupMargin(lines, itemIds, min);
  const why = cleanMarginReason(reason) || cleanMarginReason(keptReason);
  if (g.below && why.length < MARGIN_REASON_MIN) {
    const most = maxCostPaise(g.salePaise, min);
    throw fail(
      `Margin is ${pctText(g.bp)} — below the ${pctText(min)} minimum. `
      + `The customer paid ${rupees(g.salePaise)} for this; supplier cost is ${rupees(g.costPaise)}. `
      + `To keep ${pctText(min)}, the supplier cost must be ${rupees(most)} or less (${rupees(Math.max(0, g.costPaise - most))} less). `
      + 'Get a better price, or write why we should buy at this price — accounts will be asked to approve it.',
      422, MARGIN_BELOW,
    );
  }
  return {
    salePaise: g.salePaise,
    costPaise: g.costPaise,
    bp: g.bp,
    minBp: min,
    below: g.below,
    reason: g.below ? why : '',
    checkedAt: new Date(),
    acceptedBy: null,
    acceptedByName: '',
    acceptedAt: null,
  };
}

/** "⚠️ Below margin: 25% (minimum 30%) — reason: …" for the chat / history, or ''. */
export function marginNote(m) {
  if (!m?.below) return '';
  return `⚠️ Below margin: ${pctText(m.bp)} (minimum ${pctText(m.minBp)}) — reason: “${String(m.reason || '').slice(0, 200)}”`;
}

// ── The report cache ───────────────────────────────────────────────────────────

/** Rebuild the order's Margins rows from its supplier payments. Logged, never thrown. */
export async function refreshOrder(orderId) {
  try {
    const order = await orderRepository.findForWorkflow(idOf(orderId));
    if (!order) return 0;
    const requests = await paymentRequestRepository.findCostsForOrder(order._id);
    const lines = lineCosts(order, requests, await dealsFor(requests));
    const live = liveQuantityByItem(order);
    const min = await minBp();
    const ops = [];
    const keep = [];
    for (const item of order.items || []) {
      const id = idOf(item._id);
      const l = lines.get(id);
      // No supplier cost (own stock, not bought yet), or nothing left to sell: no row.
      if (!l || order.status === 'cancelled' || !(live.get(id) > 0)) continue;
      keep.push(item._id);
      const bp = l.unknown ? null : marginBp(l.salePaise, l.costPaise);
      ops.push({
        updateOne: {
          filter: { order: order._id, itemId: item._id },
          update: {
            $set: {
              orderNumber: orderNumberOf(order) || '',
              orderDate: order.paidAt || order.createdAt || new Date(),
              product: item.product?._id || item.product || null,
              name: variantDisplayName(item.name, item.variantLabel) || '',
              quantity: item.quantity || 0,
              salePaise: l.salePaise,
              costPaise: l.costPaise,
              bp,
              minBp: min,
              below: bp != null && bp < min,
              refs: l.refs.slice(0, 20),
              suppliers: l.suppliers.slice(0, 20),
              cancelled: false,
            },
          },
          upsert: true,
        },
      });
    }
    if (ops.length) await orderLineMarginRepository.bulkWrite(ops);
    await orderLineMarginRepository.deleteOtherLines(order._id, keep);
    return ops.length;
  } catch (err) {
    console.error(`[Margins] could not refresh order ${idOf(orderId)}:`, err.message);
    return 0;
  }
}

// ── The admin's Margins panel ──────────────────────────────────────────────────

function mustBeAdmin(actor) {
  if (!isAdmin(actor)) throw fail('Only the admin sees margins.', 403);
}

/** 'YYYY-MM-DD' (India) → the instant that day starts; null when empty; 400 when not a date. */
function istDayStart(v, { endOfDay = false } = {}) {
  if (v == null || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw fail('Dates are YYYY-MM-DD.', 400);
  const t = Date.parse(`${v}T00:00:00+05:30`);
  if (!Number.isFinite(t)) throw fail('Dates are YYYY-MM-DD.', 400);
  return new Date(t + (endOfDay ? 86400000 : 0));
}

function dateRange({ from, to } = {}) {
  const a = istDayStart(from);
  const b = istDayStart(to, { endOfDay: true });
  if (a && b && a >= b) throw fail('The start date must be on or before the end date.', 400);
  return a || b ? { orderDate: { ...(a ? { $gte: a } : {}), ...(b ? { $lt: b } : {}) } } : {};
}

const limitOf = (v, d = 50) => Math.min(PAGE_MAX, Math.max(1, Number.parseInt(v, 10) || d));
const encode = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function decode(c) {
  if (!c) return null;
  try { return JSON.parse(Buffer.from(String(c), 'base64url').toString('utf8')); } catch { throw fail('That page link is out of date — reload the list.', 400); }
}
const oid = (v) => {
  if (!mongoose.isValidObjectId(v)) throw fail('That page link is out of date — reload the list.', 400);
  return new mongoose.Types.ObjectId(String(v));
};

const lineRow = (r) => ({
  id: idOf(r._id),
  orderId: idOf(r.order),
  orderNumber: r.orderNumber,
  orderDate: r.orderDate,
  itemId: idOf(r.itemId),
  productId: r.product ? idOf(r.product) : null,
  name: r.name,
  quantity: r.quantity,
  sale: fromPaise(r.salePaise),
  cost: fromPaise(r.costPaise),
  margin: fromPaise(r.salePaise - r.costPaise),
  marginPct: r.bp == null ? null : r.bp / 100,
  minPct: r.minBp / 100,
  below: Boolean(r.below),
  refs: r.refs || [],
  suppliers: r.suppliers || [],
});

/**
 * One page of order lines: `sort` 'newest' (default) or 'lowest' (lowest margin first),
 * optional date range on the order date, `below=1` for below-minimum only.
 * Keyset on (orderDate, _id) or (bp, _id). Lines whose cost is still unknown (bp null,
 * a foreign bill not yet paid) are listed under 'newest' only.
 */
export async function lines(actor, q = {}) {
  mustBeAdmin(actor);
  const limit = limitOf(q.limit);
  const sort = q.sort === 'lowest' ? 'lowest' : 'newest';
  const base = { ...dateRange(q), ...(q.below === '1' || q.below === true ? { below: true } : {}) };
  const after = decode(q.cursor);
  let filter = base;
  if (after) {
    const id = oid(after.id);
    if (sort === 'newest') {
      const d = new Date(after.d);
      filter = { $and: [base, { $or: [{ orderDate: { $lt: d } }, { orderDate: d, _id: { $lt: id } }] }] };
    } else {
      filter = { $and: [base, { $or: [{ bp: { $gt: after.bp } }, { bp: after.bp, _id: { $gt: id } }] }] };
    }
  }
  const order = sort === 'newest' ? { orderDate: -1, _id: -1 } : { bp: 1, _id: 1 };
  const query = sort === 'lowest' ? { $and: [filter, { bp: { $type: 'number' } }] } : filter;
  const rows = await orderLineMarginRepository.page(query, order, limit + 1);
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page.map(lineRow),
    nextCursor: more && last ? encode(sort === 'newest' ? { d: last.orderDate, id: idOf(last._id) } : { bp: last.bp, id: idOf(last._id) }) : null,
  };
}

/** Totals over a date range: sale, cost, margin ₹ and %, lines, below-minimum lines. */
export async function totals(actor, q = {}) {
  mustBeAdmin(actor);
  const [t] = await orderLineMarginRepository.aggregate([
    { $match: { ...dateRange(q), bp: { $type: 'number' } } },
    { $group: { _id: null, sale: { $sum: '$salePaise' }, cost: { $sum: '$costPaise' }, lines: { $sum: 1 }, below: { $sum: { $cond: ['$below', 1, 0] } } } },
  ]);
  const sale = t?.sale || 0;
  const cost = t?.cost || 0;
  const bp = marginBp(sale, cost);
  return {
    sale: fromPaise(sale), cost: fromPaise(cost), margin: fromPaise(sale - cost),
    marginPct: bp == null ? null : bp / 100, lines: t?.lines || 0, belowLines: t?.below || 0,
    minPct: (await minBp()) / 100,
  };
}

/**
 * Per product over a date range: units, sale, cost, margin ₹ and %, lowest margin first
 * (or `sort=sale` for the biggest sellers). Bounded: at most PAGE_MAX products per page,
 * keyset on (margin, productId) / (sale, productId) applied after the group.
 */
export async function products(actor, q = {}) {
  mustBeAdmin(actor);
  const limit = limitOf(q.limit);
  const bySale = q.sort === 'sale';
  const after = decode(q.cursor);
  const pipeline = [
    { $match: { ...dateRange(q), bp: { $type: 'number' }, product: { $type: 'objectId' } } },
    { $group: { _id: '$product', name: { $last: '$name' }, units: { $sum: '$quantity' }, lines: { $sum: 1 }, sale: { $sum: '$salePaise' }, cost: { $sum: '$costPaise' }, below: { $sum: { $cond: ['$below', 1, 0] } } } },
    { $match: { sale: { $gt: 0 } } },
    { $addFields: { bp: { $floor: { $divide: [{ $multiply: [{ $subtract: ['$sale', '$cost'] }, 10000] }, '$sale'] } } } },
  ];
  if (after) {
    const id = oid(after.id);
    pipeline.push({ $match: bySale
      ? { $or: [{ sale: { $lt: after.v } }, { sale: after.v, _id: { $gt: id } }] }
      : { $or: [{ bp: { $gt: after.v } }, { bp: after.v, _id: { $gt: id } }] } });
  }
  pipeline.push({ $sort: bySale ? { sale: -1, _id: 1 } : { bp: 1, _id: 1 } }, { $limit: limit + 1 });
  const rows = await orderLineMarginRepository.aggregate(pipeline);
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page.map((r) => ({
      productId: idOf(r._id), name: r.name, units: r.units, lines: r.lines,
      sale: fromPaise(r.sale), cost: fromPaise(r.cost), margin: fromPaise(r.sale - r.cost),
      marginPct: r.bp / 100, belowLines: r.below,
    })),
    nextCursor: more && last ? encode({ v: bySale ? last.sale : last.bp, id: idOf(last._id) }) : null,
  };
}

/** Below-margin supplier payments, newest first: who, which order, how far below, the reason, who decided. */
export async function exceptions(actor, q = {}) {
  mustBeAdmin(actor);
  const limit = limitOf(q.limit);
  const c = decode(q.cursor);
  const after = c ? { createdAt: new Date(c.d), _id: oid(c.id) } : null;
  const rows = await paymentRequestRepository.pageBelowMargin({ after, limit: limit + 1 });
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page.map((r) => ({
      id: idOf(r._id),
      number: r.number,
      status: r.status,
      orderId: r.order ? idOf(r.order) : null,
      orderNumber: r.orderNumber || '',
      items: r.itemNames || [],
      supplier: r.payee?.name || '',
      amount: r.amount,
      currency: r.currency || BASE_CURRENCY,
      requestedByName: r.requestedByName || '',
      createdAt: r.createdAt,
      sale: fromPaise(r.margin.salePaise),
      cost: fromPaise(r.margin.costPaise),
      marginPct: r.margin.bp == null ? null : r.margin.bp / 100,
      minPct: r.margin.minBp / 100,
      shortBy: fromPaise(Math.max(0, r.margin.costPaise - maxCostPaise(r.margin.salePaise, r.margin.minBp))),
      reason: r.margin.reason || '',
      acceptedByName: r.margin.acceptedByName || '',
      acceptedAt: r.margin.acceptedAt || null,
      decisionNote: r.status === 'declined' ? r.decisionNote || '' : '',
    })),
    nextCursor: more && last ? encode({ d: last.createdAt, id: idOf(last._id) }) : null,
  };
}
