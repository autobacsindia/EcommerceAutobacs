/**
 * Supplier deals — made-to-order items paid to the supplier in parts
 * (advance → … → balance). See models/SupplierDeal.js.
 *
 * ── WHO DOES WHAT ───────────────────────────────────────────────────────────────
 *   set up / change / remove a deal   procurement (and admin)
 *   raise each part                   procurement — an ordinary supplier payment
 *                                     request with `dealId` (paymentRequestService)
 *   approve / pay each part           accounts approves, the admin pays — unchanged
 *
 * ── THE MONEY RULES ─────────────────────────────────────────────────────────────
 *   paid        = Σ the deal's PAID requests
 *   waiting     = Σ its submitted / approved / on-hold requests
 *   balance due = agreed − paid
 *   left to ask = agreed − paid − waiting      (what the next request may be, at most)
 * All worked out here from the requests themselves; the client's numbers are
 * display only. A request that would take the asked-for total past the agreed
 * total is refused (`reserve` — one conditional $inc, so it holds under a race).
 * The agreed total can be changed with a reason, never below what is already asked for.
 */
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import supplierDealRepository from '../repositories/supplierDealRepository.js';
import paymentRequestRepository from '../repositories/paymentRequestRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import { orderNumber } from './invoiceService.js';
import { STAFF_TEAMS } from '../config/staff.js';
import { workflowView, STAGE } from '../utils/teamWorkflow.js';
import { variantDisplayName } from '../utils/orderLines.js';
import { toPaise, fromPaise } from '../utils/money.js';
import { BASE_CURRENCY, isCurrencyAllowed } from '../config/expenseCategories.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v == null ? '' : String(v._id ?? v));
const isObjectId = (v) => /^[a-f0-9]{24}$/i.test(String(v));

export const MAX_DEAL_RUPEES = 10000000; // ₹1 crore: the same typo guard as a payment request
export const MAX_DEAL_FOREIGN = 1000000000; // a foreign total: the same guard as a foreign bill

/*
  CURRENCY. A deal is agreed in one currency (₹, THB, USD…) and every part is
  raised in it. `agreedPaise` / `reservedPaise` are hundredths of THAT currency
  (satang for THB, cents for USD) — the names predate foreign deals. A foreign
  part's rupees are known only once it is paid (the admin records the bank debit),
  so the limits and the balance count in the deal's currency; the rupees actually
  debited are shown beside them.
*/
const currencyOf = (x) => (x?.currency && x.currency !== BASE_CURRENCY ? x.currency : BASE_CURRENCY);
/** What a request is worth in its own (= the deal's) currency. */
// The bill: the money moved plus any supplier credit used on it (models/PaymentRequest.js `credit`).
export const unitsOf = (r) => (currencyOf(r) === BASE_CURRENCY ? Number(r.amount) || 0 : Number(r.foreignAmount) || 0)
  + (Number(r.credit?.amount) || 0);
/** "₹29,000" / "THB 29,400" from hundredths. */
export const moneyOf = (minor, currency = BASE_CURRENCY) => {
  const n = fromPaise(minor).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return currency === BASE_CURRENCY ? `₹${n}` : `${currency} ${n}`;
};
/** 'YYYY-MM-DD' in India for a moment. */
const istDay = (d) => (d ? new Date(new Date(d).getTime() + 330 * 60000).toISOString().slice(0, 10) : '');
export const LIVE_STATUSES = Object.freeze(['submitted', 'approved', 'on_hold', 'paid']);
const WAITING = new Set(['submitted', 'approved', 'on_hold']);
/** The most deals one order's panel reads — far above any real order (one per item). */
const ORDER_DEAL_CAP = 50;

const STATUS_LABELS = Object.freeze({
  submitted: 'Waiting for accounts approval',
  approved: 'Approved — waiting for admin to pay',
  on_hold: 'On hold',
  paid: 'Paid',
  declined: 'Declined',
  cancelled: 'Cancelled',
});
export const PART_LABELS = Object.freeze({ advance: 'Advance', part: 'Part payment', balance: 'Balance', full: 'Full payment' });

