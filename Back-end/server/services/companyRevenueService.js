/**
 * Company revenue — the admin-only "how much did the whole company sell" figure.
 *
 *   Revenue = Zoho Books invoices, net of credit notes
 *           + panel orders (website + old WooCommerce + sales panel) not billed in Zoho
 *           + money received with no sale bill yet (services/unbilledReceiptService.js).
 *
 * Every sale is counted once (config/companyRevenue.js). Both parts are
 * INCLUDING GST: Order.totalAmount is what the customer paid, and the Zoho
 * invoice Total is incl. GST. Zoho's ex-GST SubTotal is reported alongside.
 *
 * Sales = Zoho invoices still a sale after credit notes + those panel orders.
 *
 * Nothing here is cached; the 30 s header cache lives in routes/adminStats.js.
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import ZohoInvoice from '../models/ZohoInvoice.js';
import ZohoCreditNote from '../models/ZohoCreditNote.js';
import AppError from '../utils/AppError.js';
import { countedOrderFilter } from './revenueOrderFilter.js';
import { currentFiscalYear } from '../utils/storeTime.js';
import { QUERY_TIMEOUTS } from '../config/db.js';
import { MATCH_TOLERANCE, MATCH_ORDER_SCAN_CAP, ZOHO_REPLACES_ORDER_STATES } from '../config/companyRevenue.js';
import OrderExtraCharge from '../models/OrderExtraCharge.js';
import orderExtraChargeRepository from '../repositories/orderExtraChargeRepository.js';
import {
  readZohoCsv, zohoExportKind, parseZohoInvoiceCsv, parseZohoCreditNoteCsv, matchInvoicesToOrders, nameKey,
} from './zohoInvoiceInput.js';
import { unbilledRevenue, importZohoPayments } from './unbilledReceiptService.js';

const DAY_MS = 864e5;
const TZ = '+05:30';
const PANEL_SOURCES = ['web', 'woocommerce', 'offline'];
const round2 = (n) => Math.round((n || 0) * 100) / 100;

export { countedOrderFilter };

/** Resolve the window: 'fy' (default, current Indian financial year) or 'all'. */
export function resolvePeriod(kind = 'fy') {
  if (kind === 'all') return { kind: 'all', label: 'All time', from: null, startDate: null };
  const fy = currentFiscalYear();
  return { kind: 'fy', label: fy.label, from: fy.start, startDate: fy.startDate };
}

/**
 * Panel orders a Zoho invoice stands for (linked or probably-linked). Bounded by
 * the invoice count; read once per summary.
 */
async function ordersBilledInZoho() {
  return ZohoInvoice.distinct('match.order', {
    'match.state': { $in: [...ZOHO_REPLACES_ORDER_STATES] },
    'match.order': { $type: 'objectId' },
  }).maxTimeMS(QUERY_TIMEOUTS.aggregation);
}

/** Counted panel orders that are not billed in Zoho. */
const panelNotInZoho = (from, billed) => ({ ...countedOrderFilter(from), ...(billed.length ? { _id: { $nin: billed } } : {}) });