// ── Who ───────────────────────────────────────────────────────────────────────
const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const mayManage = (u) => isAdmin(u) || (isActiveStaff(u) && u.staff.team === STAFF_TEAMS.PROCUREMENT);
const maySee = (u) => isAdmin(u) || isActiveStaff(u);

const entry = (actor, action, note = '') => ({
  at: new Date(), by: actor._id, byName: actor.name || '', action, note: String(note || '').slice(0, 1000),
});

// ── Input checks ───────────────────────────────────────────────────────────────

/** Agreed total → hundredths of the deal's currency. At least 1, at most two decimals, typo-guarded. */
export function cleanAgreed(value, currency = BASE_CURRENCY) {
  const s = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw fail('Enter the total agreed with the supplier (e.g. 29000).', 400);
  const n = Number(s);
  const max = currency === BASE_CURRENCY ? MAX_DEAL_RUPEES : MAX_DEAL_FOREIGN;
  if (!(n >= 1) || n > max) throw fail(currency === BASE_CURRENCY ? 'The agreed total must be between ₹1 and ₹1 crore.' : 'That total looks too large — check it.', 400);
  return toPaise(n);
}

/** The deal's currency, from the team's list (the same list as the expense form). */
export function cleanCurrency(value) {
  const c = String(value || BASE_CURRENCY).trim().toUpperCase();
  if (!isCurrencyAllowed(STAFF_TEAMS.PROCUREMENT, c)) throw fail('Choose a currency from the list.', 400);
  return c;
}

/** A calendar day 'YYYY-MM-DD', or '' (not given yet). */
export function cleanDay(value, label) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw fail(`Enter the ${label} as a date.`, 400);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw fail(`Enter the ${label} as a real date.`, 400);
  const year = d.getUTCFullYear();
  if (year < 2020 || year > 2100) throw fail(`Check the ${label} — the year looks wrong.`, 400);
  return s;
}

function checkDates(startDate, completionDate) {
  if (startDate && completionDate && completionDate < startDate) {
    throw fail('The completion date cannot be before the start date.', 400);
  }
}

const dayText = (s) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'not set');

// ── Views (the numbers, worked out from the requests) ───────────────────────────

/**
 * Each payment (oldest first) gets the balance left after it: agreed − the live parts
 * up to and including it. A declined / cancelled one takes nothing (null).
 */
function withBalanceAfter(agreedPaise, payments) {
  let asked = 0;
  return payments.map((p) => {
    if (p.status === 'declined' || p.status === 'cancelled') return { ...p, balanceAfter: null };
    asked += toPaise(p.amount);
    return { ...p, balanceAfter: fromPaise(Math.max(0, agreedPaise - asked)) };
  });
}