async function panelRevenue(from, billed, { months }) {
  const _id = {
    source: { $ifNull: ['$source', 'web'] },
    status: '$status',
    ...(months ? { month: { $dateToString: { date: '$createdAt', format: '%Y-%m', timezone: TZ } } } : {}),
  };
  // One pass over the { status, createdAt } index: revenue, sales and delivered all come from it.
  const [rows, extraCharges] = await Promise.all([
    Order.aggregate([
      { $match: panelNotInZoho(from, billed) },
      { $group: { _id, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
    ]).option({ maxTimeMS: QUERY_TIMEOUTS.aggregation }),
    // Extra charges paid on panel orders, except orders billed in Zoho (their invoice already holds them).
    OrderExtraCharge.aggregate([
      { $match: { ...orderExtraChargeRepository.keptMatch(from || new Date(0), null), ...(billed.length ? { order: { $nin: billed } } : {}) } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]).option({ maxTimeMS: QUERY_TIMEOUTS.aggregation }),
  ]);
  return { rows, extraCharges: extraCharges[0]?.total || 0 };
}

/** Net of Zoho credit notes: a bill fully credited (cancelled) is not a sale. */
const ZOHO_NET_STAGE = {
  $set: {
    net: { $max: [0, { $subtract: ['$total', { $ifNull: ['$credited', 0] }] }] },
    netExGst: { $max: [0, { $subtract: ['$subTotal', { $ifNull: ['$creditedExGst', 0] }] }] },
  },
};
const zohoIsSale = { $gt: ['$net', MATCH_TOLERANCE.sureAmountRupees] };

async function zohoRevenue(from, { months }) {
  const _id = months
    ? { state: '$match.state', month: { $dateToString: { date: '$invoiceDate', format: '%Y-%m', timezone: TZ } } }
    : { state: '$match.state' };
  return ZohoInvoice.aggregate([
    { $match: from ? { invoiceDate: { $gte: from } } : {} },
    ZOHO_NET_STAGE,
    {
      $group: {
        _id,
        total: { $sum: '$net' },
        subTotal: { $sum: '$netExGst' },
        credited: { $sum: { $ifNull: ['$credited', 0] } },
        unpaid: { $sum: '$balance' },
        count: { $sum: { $cond: [zohoIsSale, 1, 0] } },
        cancelled: { $sum: { $cond: [zohoIsSale, 0, 1] } },
      },
    },
  ]).option({ maxTimeMS: QUERY_TIMEOUTS.aggregation });
}

/**
 * The full picture for one window.
 *   sales           = every counted panel order + every Zoho-only bill still a sale
 *   ordersFulfilled = the delivered part of that (Zoho bills count: a tax invoice is issued on supply)
 * @param {{ period?: 'fy'|'all', months?: boolean }} opts
 */
export async function companyRevenueSummary({ period = 'fy', months = true } = {}) {
  const p = resolvePeriod(period);
  const billed = await ordersBilledInZoho();
  const [panel, zoho, unbilled, lastImport] = await Promise.all([
    panelRevenue(p.from, billed, { months }),
    zohoRevenue(p.from, { months }),
    unbilledRevenue(p.from, { months }),
    months
      ? ZohoInvoice.findOne({ importedAt: { $type: 'date' } }).sort({ importedAt: -1 }).select('importedAt importedByName').lean()
        .maxTimeMS(QUERY_TIMEOUTS.listing)
      : null,
  ]);

  const bySource = Object.fromEntries(PANEL_SOURCES.map((s) => [s, { total: 0, count: 0 }]));
  const byStatus = { delivered: 0, shipped: 0, processing: 0 };
  for (const r of panel.rows) {
    const s = bySource[r._id.source] ? r._id.source : 'web';
    bySource[s].total += r.total;
    bySource[s].count += r.count;
    byStatus[r._id.status === 'delivered' || r._id.status === 'shipped' ? r._id.status : 'processing'] += r.count;
  }
  const panelOrders = PANEL_SOURCES.reduce((a, s) => a + bySource[s].total, 0);
  const panelCount = PANEL_SOURCES.reduce((a, s) => a + bySource[s].count, 0);
  const websiteTotal = panelOrders + panel.extraCharges;

  const ZERO = { total: 0, subTotal: 0, credited: 0, unpaid: 0, count: 0, cancelled: 0 };
  const add = (a, r) => ({
    total: a.total + r.total, subTotal: a.subTotal + r.subTotal, credited: a.credited + r.credited,
    unpaid: a.unpaid + r.unpaid, count: a.count + r.count, cancelled: a.cancelled + r.cancelled,
  });
  const zohoBy = (state) => zoho.filter((r) => r._id.state === state).reduce(add, ZERO);
  const counted = zoho.reduce(add, ZERO);
  const linked = zohoBy('linked');
  const needsCheck = zohoBy('needs_check');

  const out = {
    period: { kind: p.kind, label: p.label, startDate: p.startDate },
    basis: 'incl_gst',
    revenue: {
      total: round2(websiteTotal + counted.total + unbilled.summary.total),
      website: {
        total: round2(websiteTotal),
        extraCharges: round2(panel.extraCharges),
        bySource: Object.fromEntries(PANEL_SOURCES.map((s) => [s, { total: round2(bySource[s].total), count: bySource[s].count }])),
      },
      zoho: {
        total: round2(counted.total),
        exGst: round2(counted.subTotal),
        creditNotes: round2(counted.credited),
        unpaid: round2(counted.unpaid),
        count: counted.count,
      },
      // Money in, no Zoho invoice yet — counted, shown apart (config/companyRevenue.js).
      unbilled: unbilled.summary,
    },
    sales: {
      total: panelCount + counted.count + unbilled.summary.count,
      website: { total: panelCount, ...byStatus },
      zoho: counted.count,
      zohoCancelled: counted.cancelled,
      unbilled: unbilled.summary.count,
    },
    ordersFulfilled: { total: byStatus.delivered + counted.count, website: byStatus.delivered, zoho: counted.count },
    // Zoho bills that stand for a panel order (that order is not added again).
    zohoMatched: {
      linked: { count: linked.count, total: round2(linked.total) },
      needsCheck: { count: needsCheck.count, total: round2(needsCheck.total) },
    },
  };

  if (months) {
    const map = new Map();
    const row = (m) => {
      if (!map.has(m)) map.set(m, { month: m, website: 0, zoho: 0, unbilled: 0, total: 0, sales: 0, ordersFulfilled: 0, needsCheck: 0 });
      return map.get(m);
    };
    for (const r of panel.rows) {
      const m = row(r._id.month);
      m.website += r.total;
      m.sales += r.count;
      if (r._id.status === 'delivered') m.ordersFulfilled += r.count;
    }
    for (const r of zoho) {
      const m = row(r._id.month);
      m.zoho += r.total; m.sales += r.count; m.ordersFulfilled += r.count;
      if (r._id.state === 'needs_check') m.needsCheck += r.count;
    }
    for (const r of unbilled.rows) {
      const m = row(r._id.month);
      m.unbilled += r.total; m.sales += r.count;
    }
    out.months = [...map.values()]
      .map((m) => ({
        ...m, website: round2(m.website), zoho: round2(m.zoho), unbilled: round2(m.unbilled), total: round2(m.website + m.zoho + m.unbilled),
      }))
      .sort((x, y) => x.month.localeCompare(y.month));
    out.lastImport = lastImport ? { at: lastImport.importedAt, byName: lastImport.importedByName || null } : null;
  }
  return out;
}

/** Header figures (FY to date): revenue with its hover breakdown, and sales with theirs. */
export async function companyHeaderFigures() {
  const fy = await companyRevenueSummary({ period: 'fy', months: false });
  return {
    companyRevenue: {
      total: fy.revenue.total,
      zoho: fy.revenue.zoho.total,
      zohoExGst: fy.revenue.zoho.exGst,
      panelNotInZoho: fy.revenue.website.total,
      creditNotes: fy.revenue.zoho.creditNotes,
      unbilled: fy.revenue.unbilled.total,
      basis: 'incl_gst',
      period: fy.period,
      needsCheck: fy.zohoMatched.needsCheck,
    },
    sales: { ...fy.sales, fyLabel: fy.period.label },
  };
}

const SALE_SOURCES = ['web', 'woocommerce', 'offline', 'zoho'];

/**
 * Every sale in the window, newest first: panel orders and Zoho-only bills in one
 * list (keyset cursor on date + id, bounded page). The same rules as the totals.
 */
export async function listCompanySales({ period = 'fy', source, cursor, limit = 50 } = {}) {
  const p = resolvePeriod(period);
  const size = Math.min(Math.max(Number(limit) || 50, 1), 100);
  if (source && !SALE_SOURCES.includes(source)) throw new AppError('Unknown source.', 400, { expose: true });
  let before = null;
  if (cursor) {
    const [d, id] = String(cursor).split('_');
    const at = new Date(Number(d));
    if (!Number.isFinite(at.getTime()) || !mongoose.isValidObjectId(id)) throw new AppError('Bad cursor.', 400, { expose: true });
    before = { at, id: new mongoose.Types.ObjectId(id) };
  }
  const billed = source === 'zoho' ? [] : await ordersBilledInZoho();
  // Pushed into each branch so both use their date index, not a post-union filter.
  const keyset = (field) => (before ? [{ $match: { $or: [{ [field]: { $lt: before.at } }, { [field]: before.at, _id: { $lt: before.id } }] } }] : []);
  const window = (field) => (p.from ? { [field]: { $gte: p.from } } : {});

  const panelBranch = [
    { $match: { ...panelNotInZoho(p.from, billed), ...(source && source !== 'zoho' ? (source === 'web' ? { source: { $in: ['web', null] } } : { source }) : {}) } },
    ...keyset('createdAt'),
    { $sort: { createdAt: -1, _id: -1 } },
    { $limit: size + 1 },
    {
      $project: {
        _id: 1, date: '$createdAt', amount: '$totalAmount', status: 1, kind: 'order',
        source: { $ifNull: ['$source', 'web'] }, name: '$shippingAddress.fullName',
      },
    },
  ];
  const zohoBranch = [
    { $match: window('invoiceDate') },
    ...keyset('invoiceDate'),
    ZOHO_NET_STAGE,
    { $sort: { invoiceDate: -1, _id: -1 } },
    { $limit: size + 1 },
    {
      $project: {
        _id: 1, date: '$invoiceDate', amount: '$net', gross: '$total', credited: { $ifNull: ['$credited', 0] }, kind: 'zoho', source: 'zoho',
        status: { $cond: [zohoIsSale, '$status', 'cancelled_by_credit_note'] }, name: '$customerName', number: '$invoiceNumber', unpaid: '$balance',
      },
    },
  ];

  let rows;
  if (source === 'zoho') {
    rows = await ZohoInvoice.aggregate(zohoBranch).option({ maxTimeMS: QUERY_TIMEOUTS.aggregation });
  } else if (source) {
    rows = await Order.aggregate(panelBranch).option({ maxTimeMS: QUERY_TIMEOUTS.aggregation });
  } else {
    rows = await Order.aggregate([
      ...panelBranch,
      { $unionWith: { coll: ZohoInvoice.collection.name, pipeline: zohoBranch } },
      { $sort: { date: -1, _id: -1 } },
      { $limit: size + 1 },
    ]).option({ maxTimeMS: QUERY_TIMEOUTS.aggregation });
  }
  const more = rows.length > size;
  const page = (more ? rows.slice(0, size) : rows).map((r) => ({ ...r, amount: round2(r.amount) }));
  const last = page[page.length - 1];
  return { sales: page, nextCursor: more && last ? `${new Date(last.date).getTime()}_${last._id}` : null };
}

/**
 * Re-run the matcher over every invoice an admin has not decided. Deterministic,
 * so running it twice (or two imports racing) lands on the same answer.
 */
export async function rematchZohoInvoices() {
  const invoices = await ZohoInvoice.find({})
    .select('invoiceDate total customerKey reference match')
    .limit(MATCH_ORDER_SCAN_CAP)
    .lean()
    .maxTimeMS(QUERY_TIMEOUTS.import);
  if (!invoices.length) return { changed: 0 };

  const dates = invoices.map((i) => i.invoiceDate.getTime());
  const pad = MATCH_TOLERANCE.possibleDays * DAY_MS;
  const from = new Date(Math.min(...dates) - pad);
  const to = new Date(Math.max(...dates) + pad);
  const orders = await Order.find({ ...countedOrderFilter(from), createdAt: { $gte: from, $lte: to } })
    .select('totalAmount createdAt shippingAddress.fullName')
    .limit(MATCH_ORDER_SCAN_CAP)
    .lean()
    .maxTimeMS(QUERY_TIMEOUTS.import);

  const decisions = matchInvoicesToOrders(
    invoices.map((i) => ({
      key: String(i._id),
      invoiceDate: i.invoiceDate,
      total: i.total,
      customerKey: i.customerKey,
      reference: i.reference,
      adminDecided: i.match?.by === 'admin',
      adminOrderId: i.match?.order,
    })),
    orders.map((o) => ({ id: o._id, createdAt: o.createdAt, totalAmount: o.totalAmount, nameKey: nameKey(o.shippingAddress?.fullName) }))
  );

  const ops = [];
  const now = new Date();
  for (const inv of invoices) {
    const d = decisions.get(String(inv._id));
    if (!d) continue;
    const same = inv.match?.state === d.state && String(inv.match?.order || '') === String(d.orderId || '') && inv.match?.by === 'auto';
    if (same) continue;
    ops.push({
      updateOne: {
        // Never overwrite an admin decision made while this ran.
        filter: { _id: inv._id, 'match.by': { $ne: 'admin' } },
        update: {
          $set: { match: { state: d.state, by: 'auto', order: d.orderId || null, reason: d.reason, decidedBy: null, decidedAt: now } },
          $push: { history: { $each: [{ at: now, action: 'matched', note: `${d.state}: ${d.reason}`.slice(0, 300) }], $slice: -50 } },
        },
      },
    });
  }
  if (ops.length) await ZohoInvoice.bulkWrite(ops, { ordered: false });
  return { changed: ops.length, ordersConsidered: orders.length };
}

/**
 * Re-total every invoice's credit notes onto it. Recomputed from the credit-note
 * rows (never incremented), so re-importing either file can't double a refund.
 */
export async function applyZohoCredits() {
  const sums = await ZohoCreditNote.aggregate([
    { $match: { invoiceNumber: { $type: 'string' } } },
    { $group: { _id: '$invoiceNumber', total: { $sum: '$total' }, subTotal: { $sum: '$subTotal' } } },
  ]).option({ maxTimeMS: QUERY_TIMEOUTS.import });
  if (!sums.length) return { invoicesCredited: 0, unmatched: 0 };
  const res = await ZohoInvoice.bulkWrite(
    sums.map((c) => ({
      updateOne: { filter: { invoiceNumber: c._id }, update: { $set: { credited: round2(c.total), creditedExGst: round2(c.subTotal) } } },
    })),
    { ordered: false }
  );
  return { invoicesCredited: res.matchedCount, unmatched: sums.length - res.matchedCount };
}

async function importInvoices(rows, user) {
  const { invoices, skipped, errors } = parseZohoInvoiceCsv(null, rows);
  const batchId = crypto.randomBytes(6).toString('hex');
  const now = new Date();
  let inserted = 0;
  let updated = 0;
  if (invoices.length) {
    const res = await ZohoInvoice.bulkWrite(
      invoices.map((inv) => ({
        updateOne: {
          filter: { zohoInvoiceId: inv.zohoInvoiceId },
          update: {
            $set: { ...inv, batchId, importedAt: now, importedByName: user?.name || null },
            $setOnInsert: { match: { state: 'zoho_only', by: 'auto', order: null, reason: 'Not matched yet' } },
            $push: { history: { $each: [{ at: now, by: user?._id, byName: user?.name, action: 'imported', note: `Batch ${batchId}` }], $slice: -50 } },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    inserted = res.upsertedCount;
    updated = res.matchedCount;
  }
  const credits = await applyZohoCredits();
  const match = await rematchZohoInvoices();
  return { kind: 'invoices', batchId, inserted, updated, skipped, errors, rematched: match.changed, creditsUnmatched: credits.unmatched };
}

async function importCreditNotes(rows, user) {
  const { creditNotes, skipped, errors } = parseZohoCreditNoteCsv(null, rows);
  const now = new Date();
  let inserted = 0;
  let updated = 0;
  if (creditNotes.length) {
    const res = await ZohoCreditNote.bulkWrite(
      creditNotes.map((cn) => ({
        updateOne: {
          filter: { zohoCreditNoteId: cn.zohoCreditNoteId },
          update: { $set: { ...cn, importedAt: now, importedByName: user?.name || null } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    inserted = res.upsertedCount;
    updated = res.matchedCount;
  }
  const credits = await applyZohoCredits();
  return { kind: 'credit_notes', inserted, updated, skipped, errors, rematched: 0, creditsUnmatched: credits.unmatched };
}

/**
 * Import a Zoho export — the invoice, credit-note or payments-received list (told
 * apart by their columns). Same file twice = same rows (upsert by Zoho id).
 */
export async function importZohoExport(buffer, user) {
  const rows = readZohoCsv(buffer);
  const kind = zohoExportKind(rows);
  if (kind === 'credit_notes') return importCreditNotes(rows, user);
  if (kind === 'payments') return importZohoPayments(rows, user);
  return importInvoices(rows, user);
}

/** Invoices the matcher held back, plus the panel order it thinks they are. Bounded, cursor-paged. */
export async function listZohoInvoices({ state = 'needs_check', cursor, limit = 50 } = {}) {
  const size = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const q = { 'match.state': state };
  if (cursor) {
    const [d, id] = String(cursor).split('_');
    const at = new Date(Number(d));
    if (!Number.isFinite(at.getTime()) || !mongoose.isValidObjectId(id)) throw new AppError('Bad cursor.', 400, { expose: true });
    q.$or = [{ invoiceDate: { $lt: at } }, { invoiceDate: at, _id: { $lt: new mongoose.Types.ObjectId(id) } }];
  }
  const rows = await ZohoInvoice.find(q)
    .sort({ invoiceDate: -1, _id: -1 })
    .limit(size + 1)
    .select('-history')
    .populate({ path: 'match.order', select: 'totalAmount createdAt status source shippingAddress.fullName' })
    .lean()
    .maxTimeMS(QUERY_TIMEOUTS.listing);
  const more = rows.length > size;
  const page = more ? rows.slice(0, size) : rows;
  const last = page[page.length - 1];
  return { invoices: page, nextCursor: more && last ? `${last.invoiceDate.getTime()}_${last._id}` : null };
}

/**
 * An admin settles a doubtful invoice: 'same' (it is that panel order → not
 * counted again) or 'different' (a separate sale → counted). Survives re-imports.
 */
export async function decideZohoInvoice(id, { decision, orderId }, user) {
  if (!mongoose.isValidObjectId(id)) throw new AppError('Invoice not found.', 404, { expose: true });
  const inv = await ZohoInvoice.findById(id).select('match invoiceNumber').lean();
  if (!inv) throw new AppError('Invoice not found.', 404, { expose: true });

  let order = null;
  if (decision === 'same') {
    const target = orderId || inv.match?.order;
    if (!target || !mongoose.isValidObjectId(target)) throw new AppError('Choose the panel order it is the same as.', 400, { expose: true });
    order = await Order.findOne({ _id: target, ...countedOrderFilter(null) }).select('_id').lean();
    if (!order) throw new AppError('That panel order is not a counted sale.', 400, { expose: true });
    const taken = await ZohoInvoice.exists({ _id: { $ne: inv._id }, 'match.by': 'admin', 'match.state': 'linked', 'match.order': order._id });
    if (taken) throw new AppError('Another Zoho invoice is already confirmed as that order.', 409, { expose: true });
  }
  const now = new Date();
  const state = decision === 'same' ? 'linked' : 'zoho_only';
  const reason = decision === 'same' ? 'Admin: same sale as the panel order' : 'Admin: a separate sale';
  const updated = await ZohoInvoice.findByIdAndUpdate(
    inv._id,
    {
      $set: { match: { state, by: 'admin', order: order?._id || null, reason, decidedBy: user?._id, decidedAt: now } },
      $push: { history: { $each: [{ at: now, by: user?._id, byName: user?.name, action: 'matched', note: reason }], $slice: -50 } },
    },
    { new: true }
  ).select('-history').lean();
  return updated;
}