/** A deal and its requests → what the order page shows. Pure: tested directly. */
export function dealView(deal, requests = [], viewer = null) {
  const mine = requests.filter((r) => idOf(r.deal) === idOf(deal._id));
  const currency = currencyOf(deal);
  let paid = 0;
  let waiting = 0;
  let rupeesPaid = 0;
  let advancePaidAt = null;
  for (const r of mine) {
    if (r.status === 'paid') {
      paid += toPaise(unitsOf(r));
      rupeesPaid += toPaise(r.amount);
      const at = r.payment?.transactionAt || r.payment?.paidAt || null;
      if (at && (!advancePaidAt || new Date(at) < new Date(advancePaidAt))) advancePaidAt = at;
    } else if (WAITING.has(r.status)) waiting += toPaise(unitsOf(r));
  }
  const agreed = deal.agreedPaise;
  const open = deal.status === 'open';
  const leftToAsk = Math.max(0, agreed - paid - waiting);
  const hasWaiting = mine.some((r) => WAITING.has(r.status));
  return {
    id: idOf(deal._id),
    status: deal.status,
    itemIds: (deal.itemIds || []).map(idOf),
    itemNames: deal.itemNames || [],
    supplierName: deal.supplierName,
    // Every figure below is in this currency; `rupeesPaid` is what the bank actually debited.
    currency,
    rupeesPaid: fromPaise(rupeesPaid),
    agreedTotal: fromPaise(agreed),
    paid: fromPaise(paid),
    waiting: fromPaise(waiting),
    balanceDue: fromPaise(Math.max(0, agreed - paid)),
    leftToAsk: fromPaise(leftToAsk),
    fullyPaid: paid >= agreed,
    // The first payment's date: the supplier starts once the advance is in.
    advancePaidAt,
    startDate: deal.startDate || istDay(advancePaidAt),
    completionDate: deal.completionDate || '',
    createdByName: deal.createdByName || '',
    createdAt: deal.createdAt,
    // Oldest first: the payment timeline.
    payments: withBalanceAfter(agreed, [...mine].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)).map((r) => ({
      id: idOf(r._id),
      number: r.number,
      part: r.part || '',
      partLabel: PART_LABELS[r.part] || 'Payment',
      // In the deal's currency; `rupees` is the bank debit once a foreign part is paid (null before).
      amount: unitsOf(r),
      rupees: currency === BASE_CURRENCY ? r.amount : (Number(r.amount) > 0 ? r.amount : null),
      status: r.status,
      statusLabel: STATUS_LABELS[r.status] || r.status,
      createdAt: r.createdAt,
      approvedAt: r.approvedAt || null,
      paidAt: r.payment?.transactionAt || r.payment?.paidAt || null,
    }))),
    history: (deal.history || []).map((h) => ({ at: h.at, byName: h.byName, action: h.action, note: h.note })),
    can: {
      // One part in flight at a time: the line reads "Payment Pending" until it is paid.
      raise: open && mayManage(viewer) && leftToAsk > 0 && !hasWaiting,
      edit: open && mayManage(viewer),
      remove: open && mayManage(viewer) && paid + waiting === 0,
    },
  };
}

/**
 * Where ONE payment sits in its deal — what every screen and the PDF show beside it:
 *
 *   Agreed total THB 29,400 · this payment: Advance (1 of 1) THB 10,000
 *   paid before it THB 0 · balance after it THB 19,400
 *
 * Chronological: "before" and "after" count the deal's live parts (not declined /
 * cancelled) raised up to and including this one, so a payment's own slip reads
 * the same whenever it is opened. Pure: tested directly. Null when it is not on the deal.
 */
export function partSummary(deal, requests, requestId) {
  const v = dealView(deal, requests);
  const me = v.payments.find((p) => p.id === idOf(requestId));
  if (!me) return null;
  const isLive = (p) => p.status !== 'declined' && p.status !== 'cancelled';
  const live = v.payments.filter(isLive);
  const at = live.findIndex((p) => p.id === me.id);
  const before = at >= 0 ? live.slice(0, at) : live.filter((p) => +new Date(p.createdAt) < +new Date(me.createdAt));
  const sum = (list) => list.reduce((n, p) => n + toPaise(p.amount), 0);
  const paidBefore = sum(before.filter((p) => p.status === 'paid'));
  const waitingBefore = sum(before.filter((p) => p.status !== 'paid'));
  const upToMe = sum(before) + (isLive(me) ? toPaise(me.amount) : 0);
  return {
    dealId: v.id,
    dealStatus: v.status,
    supplierName: v.supplierName,
    itemNames: v.itemNames,
    currency: v.currency,
    agreedTotal: v.agreedTotal,
    partLabel: me.partLabel,
    // 1-based among the live parts; null for a declined / cancelled one.
    installment: at >= 0 ? at + 1 : null,
    installments: live.length,
    thisAmount: me.amount,
    // The bank debit for this payment once paid (a foreign part); rupees = amount for ₹.
    thisRupees: me.rupees,
    paidBefore: fromPaise(paidBefore),
    waitingBefore: fromPaise(waitingBefore),
    balanceAfter: fromPaise(Math.max(0, deal.agreedPaise - upToMe)),
    // The deal as it stands now.
    paidSoFar: v.paid,
    waiting: v.waiting,
    balanceDue: v.balanceDue,
    rupeesPaid: v.rupeesPaid,
    startDate: v.startDate,
    completionDate: v.completionDate,
  };
}

/**
 * partSummary for many payments at once (a list page, an order, a to-pay group):
 * two bounded reads however many payments — their deals, and those deals' parts.
 * Map requestId → summary; payments not on a deal are absent.
 */
export async function summariesFor(requests = []) {
  const onDeal = requests.filter((r) => r?.deal);
  const out = new Map();
  if (!onDeal.length) return out;
  const ids = [...new Set(onDeal.map((r) => idOf(r.deal)))];
  const [found, parts] = await Promise.all([supplierDealRepository.findByIds(ids), requestsFor(ids)]);
  const byId = new Map(found.map((d) => [idOf(d._id), d]));
  for (const r of onDeal) {
    const d = byId.get(idOf(r.deal));
    const s = d ? partSummary(d, parts, r._id) : null;
    if (s) out.set(idOf(r._id), s);
  }
  return out;
}

async function requestsFor(dealIds) {
  if (!dealIds.length) return [];
  return paymentRequestRepository.findForDeals(dealIds);
}

/** Deals on one order, with their numbers — for the order panel. Bounded. */
export async function forOrder(actor, orderId) {
  if (!maySee(actor)) throw fail('Not authorized.', 403);
  if (!isObjectId(orderId)) return [];
  const deals = await supplierDealRepository.findOpenForOrder(orderId, [], ORDER_DEAL_CAP);
  const requests = await requestsFor(deals.map((d) => d._id));
  return deals.map((d) => dealView(d, requests, actor));
}

async function loadDeal(id) {
  if (!isObjectId(id)) throw fail('Supplier deal not found.', 404);
  const deal = await supplierDealRepository.findById(id);
  if (!deal) throw fail('Supplier deal not found.', 404);
  return deal;
}

async function viewOf(deal, actor) {
  return dealView(deal, await requestsFor([deal._id]), actor);
}

/** One deal as the order page shows it (after a one-step set-up). */
export async function dealById(actor, id) {
  return viewOf(await loadDeal(id), actor);
}

// ── Set up / change / remove ─────────────────────────────────────────────────

/** Stages at which a supplier can still be making the item. */
const DEALABLE = new Set([STAGE.STOCK_CHECK, STAGE.TO_SHIP, STAGE.WITH_SUPPLIER]);

export async function create(actor, input = {}, req) {
  if (!mayManage(actor)) throw fail('Only procurement sets up a supplier deal.', 403);
  const order = isObjectId(input.orderId) ? await orderRepository.findForWorkflow(input.orderId) : null;
  const view = order && workflowView(order);
  if (!view) throw fail('Order not found in the team workflow.', 404);

  const raw = Array.isArray(input.itemIds) ? input.itemIds : [input.itemIds];
  const wanted = [...new Set(raw.filter(Boolean).map(String))];
  if (!wanted.length) throw fail('Choose the item(s) the supplier is making.', 400);
  const byId = new Map(view.lines.map((l) => [l.itemId, l]));
  for (const id of wanted) {
    const line = byId.get(id);
    if (!line) throw fail('That item is not on this order.', 400);
    if (line.stage === STAGE.OWN_STOCK) throw fail('This item ships from our warehouse — there is no supplier to pay.', 409);
    if (!DEALABLE.has(line.stage)) throw fail(`This item is "${line.stageLabel}" — a supplier deal is only for items not yet shipped.`, 409);
  }
  // A plain (one-off) supplier payment already covers it: one way to pay per item.
  const plain = await paymentRequestRepository.findLivePlainSupplier(order._id, wanted, LIVE_STATUSES);
  if (plain) throw fail(`${plain.number} already pays the supplier for this item. A deal can only be set up before the first payment.`, 409);

  const currency = cleanCurrency(input.currency);
  const agreedPaise = cleanAgreed(input.agreedTotal, currency);
  const supplierName = String(input.supplierName || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (supplierName.length < 2) throw fail('Enter the supplier making it.', 400);
  const startDate = cleanDay(input.startDate, 'manufacturing start date');
  const completionDate = cleanDay(input.completionDate, 'completion date');
  checkDates(startDate, completionDate);
  const note = String(input.note || '').trim();

  const items = (order.items || []).filter((i) => wanted.includes(idOf(i._id)));
  let deal;
  try {
    deal = await supplierDealRepository.create({
      order: order._id,
      orderNumber: orderNumber(order),
      itemIds: items.map((i) => i._id),
      itemNames: items.map((i) => variantDisplayName(i.name, i.variantLabel)),
      supplierName,
      currency,
      agreedPaise,
      startDate,
      completionDate,
      createdBy: actor._id,
      createdByName: actor.name || '',
      history: [entry(actor, 'created', [
        `Agreed ${moneyOf(agreedPaise, currency)} with ${supplierName}`,
        startDate ? `start ${dayText(startDate)}, completion ${dayText(completionDate)}` : `completion ${dayText(completionDate)}`,
        note,
      ].filter(Boolean).join(' — '))],
    });
  } catch (err) {
    // supplier_deal_open_item: someone set one up for the same item a moment ago.
    if (err?.code === 11000) throw fail('A supplier deal for this item already exists. Refresh the order.', 409);
    throw err;
  }
  auditLogger.logAction(req, 'CREATE', 'SupplierDeal', deal._id, { orderId: idOf(order._id), agreed: fromPaise(agreedPaise), currency });
  return viewOf(deal, actor);
}

/**
 * Change the agreed total and / or the dates. A reason is required — the history
 * is how accounts sees a supplier's delay or a re-priced job. The total can never
 * drop below what is already asked for (paid + waiting); compare-and-set on the
 * version read, so two edits at once cannot both land.
 */
export async function update(actor, id, input = {}, req) {
  if (!mayManage(actor)) throw fail('Only procurement changes a supplier deal.', 403);
  const d0 = await loadDeal(id);
  if (d0.status !== 'open') throw fail('This supplier deal was removed.', 409);
  const reason = String(input.note || '').trim();
  if (reason.length < 3) throw fail('Say why it changed (e.g. supplier delayed by a week).', 400);

  const cur = currencyOf(d0);
  const agreedPaise = input.agreedTotal != null && input.agreedTotal !== '' ? cleanAgreed(input.agreedTotal, cur) : d0.agreedPaise;
  const startDate = input.startDate !== undefined ? cleanDay(input.startDate, 'manufacturing start date') : d0.startDate || '';
  const completionDate = input.completionDate !== undefined ? cleanDay(input.completionDate, 'completion date') : d0.completionDate || '';
  checkDates(startDate, completionDate);

  const changes = [];
  if (agreedPaise !== d0.agreedPaise) changes.push(`agreed total ${moneyOf(d0.agreedPaise, cur)} → ${moneyOf(agreedPaise, cur)}`);
  if (startDate !== (d0.startDate || '')) changes.push(`start ${dayText(d0.startDate)} → ${dayText(startDate)}`);
  if (completionDate !== (d0.completionDate || '')) changes.push(`completion ${dayText(d0.completionDate)} → ${dayText(completionDate)}`);
  if (!changes.length) return viewOf(d0, actor);

  const deal = await supplierDealRepository.updateIf(d0._id,
    // reservedPaise ≤ the new total: never below what is already asked for.
    { status: 'open', updatedAt: d0.updatedAt, reservedPaise: { $lte: agreedPaise } },
    { $set: { agreedPaise, startDate, completionDate }, $push: { history: entry(actor, 'changed', `${changes.join(', ')} — ${reason}`) } });
  if (!deal) {
    const now = await loadDeal(id);
    if (now.reservedPaise > agreedPaise) {
      throw fail(`${moneyOf(now.reservedPaise, cur)} is already asked for or paid — the agreed total cannot be less than that.`, 409);
    }
    throw fail('This deal was just changed by someone else. Refresh to see it.', 409);
  }
  auditLogger.logAction(req, 'UPDATE', 'SupplierDeal', deal._id, { changes });
  return viewOf(deal, actor);
}

/** Remove a deal set up by mistake — only while nothing is asked for on it. */
export async function remove(actor, id, { note } = {}, req) {
  if (!mayManage(actor)) throw fail('Only procurement removes a supplier deal.', 403);
  const d0 = await loadDeal(id);
  const deal = await supplierDealRepository.updateIf(d0._id,
    { status: 'open', reservedPaise: 0 },
    { $set: { status: 'cancelled' }, $push: { history: entry(actor, 'removed', note) } });
  if (!deal) throw fail('A deal with a payment raised on it cannot be removed — decline or cancel that payment first.', 409);
  auditLogger.logAction(req, 'UPDATE', 'SupplierDeal', deal._id, { change: 'removed' });
  return { id: idOf(deal._id), status: deal.status };
}

/**
 * Undo a deal created a moment ago whose advance could not be raised (one-step
 * set-up): marked cancelled — never deleted — and only while nothing is reserved.
 */
export async function discard(dealId, reason) {
  try {
    await supplierDealRepository.updateIf(dealId, { status: 'open', reservedPaise: 0 },
      { $set: { status: 'cancelled' }, $push: { history: { at: new Date(), action: 'discarded', note: String(reason || '').slice(0, 1000) } } });
  } catch (err) {
    console.error(`[SupplierDeal] ${idOf(dealId)}: could not discard:`, err.message);
  }
}

// ── For paymentRequestService: the lock on the agreed total ─────────────────────

/**
 * The open deal a new part payment is raised on, checked against the order and
 * items. Returns the deal (lean).
 */
export async function dealForPayment(dealId, orderId) {
  const deal = await loadDeal(dealId);
  if (deal.status !== 'open') throw fail('This supplier deal was removed.', 409);
  if (idOf(deal.order) !== idOf(orderId)) throw fail('That supplier deal is for another order.', 400);
  return deal;
}

/**
 * Reserve `amountPaise` of the agreed total for a new request. One conditional
 * $inc: two requests raised at the same moment cannot together exceed the total.
 * Returns the deal as it was BEFORE (to name the part), or throws 409.
 */
export async function reserve(dealId, amountPaise) {
  const before = await supplierDealRepository.reserve(dealId, amountPaise);
  if (before) return before;
  const now = await supplierDealRepository.findById(dealId);
  if (!now || now.status !== 'open') throw fail('This supplier deal was removed.', 409);
  const left = Math.max(0, now.agreedPaise - now.reservedPaise);
  throw fail(left
    ? `That is more than the agreed total. Only ${moneyOf(left, currencyOf(now))} of ${moneyOf(now.agreedPaise, currencyOf(now))} is left to pay.`
    : `The agreed ${moneyOf(now.agreedPaise, currencyOf(now))} is already fully asked for — nothing is left to pay.`, 409);
}

/** Give back a reservation (the request was declined / cancelled, or failed to save). Never throws. */
export async function release(dealId, amountPaise, reason = '') {
  if (!dealId || !(amountPaise > 0)) return;
  try {
    // Floor at 0: a repeated release (a retry) must never push it negative.
    await supplierDealRepository.release(dealId, amountPaise);
  } catch (err) {
    console.error(`[SupplierDeal] ${idOf(dealId)}: could not release ${amountPaise} paise (${reason}):`, err.message);
  }
}

/** Which part this is, from the deal BEFORE the reservation. */
export function partFor(before, amountPaise) {
  // The whole agreed total in one payment is not a "balance" of anything.
  if (before.reservedPaise === 0 && amountPaise >= before.agreedPaise) return 'full';
  if (before.reservedPaise + amountPaise >= before.agreedPaise) return 'balance';
  return before.reservedPaise === 0 ? 'advance' : 'part';
}

// ── Shipping guard (teamWorkflowService via paymentRequestService) ───────────────

/**
 * A made-to-order item ships only once the supplier is paid in full (owner
 * decision 2026-11-05). Returns the message to refuse with, or null.
 */
export async function unpaidBalanceReason(orderId, itemIds = []) {
  if (!isObjectId(orderId)) return null;
  const ids = (itemIds || []).map(String).filter(Boolean);
  const deals = await supplierDealRepository.findOpenForOrder(orderId, ids, ORDER_DEAL_CAP);
  if (!deals.length) return null;
  const requests = await requestsFor(deals.map((d) => d._id));
  for (const d of deals) {
    const v = dealView(d, requests);
    if (!v.fullyPaid) {
      return `The supplier balance of ${moneyOf(toPaise(v.balanceDue), v.currency)} (of ${moneyOf(d.agreedPaise, v.currency)} agreed) is not paid yet — ship once it is paid.`;
    }
  }
  return null;
}
