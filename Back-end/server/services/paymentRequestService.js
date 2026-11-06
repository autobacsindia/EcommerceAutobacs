/**
 * Payment requests — the company paying a supplier for an order's item, or a
 * team's expense (each team's own list: config/expenseCategories.js). See
 * models/PaymentRequest.js for the states.
 *
 * ── WHO DOES WHAT (enforced here; the UI only reflects it) ──────────────────────
 *   raise a supplier request   procurement (and admin)
 *   raise an expense           operations, marketing (and admin)
 *   cancel                     the requester, or their team head — while submitted
 *   approve / decline          accounts (and admin) — every team's requests
 *   pay                        admin only — after accounts' approval; an admin may
 *                              also pay a waiting request directly (that approves it)
 *   put on hold                accounts or admin — a brake, on an approved request
 *   see                        admin and accounts: everything; a team: its own
 *
 * ── NO MONEY MOVES HERE ─────────────────────────────────────────────────────────
 * The admin pays from the company's Razorpay / bank and records the reference and
 * a screenshot. A direct RazorpayX payout can be added behind the same `pay`
 * step once that account exists — the states and checks stay as they are.
 *
 * ── ONCE ONLY ───────────────────────────────────────────────────────────────────
 * Every state change is a compare-and-set on the current status
 * (paymentRequestRepository.transition): a double click, or two people at once,
 * changes it once; the other is told it already moved.
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import paymentRequestRepository from '../repositories/paymentRequestRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import counterRepository from '../repositories/counterRepository.js';
import userRepository from '../repositories/userRepository.js';
import { putPrivateAsset, deletePrivateAsset, readPrivateAsset } from './storage/privateUploads.js';
import { checkAttachments } from './storage/attachmentCheck.js';
import { storeAll } from './storage/storeAll.js';
import { MAX_ATTACHMENT_BYTES } from '../config/attachments.js';
import { postSystemMessage } from './chatService.js';
import { orderNumber } from './invoiceService.js';
import { STAFF_TEAMS, STAFF_TEAM_LABELS, STAFF_TEAM_VALUES } from '../config/staff.js';
import {
  BASE_CURRENCY, MAX_FX_RATE, MIN_FX_RATE, categoriesFor, categoriesNamed, categoryLabel, expenseOptionsFor,
  filterCategories, findCategory, isCurrencyAllowed, noteRequiredFor,
} from '../config/expenseCategories.js';
import { workflowView, STAGE } from '../utils/teamWorkflow.js';
import { variantDisplayName } from '../utils/orderLines.js';
import { bankCodeLabel, cleanPayee, maskAccount, payKeyOf } from '../utils/payee.js';
import {
  and, amountOf, amountRange, isObjectId, istRange, keysetPage, plainQuery, searchClauses, searchWords,
} from '../utils/listQuery.js';
import * as suppliers from './supplierService.js';
import * as deals from './supplierDealService.js';
import { itemsCancelled } from './supplierAdvanceGuard.js';
import { toPaise } from '../utils/money.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v == null ? '' : String(v._id ?? v));

export const PAYMENT_FILES_FOLDER = 'payment-requests'; // a PRIVATE prefix (storage/assetScope.js)
export const MAX_PAYMENT_FILE_BYTES = MAX_ATTACHMENT_BYTES;
export const MAX_AMOUNT = 10000000; // ₹1 crore: a typo guard, not a business limit
// A foreign bill's typo guard: generous for currencies with large numbers (yen, rupiah).
export const MAX_FOREIGN_AMOUNT = 1000000000;
/**
 * Which teams may raise an expense: every one of them.
 *
 * It started as Operations and Marketing only, which meant GTM paid for its own
 * fuel and Procurement had no way to claim a courier charge — the rule did not
 * match how the company actually spends. Derived from STAFF_TEAM_VALUES rather
 * than listed, so a team added to config/staff.js can claim from the day it
 * exists instead of waiting for someone to remember this line.
 *
 * Who APPROVES and who PAYS is unchanged and lives below: accounts approves,
 * the admin pays. Widening who may ask does not widen who may decide.
 */
export const EXPENSE_TEAMS = Object.freeze([...STAFF_TEAM_VALUES]);
export const OPEN_STATUSES = Object.freeze(['submitted', 'approved', 'on_hold']);
const PAGE_SIZE = 25;

export const STATUS_LABELS = Object.freeze({
  submitted: 'Waiting for accounts approval',
  approved: 'Approved — waiting for admin to pay',
  on_hold: 'On hold',
  paid: 'Paid',
  declined: 'Declined',
  cancelled: 'Cancelled',
});

// ── Who ───────────────────────────────────────────────────────────────────────

const isAdmin = (u) => u?.role === 'admin';
const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
const onTeam = (u, team) => isActiveStaff(u) && u.staff.team === team;
const isAccounts = (u) => onTeam(u, STAFF_TEAMS.ACCOUNTS);
const seesAll = (u) => isAdmin(u) || isAccounts(u);
const roleOf = (u) => (isAdmin(u) ? 'admin' : u?.staff?.team || '');

/**
 * One rule for every request — any team's expense and Procurement's supplier
 * payments alike: ACCOUNTS approves or declines, the ADMIN pays.
 */
const mayDecide = (u) => isAdmin(u) || isAccounts(u);
const mayPay = (u) => isAdmin(u);
/*
  Hold is BOTH their business, which is why it is not simply `mayPay`.
  Accounts parks a request it has approved but does not want paid yet (the bill
  is queried, the funds arrive Friday); the admin parks one they are not ready
  to send. Either way it is a brake, never a payment, so sharing it cannot move
  money — and the one person who must not have it is the requester.
*/
const mayHold = (u) => mayDecide(u) || mayPay(u);

/*
  Editing. The person who raised a request (or their team head) may correct it,
  with no time limit, while it still waits for accounts (an approved amount is not changed under
  accounts' feet). The admin may edit anything not yet finished; if that changes
  the money (amount or who is paid) on an approved / held request, it goes back
  to accounts to approve again. Paid, declined and cancelled requests are
  financial records and are never edited.
*/
const EDITABLE = Object.freeze(['submitted', 'approved', 'on_hold']);
/*
  Who may edit (owner decision 2026-11-06, "edit everywhere for what we created"):
  whoever raised it, their team head, or the admin — until it is PAID. Once accounts
  has approved it, any change to the money or to who is paid sends it back to accounts
  to approve again (update → backToAccounts); a wording-only change stays approved.
  A paid request is locked: a wrong amount is corrected with a new entry, and the
  admin can still correct the payment record (editPayment).
*/
const mayEdit = (u, r) => EDITABLE.includes(r.status) && (
  isAdmin(u)
  || idOf(r.requestedBy) === idOf(u?._id)
  || (isActiveStaff(u) && u.staff.isHead === true && u.staff.team === r.team)
);

/** Who may link / unlink an expense to an order: who raised it, their team head, accounts, the admin. */
const mayLinkOrder = (u, r) => seesAll(u)
  || idOf(r.requestedBy) === idOf(u?._id)
  || (isActiveStaff(u) && u.staff.isHead === true && u.staff.team === r.team);

/** May `user` see this request? */
const canSee = (user, req) => seesAll(user) || (isActiveStaff(user) && user.staff.team === req.team);

const entry = (actor, action, note = '') => ({
  at: new Date(),
  by: actor._id,
  byName: actor.name || '',
  role: roleOf(actor),
  action,
  note: String(note || '').slice(0, 1000),
});

// ── Input checks ─────────────────────────────────────────────────────────────

const round2 = (n) => Math.round(Number(n) * 100) / 100;

function cleanAmount(value) {
  const n = round2(value);
  if (!Number.isFinite(n) || n < 1) throw fail('Enter the amount (at least ₹1).', 400);
  if (n > MAX_AMOUNT) throw fail('That amount looks too large — check it.', 400);
  return n;
}

/** What a team may claim it for (config/expenseCategories.js); the stored value. */
function checkCategory(team, value) {
  const found = findCategory(team, String(value || ''));
  if (!found) {
    throw fail(`Choose what the expense is for. ${STAFF_TEAM_LABELS[team] || team} can claim: ${categoriesFor(team).map((x) => x.label).join(', ')}.`, 400);
  }
  return found.value;
}

function checkNote(team, category, description) {
  if (noteRequiredFor(team, category) && description.length < 3) {
    throw fail(`Add details — say what this “${categoryLabel(category)}” expense was for.`, 400);
  }
}

const filled = (v) => v != null && v !== '';

/**
 * The money on an expense.
 *
 *   • Rupees: `amount`, as typed (₹1 or more).
 *   • A foreign bill (procurement imports): its currency and amount ONLY. The
 *     rupees are not known until the bank debits them, so `amount` stays 0 and
 *     the admin records the rupees with the payment (markPaid). Accounts approves
 *     the bill as billed — "THB 22,950" — never a guessed rupee figure.
 *
 * `current` (an edit): fields not sent keep their value, and the currency is
 * checked against the team's list only when it changes — an old record keeps
 * the currency it was raised in. A foreign bill whose currency and amount are
 * unchanged keeps its money exactly as it is, so correcting the details of an
 * older request does not drop the rate it was raised with.
 *
 * A stale browser tab may still send the retired `fxRate`: it is ignored.
 */
function cleanMoney(team, input, current = null) {
  const was = current ? (current.currency || BASE_CURRENCY) : null;
  const currency = filled(input.currency) ? String(input.currency).trim().toUpperCase() : (was || BASE_CURRENCY);
  if (currency !== was && !isCurrencyAllowed(team, currency)) {
    throw fail(`${currency.slice(0, 8)} is not a currency we pay in — choose one from the list.`, 400);
  }
  if (currency === BASE_CURRENCY) {
    const amount = filled(input.amount) || !current ? cleanAmount(input.amount) : current.amount;
    return { amount, currency, foreignAmount: null, fxRate: null };
  }
  if (filled(input.amount)) {
    throw fail(`A ${currency} bill is approved in ${currency}; the rupees are recorded when it is paid. Change the ${currency} amount instead.`, 400);
  }
  const foreignAmount = round2(filled(input.foreignAmount) ? input.foreignAmount : current?.foreignAmount);
  if (!Number.isFinite(foreignAmount) || foreignAmount <= 0) throw fail(`Enter the bill amount in ${currency}.`, 400);
  if (foreignAmount > MAX_FOREIGN_AMOUNT) throw fail('That bill amount looks too large — check it.', 400);
  if (current && currency === was && foreignAmount === current.foreignAmount) {
    return { amount: current.amount, currency, foreignAmount, fxRate: current.fxRate ?? null };
  }
  return { amount: 0, currency, foreignAmount, fxRate: null };
}

/**
 * The money on a supplier payment. A part of a supplier deal is always in the
 * deal's currency (whatever the browser sent); any other supplier payment may be
 * in any currency on the list. A foreign amount may arrive as `foreignAmount` or,
 * from the one amount box, as `amount`.
 */
function supplierMoney(input, deal, current = null) {
  const currency = deal
    ? (deal.currency || BASE_CURRENCY)
    : (filled(input.currency) ? String(input.currency).trim().toUpperCase() : (current?.currency || BASE_CURRENCY));
  if (deal && current && (current.currency || BASE_CURRENCY) !== currency) {
    throw fail(`This part of the supplier deal is paid in ${currency}.`, 400);
  }
  if (deal && filled(input.currency) && String(input.currency).trim().toUpperCase() !== currency) {
    throw fail(`This supplier deal is in ${currency} — every part is raised in ${currency}.`, 400);
  }
  const typed = currency === BASE_CURRENCY
    ? { currency, amount: input.amount }
    : { currency, foreignAmount: filled(input.foreignAmount) ? input.foreignAmount : input.amount };
  return cleanMoney(STAFF_TEAMS.PROCUREMENT, typed, current);
}

/** A foreign bill whose rupees are not recorded yet (raised without a rate, not paid). */
export const rupeesPending = (r) => Boolean(r?.currency && r.currency !== BASE_CURRENCY && !(Number(r.amount) > 0));

/**
 * The rupees the bank debited for a foreign bill, and the rate they come to.
 * The rate must land in the same sane range a typed rate always had to — a
 * rupee figure off by a few zeros is refused, not recorded.
 */
function cleanDebit(r, value) {
  const amount = cleanAmount(value);
  const fxRate = Math.round((amount / Number(r.foreignAmount)) * 1e6) / 1e6;
  if (!Number.isFinite(fxRate) || fxRate < MIN_FX_RATE || fxRate > MAX_FX_RATE) {
    throw fail(`${inr(amount)} for ${r.currency} ${Number(r.foreignAmount).toLocaleString('en-IN')} does not look right — enter the rupees the bank debited.`, 400);
  }
  return { amount, fxRate };
}

const rateText = (rate) => Number(rate).toLocaleString('en-IN', { maximumFractionDigits: 4 });

/** "THB 10,000 @ ₹2.45" (or "THB 22,950" before its rupees are known) — for chat, the edit log; '' for a rupee request. */
export const foreignLine = (r) => (r?.currency && r.currency !== BASE_CURRENCY && r.foreignAmount != null
  ? `${r.currency} ${Number(r.foreignAmount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}${r.fxRate ? ` @ ₹${rateText(r.fxRate)}` : ''}`
  : '');

/** The money in one phrase: "₹24,500 (THB 10,000 @ ₹2.45)", "₹800", or "THB 22,950 (rupees when paid)". */
const moneyText = (r) => (rupeesPending(r)
  ? `${foreignLine(r)} (rupees when paid)`
  : `${inr(r.amount)}${foreignLine(r) ? ` (${foreignLine(r)})` : ''}`);

export { cleanPayee, maskAccount };

/** Cloudinary keeps PDFs as 'raw' and photos as 'image' — deletes must say which. */
const resourceTypeOf = (f) => (f.contentType === 'application/pdf' ? 'raw' : 'image');

/**
 * Check every file before anything is stored: bills and payment screenshots are
 * photos or PDFs (up to MAX_ATTACHMENTS a save), a payee QR is one photo, and a
 * request holds at most MAX_ATTACHMENTS_PER_RECORD files over its life.
 */
function checkFiles(files, kinds, { existing = 0 } = {}) {
  const pairs = files.map((file, i) => ({ file, kind: kinds[i] })).filter((p) => p.file?.buffer?.length);
  const qr = pairs.filter((p) => p.kind === 'qr');
  const rest = pairs.filter((p) => p.kind !== 'qr');
  if (qr.length > 1) throw fail('Attach one QR code picture.', 400);
  const checkedQr = checkAttachments(qr.map((p) => p.file), { allowPdf: false, max: 1, noun: 'QR code' });
  const noun = rest.some((p) => p.kind === 'proof') ? 'screenshot' : 'bill';
  const checkedRest = checkAttachments(rest.map((p) => p.file), { existing: existing + checkedQr.length, noun });
  return [...checkedRest.map((c, i) => ({ ...c, kind: rest[i].kind })), ...checkedQr.map((c) => ({ ...c, kind: 'qr' }))];
}

/** Check, then store privately (a few at a time). Nothing half-saved: a failure removes what was stored. */
async function storeFiles(files, kinds, actor, { existing = 0 } = {}) {
  const checked = checkFiles(files, kinds, { existing });
  return storeAll(checked, async ({ file, kind, contentType, ext, name }) => {
    const ref = await putPrivateAsset({
      buffer: file.buffer,
      folder: PAYMENT_FILES_FOLDER,
      basename: `${kind}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`,
      contentType,
      cloudinaryPrivate: true,
    });
    return {
      kind, publicId: ref.publicId, provider: ref.provider, contentType, bytes: ref.bytes,
      name, uploadedBy: actor._id, uploadedAt: new Date(),
    };
  }, (f) => deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: resourceTypeOf(f) }));
}

/** `{ bill: [file], qr: [file] }` (multer fields) → ordered list with kinds. */
const filesFrom = (uploaded = {}) => {
  const out = [];
  for (const f of uploaded.bill || []) out.push(['bill', f]);
  for (const f of uploaded.qr || []) out.push(['qr', f]);
  return { files: out.map(([, f]) => f), kinds: out.map(([k]) => k) };
};

/** A UPI payee needs their UPI ID or a payment QR — one way or the other to pay them. */
function requireUpiOrQr(payee, kinds) {
  if (payee.method === 'upi' && !payee.upiId && !kinds.includes('qr')) {
    throw fail('Enter their UPI ID, or attach their payment QR.', 400);
  }
}

const nextNumber = async () => `PR-${String(await counterRepository.next('payment_request')).padStart(4, '0')}`;

// ── Chat ─────────────────────────────────────────────────────────────────────

const istTime = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

async function admins() {
  return (await userRepository.findChatUsers()).filter((u) => u.role === 'admin');
}

/**
 * One thread per request in #accounts (where it is approved and paid) and in the
 * requester's team space (so they see it move). Best-effort: chat never blocks
 * a payment step.
 */
async function tellChat(req, action, text, { mentionAdmins = false, mentionRequester = false } = {}) {
  try {
    const mentions = [];
    if (mentionAdmins) mentions.push(...(await admins()).map((u) => idOf(u)));
    if (mentionRequester) mentions.push(idOf(req.requestedBy));
    const spaces = [...new Set(['team:accounts', `team:${req.team}`])];
    await Promise.all(spaces.map((space) => postSystemMessage(space, text, {
      key: `payreq-${idOf(req._id)}-${action}-${req.history?.length || 0}`,
      mentions,
      // Thread by request: the field is an ObjectId thread key per space.
      threadOrder: idOf(req._id),
      orderIds: req.order ? [idOf(req.order)] : [],
    })));
  } catch (err) {
    console.error('[PaymentRequest] chat update failed (ignored):', err.message);
  }
}

const what = (r) => (r.kind === 'supplier'
  ? `supplier payment ${r.number} — ${moneyText(r)} to ${r.payee.name}${r.orderNumber ? ` for ${r.orderNumber}` : ''}`
  : `${categoryLabel(r.category)} expense ${r.number} — ${moneyText(r)} to ${r.payee.name}`);

// ── Shapes ───────────────────────────────────────────────────────────────────

/** What the panel shows, and what this person may do with it now. */
export function shape(r, viewer) {
  // Procurement as a team sees its suppliers' bank details anyway (the directory),
  // and needs them to raise the next payment to the same supplier.
  const full = seesAll(viewer) || idOf(r.requestedBy) === idOf(viewer?._id)
    || (r.kind === 'supplier' && onTeam(viewer, STAFF_TEAMS.PROCUREMENT));
  const isHeadOfTeam = isActiveStaff(viewer) && viewer.staff.isHead && viewer.staff.team === r.team;
  return {
    id: idOf(r._id),
    number: r.number,
    kind: r.kind,
    status: r.status,
    statusLabel: STATUS_LABELS[r.status],
    team: r.team,
    teamLabel: STAFF_TEAM_LABELS[r.team] || r.team,
    requestedBy: r.requestedByName,
    amount: r.amount, // rupees, always (0 while `rupeesPending`)
    // Records from before currencies have none: they are rupees.
    currency: r.currency || BASE_CURRENCY,
    foreignAmount: r.foreignAmount ?? null,
    fxRate: r.fxRate ?? null,
    // A foreign bill not yet paid: no rupee figure exists — show the bill, and the
    // admin enters the bank's rupee debit when paying.
    rupeesPending: rupeesPending(r),
    category: r.category,
    categoryLabel: categoryLabel(r.category),
    description: r.description,
    payee: {
      ...r.payee,
      // Full bank number only for the people who pay it and the person who asked.
      accountNumber: full ? r.payee?.accountNumber || '' : maskAccount(r.payee?.accountNumber),
    },
    order: r.order ? { id: idOf(r.order), number: r.orderNumber } : null,
    // One part of a made-to-order deal (advance / part / balance), or ''.
    dealId: r.deal ? idOf(r.deal) : null,
    part: r.part || '',
    partLabel: deals.PART_LABELS[r.part] || '',
    itemNames: r.itemNames || [],
    customer: r.customer || null,
    closedBy: r.closedBy || '',
    supplier: r.supplier ? { id: idOf(r.supplier) } : null,
    bankNotice: r.bankNotice?.at ? { at: r.bankNotice.at, byName: r.bankNotice.byName || '' } : null,
    files: (r.files || []).map((f) => ({ id: idOf(f._id), kind: f.kind, name: f.name, contentType: f.contentType, bytes: f.bytes })),
    payment: r.status === 'paid' ? r.payment : null,
    decisionNote: r.decisionNote || '',
    history: (r.history || []).map((h) => ({ at: h.at, byName: h.byName, role: h.role, action: h.action, note: h.note })),
    createdAt: r.createdAt,
    approver: 'accounts',
    can: {
      approve: mayDecide(viewer) && r.status === 'submitted',
      decline: mayDecide(viewer) && ['submitted', 'on_hold'].includes(r.status),
      // Only the admin pays — an approved request, or a waiting one directly
      // (the approval is recorded with the payment).
      pay: mayPay(viewer) && ['submitted', 'approved', 'on_hold'].includes(r.status),
      hold: mayHold(viewer) && r.status === 'approved',
      cancel: r.status === 'submitted' && (idOf(r.requestedBy) === idOf(viewer?._id) || isHeadOfTeam || isAdmin(viewer)),
      edit: mayEdit(viewer, r),
      // Which order an expense was for: any status (no money changes).
      linkOrder: r.kind === 'expense' && mayLinkOrder(viewer, r),
      // After paying: the admin may correct how it was paid, the reference and the screenshots.
      editPayment: mayPay(viewer) && r.status === 'paid',
    },
    // For the requester: until when they may still edit (admins have no limit).
    editableUntil: null, // no time limit any more
  };
}

// ── Raise ────────────────────────────────────────────────────────────────────

/** An expense for any team (or an admin raising it on a team's behalf). */
export async function createExpense(actor, input, uploaded, req) {
  const team = isAdmin(actor) ? String(input.team || '') : actor?.staff?.team;
  if (!isAdmin(actor) && !(isActiveStaff(actor) && EXPENSE_TEAMS.includes(team))) {
    throw fail('Only active staff raise expense requests.', 403);
  }
  if (!EXPENSE_TEAMS.includes(team)) throw fail('Choose the team the expense is for.', 400);
  const category = checkCategory(team, input.category);
  const description = String(input.description || '').trim().slice(0, 2000);
  checkNote(team, category, description);
  const money = cleanMoney(team, input);
  const { amount } = money;
  const payee = cleanPayee(input.payee);

  const link = await expenseOrderLink(input.orderId);

  const { files, kinds } = filesFrom(uploaded);
  requireUpiOrQr(payee, kinds);
  const stored = await storeFiles(files, kinds, actor);
  const doc = await paymentRequestRepository.create({
    number: await nextNumber(),
    kind: 'expense',
    ...link,
    status: 'submitted',
    team,
    requestedBy: actor._id,
    requestedByName: actor.name || '',
    ...money, category, description, payee,
    files: stored,
    history: [entry(actor, 'submitted')],
  });
  auditLogger.logAction(req, 'CREATE', 'PaymentRequest', doc._id, { kind: 'expense', amount, team, currency: money.currency, foreignAmount: money.foreignAmount, ...(link.order ? { orderId: idOf(link.order) } : {}) });
  await tellChat(doc, 'submitted', `🧾 New ${what(doc)} from ${doc.requestedByName} (${STAFF_TEAM_LABELS[team]}). Accounts: please approve or decline.`);
  return shape(doc, actor);
}

/**
 * An expense raised from an order's page (a courier charge, packing, a site visit
 * for that customer): linked to the order so the order shows it. Optional; the
 * order must exist. The link is shown, never summed into the customer's money.
 */
async function expenseOrderLink(orderId) {
  if (orderId == null || orderId === '') return {};
  if (!/^[a-f0-9]{24}$/i.test(String(orderId))) throw fail('That order was not found.', 400);
  const order = await orderRepository.findForWorkflow(orderId);
  if (!order) throw fail('That order was not found.', 400);
  return { order: order._id, orderNumber: orderNumber(order) };
}

/**
 * A supplier payment for items on a paid order. Snapshots the order, customer
 * and who closed the sale onto the request.
 */
export async function createSupplierRequest(actor, input, uploaded, req) {
  if (!isAdmin(actor) && !onTeam(actor, STAFF_TEAMS.PROCUREMENT)) {
    throw fail('Only procurement raises supplier payments.', 403);
  }
  const order = await orderRepository.findForWorkflow(input.orderId);
  const view = order && workflowView(order);
  if (!view) throw fail('Order not found in the team workflow.', 404);

  // A part of a supplier deal pays for the deal's items — whatever the client sent.
  const deal = input.dealId ? await deals.dealForPayment(input.dealId, order._id) : null;
  const wanted = deal
    ? deal.itemIds.map(idOf)
    : [...new Set((Array.isArray(input.itemIds) ? input.itemIds : [input.itemIds]).filter(Boolean).map(String))];
  if (!wanted.length) throw fail('Choose the item(s) this payment is for.', 400);
  const payable = new Set(view.lines.filter((l) => l.stage === STAGE.TO_SHIP || l.stage === STAGE.WITH_SUPPLIER).map((l) => l.itemId));
  // An item still at its stock check can be paid for too: raising the payment IS
  // "ordered from this supplier" (recorded below, once everything else checks out).
  const atCheck = new Set(view.lines.filter((l) => l.stage === STAGE.STOCK_CHECK).map((l) => l.itemId));
  const ours = new Set(view.lines.filter((l) => l.stage === STAGE.OWN_STOCK).map((l) => l.itemId));
  if (wanted.some((id) => ours.has(id))) {
    throw fail('This item ships from our warehouse — there is no supplier to pay. Undo "Our Warehouse" first if a supplier is sending it.', 409);
  }
  if (wanted.some((id) => !payable.has(id) && !atCheck.has(id))) {
    throw fail('A supplier can only be paid for items not yet shipped (and not out of stock or being refunded).', 409);
  }
  const open = await paymentRequestRepository.findOpenForOrder(order._id);
  const busy = open.find((r) => (r.itemIds || []).some((id) => wanted.includes(idOf(id))));
  if (busy) throw fail(`${busy.number} for this item is already ${STATUS_LABELS[busy.status].toLowerCase()}.`, 409);
  if (!deal) {
    // Paid in parts: every payment for the item goes through its deal, so the agreed total holds.
    const [dealt] = (await deals.forOrder(actor, idOf(order._id))).filter((d) => d.itemIds.some((id) => wanted.includes(id)));
    if (dealt) throw fail(`This item is paid in parts (agreed ${deals.moneyOf(Math.round(dealt.agreedTotal * 100), dealt.currency)} with ${dealt.supplierName}) — raise the next part from its supplier deal.`, 409);
  }

  const money = supplierMoney(input, deal);
  const { amount } = money;
  const { payee, supplierId, bankNotice } = await supplierPayee(actor, input, req);
  const description = String(input.description || '').trim().slice(0, 2000);
  const { files, kinds } = filesFrom(uploaded);
  requireUpiOrQr(payee, kinds);

  // The lock on the agreed total, taken last, just before saving, and given back if
  // anything after it fails: no overpaying, even with two people at once.
  // In hundredths of the deal's currency (the deal and its parts share one).
  const amountPaise = toPaise(deals.unitsOf(money));
  const before = deal ? await deals.reserve(deal._id, amountPaise) : null;
  let stored;
  let doc;
  try {
    stored = await storeFiles(files, kinds, actor);
  } catch (err) {
    if (deal) await deals.release(deal._id, amountPaise, 'files failed');
    throw err;
  }

  const items = (order.items || []).filter((i) => wanted.includes(idOf(i._id)));
  try {
  doc = await paymentRequestRepository.create({
    number: await nextNumber(),
    kind: 'supplier',
    status: 'submitted',
    team: STAFF_TEAMS.PROCUREMENT,
    requestedBy: actor._id,
    requestedByName: actor.name || '',
    amount,
    currency: money.currency,
    foreignAmount: money.foreignAmount,
    fxRate: money.fxRate,
    category: 'supplier',
    description,
    payee,
    order: order._id,
    orderNumber: orderNumber(order),
    itemIds: items.map((i) => i._id),
    itemNames: items.map((i) => variantDisplayName(i.name, i.variantLabel)),
    customer: {
      name: order.shippingAddress?.fullName || order.user?.name || '',
      phone: order.shippingAddress?.phone || order.user?.phone || '',
      city: [order.shippingAddress?.city, order.shippingAddress?.state].filter(Boolean).join(', '),
    },
    closedBy: order.salesUser ? `GTM lead: ${order.salesUser.name || 'GTM'}` : 'Website',
    supplier: supplierId,
    bankNotice,
    ...(deal ? { deal: deal._id, part: deals.partFor(before, amountPaise) } : {}),
    files: stored,
    history: [entry(actor, 'submitted', deal ? `${deals.PART_LABELS[deals.partFor(before, amountPaise)]} of the agreed ${deals.moneyOf(before.agreedPaise, before.currency)}` : '')],
  });
  } catch (err) {
    if (deal) await deals.release(deal._id, amountPaise, 'request failed to save');
    throw err;
  }
  auditLogger.logAction(req, 'CREATE', 'PaymentRequest', doc._id, { kind: 'supplier', amount, currency: money.currency, foreignAmount: money.foreignAmount, orderId: idOf(order._id), ...(deal ? { dealId: idOf(deal._id), part: doc.part } : {}) });
  // The items now read "Payment Pending" until the admin pays (then "Ordered From
  // Supplier") or the request is cancelled / declined (then back where they were).
  // The request is the record; if marking a line fails, it is logged, and the
  // shipping guard still holds the item until the payment is made.
  const wf = await import('./teamWorkflowService.js'); // lazy: that module imports this one
  for (const itemId of doc.itemIds.map(idOf)) {
    try {
      await wf.markPaymentPending(actor, idOf(order._id), itemId, { supplierName: payee.name, ref: doc.number }, req);
    } catch (err) {
      console.error(`[PaymentRequest] ${doc.number}: could not mark ${itemId} payment pending:`, err.message);
    }
  }
  const warn = bankNotice ? ` ⚠️ This supplier's bank details were changed on ${new Date(bankNotice.at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} by ${bankNotice.byName || 'someone'} — confirm them with the supplier before paying.` : '';
  await tellChat(doc, 'submitted', `🧾 New ${what(doc)} — ${doc.itemNames.join(', ')}. Raised by ${doc.requestedByName}. Accounts: please approve or decline.${warn}`);
  return shape(doc, actor);
}

/**
 * Made to order, in one step: the supplier deal (supplier, currency, agreed total,
 * completion date) AND its advance request, saved together. If the advance cannot
 * be raised, the deal just made is withdrawn (marked cancelled, never deleted), so
 * a failed save leaves nothing half done.
 *
 * There is no start date to type: the day the advance is paid is when the
 * supplier starts (supplierDealService.dealView).
 */
export async function createDealWithAdvance(actor, input, uploaded, req) {
  if (!isAdmin(actor) && !onTeam(actor, STAFF_TEAMS.PROCUREMENT)) {
    throw fail('Only procurement sets up a supplier deal.', 403);
  }
  if (!filled(input.completionDate)) throw fail('Enter the date the supplier will finish making it.', 400);
  const supplierName = input.supplierId
    ? (await suppliers.payeeFor(input.supplierId)).payee.name
    : cleanPayee(input.payee).name;
  // Checked before anything is saved; the lock in createSupplierRequest is what holds under a race.
  const currency = deals.cleanCurrency(input.currency);
  const agreed = deals.cleanAgreed(input.agreedTotal, currency);
  const advance = supplierMoney({ currency, amount: input.advance }, { currency });
  if (toPaise(deals.unitsOf(advance)) > agreed) {
    throw fail(`The advance cannot be more than the agreed total (${deals.moneyOf(agreed, currency)}).`, 400);
  }
  const deal = await deals.create(actor, {
    orderId: input.orderId, itemIds: input.itemIds, supplierName, currency,
    agreedTotal: input.agreedTotal, completionDate: input.completionDate, note: input.note,
  }, req);
  try {
    const request = await createSupplierRequest(actor, { ...input, dealId: deal.id, amount: input.advance, foreignAmount: undefined, currency }, uploaded, req);
    return { deal: await deals.dealById(actor, deal.id), request };
  } catch (err) {
    await deals.discard(deal.id, `advance not raised: ${err.message}`);
    throw err;
  }
}

/**
 * When the money actually moved, from the form (an ISO time; the browser sends its
 * local "date & time" as ISO). Empty → now. Not in the future (5 minutes' clock
 * slack) and not more than a year back — a typo guard.
 */
export function cleanTransactionAt(value, now = Date.now()) {
  if (value == null || value === '') return new Date(now);
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) throw fail('Enter a valid transaction date and time.', 400);
  if (at.getTime() > now + 5 * 60 * 1000) throw fail('The transaction time cannot be in the future.', 400);
  if (at.getTime() < now - 366 * 24 * 3600 * 1000) throw fail('That transaction date is more than a year ago — check it.', 400);
  return at;
}

const truthy = (v) => v === true || v === 'true' || v === '1' || v === 1;

/**
 * Who a supplier payment pays: a saved supplier (`supplierId` — its details are
 * copied, the client's `payee` is ignored), or details typed for this payment,
 * optionally saved as a new supplier (`saveSupplier`).
 */
async function supplierPayee(actor, input, req) {
  if (input.supplierId) {
    const { supplier, payee, bankNotice } = await suppliers.payeeFor(input.supplierId);
    return { payee, supplierId: supplier._id, bankNotice };
  }
  const payee = cleanPayee(input.payee);
  if (truthy(input.saveSupplier)) {
    const saved = await suppliers.create(actor, { name: payee.name, phone: payee.phone, payment: payee }, req);
    return { payee, supplierId: saved.id, bankNotice: null };
  }
  return { payee, supplierId: null, bankNotice: null };
}

/** After a supplier request is paid / cancelled / declined: move its order lines to match. Never throws. */
async function followOnOrder(r, actor, outcome) {
  // A declined / cancelled part gives its share of the agreed total back.
  if (r.deal && outcome !== 'paid') await deals.release(r.deal, toPaise(deals.unitsOf(r)), `${r.number} ${outcome}`);
  if (r.kind !== 'supplier' || !r.order) return;
  try {
    const wf = await import('./teamWorkflowService.js');
    const ids = (r.itemIds || []).map(idOf);
    if (outcome === 'paid') await wf.markPaidOrdered(actor, idOf(r.order), ids, r.payee?.name);
    else await wf.clearPaymentPending(actor, idOf(r.order), ids, `${r.number} ${outcome}`);
  } catch (err) {
    console.error(`[PaymentRequest] ${r.number}: order lines not updated after ${outcome}:`, err.message);
  }
}

// ── Decide / pay ─────────────────────────────────────────────────────────────

async function loadVisible(actor, id) {
  if (!/^[a-f0-9]{24}$/i.test(String(id))) throw fail('Request not found.', 404);
  const r = await paymentRequestRepository.findById(id);
  if (!r || !canSee(actor, r)) throw fail('Request not found.', 404);
  return r;
}

const MOVED = 'This request has just been updated by someone else. Refresh to see where it is now.';

/**
 * A supplier payment pays for an order's items; once the order (or every item the
 * payment covers) is cancelled there is nothing to buy. Refuse to approve or pay it —
 * decline it instead. One-off payments too, not only deal parts: an approved one-off
 * payment could otherwise still be paid after the customer's order was cancelled.
 * An item with only some units cancelled is still live (supplierAdvanceGuard.itemsCancelled).
 */
async function orderGone(r) {
  if (r.kind !== 'supplier' || !r.order) return false;
  return itemsCancelled(await orderRepository.findForWorkflow(idOf(r.order)), r.itemIds);
}

async function assertOrderLive(r) {
  if (await orderGone(r)) throw fail(`${r.number}: this order (or the item) was cancelled — decline this supplier payment instead.`, 409);
}

export async function approve(actor, id, { note } = {}, req) {
  const r0 = await loadVisible(actor, id);   // 404s a request this person may not see
  if (!mayDecide(actor)) throw fail('Only accounts (or an admin) approves payments.', 403);
  await assertOrderLive(r0);
  const r = await paymentRequestRepository.transition(id, ['submitted'],
    { status: 'approved', approvedBy: actor._id, approvedAt: new Date(), decisionNote: String(note || '').slice(0, 1000) },
    entry(actor, 'approved', note));
  if (!r) throw fail(MOVED, 409);
  auditLogger.logAction(req, 'UPDATE', 'PaymentRequest', id, { change: 'approved' });
  await tellChat(r, 'approved', `✅ ${isAdmin(actor) ? 'Admin' : 'Accounts'} approved ${what(r)}. Admin: please pay and record the payment.`, { mentionAdmins: true });
  return shape(r, actor);
}

export async function decline(actor, id, { note } = {}, req) {
  const r0 = await loadVisible(actor, id);   // 404s a request this person may not see
  if (!mayDecide(actor)) throw fail('Only accounts (or an admin) declines payments.', 403);
  const reason = String(note || '').trim();
  if (reason.length < 3) throw fail('Say why it is declined — the requester sees this.', 400);
  // An approved supplier payment whose order was cancelled can no longer be paid
  // (assertOrderLive), so it may be declined straight away — no money has moved.
  const from = r0.status === 'approved' && await orderGone(r0) ? ['approved'] : ['submitted', 'on_hold'];
  const r = await paymentRequestRepository.transition(id, from,
    { status: 'declined', decisionNote: reason.slice(0, 1000) }, entry(actor, 'declined', reason));
  if (!r) throw fail(MOVED, 409);
  auditLogger.logAction(req, 'UPDATE', 'PaymentRequest', id, { change: 'declined' });
  await followOnOrder(r, actor, 'declined');
  await tellChat(r, 'declined', `⛔ ${isAdmin(actor) ? 'Admin' : 'Accounts'} declined ${what(r)}: “${reason.slice(0, 200)}”.`, { mentionRequester: true });
  return shape(r, actor);
}

export async function hold(actor, id, { note } = {}, req) {
  if (!mayHold(actor)) throw fail('Only accounts or an admin can put a payment on hold.', 403);
  const reason = String(note || '').trim();
  if (reason.length < 3) throw fail('Say why it is on hold (e.g. funds arrive Friday).', 400);
  await loadVisible(actor, id);
  const r = await paymentRequestRepository.transition(id, ['approved'],
    { status: 'on_hold', decisionNote: reason.slice(0, 1000) }, entry(actor, 'on_hold', reason));
  if (!r) throw fail(MOVED, 409);
  auditLogger.logAction(req, 'UPDATE', 'PaymentRequest', id, { change: 'on_hold' });
  await tellChat(r, 'on_hold', `⏸️ ${isAdmin(actor) ? 'Admin' : 'Accounts'} put ${what(r)} on hold: “${reason.slice(0, 200)}”.`, { mentionAdmins: true, mentionRequester: true });
  return shape(r, actor);
}

/**
 * The admin records the payment made (Razorpay / bank / UPI), with a reference and a screenshot.
 *
 * A foreign bill also takes `rupees`: what the bank actually debited. It is
 * required while the rupees are unknown (raised without a rate), and may replace
 * an older request's quoted estimate — the debit is what it cost. The rate is
 * worked out from it. A rupee request's amount is what accounts approved: a
 * different figure is refused, never applied.
 */
export async function markPaid(actor, id, { method, reference, note, transactionAt, rupees } = {}, proofFiles = [], req) {
  if (!mayPay(actor)) throw fail('Only the admin pays payment requests — accounts approves them.', 403);
  const how = ['razorpay', 'bank', 'upi', 'other'].includes(method) ? method : null;
  if (!how) throw fail('Choose how it was paid.', 400);
  // Optional: not every payment has one to hand (cash, some UPI apps).
  const ref = String(reference || '').trim();
  const now = new Date();
  const txAt = cleanTransactionAt(transactionAt, now.getTime());
  const r0 = await loadVisible(actor, id);
  await assertOrderLive(r0);
  const isForeign = Boolean(foreignLine(r0));
  let priced = null;
  if (isForeign && filled(rupees)) {
    priced = cleanDebit(r0, rupees);
    if (priced.amount === r0.amount) priced = null;
  } else if (rupeesPending(r0)) {
    throw fail(`Enter the rupees the bank debited for this ${foreignLine(r0)} bill.`, 400);
  } else if (filled(rupees) && round2(rupees) !== r0.amount) {
    throw fail(`This request is for ${inr(r0.amount)} — that is what accounts approved. Edit the request to change it.`, 400);
  }
  // The admin paying a request still waiting for approval approves it in the same step.
  const from = ['submitted', 'approved', 'on_hold'];
  const uploads = (Array.isArray(proofFiles) ? proofFiles : [proofFiles]).filter(Boolean);
  const proof = uploads.length ? await storeFiles(uploads, uploads.map(() => 'proof'), actor, { existing: (r0.files || []).length }) : [];
  const debit = priced ? `${inr(priced.amount)} debited for ${foreignLine({ ...r0, fxRate: null })} (₹${rateText(priced.fxRate)} per ${r0.currency})` : '';
  // A priced payment is also pinned to the bill it priced: an edit to the bill
  // between reading it and paying makes this a lost race, not a wrong rate.
  const r = await paymentRequestRepository.transitionInSession(id, from,
    priced ? { foreignAmount: r0.foreignAmount, amount: r0.amount } : {}, {
      ...(r0.status === 'submitted' ? { approvedBy: actor._id, approvedAt: now } : {}),
      ...(priced || {}),
      status: 'paid',
      payment: { method: how, reference: ref.slice(0, 120), paidAt: now, transactionAt: txAt, paidBy: actor._id, paidByName: actor.name || '' },
    }, entry(actor, 'paid', [`${how.toUpperCase()} ${ref}`.trim(), debit, note].filter(Boolean).join(' — ')),
    proof.length ? { files: { $each: proof } } : {}, undefined);
  if (!r) {
    // Lost the race: the screenshot belongs to no payment.
    await Promise.all(proof.map((f) => deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: resourceTypeOf(f) }).catch(() => {})));
    throw fail(MOVED, 409);
  }
  auditLogger.logAction(req, 'UPDATE', 'PaymentRequest', id, { change: 'paid', method: how, reference: ref, ...(priced ? { amount: priced.amount, fxRate: priced.fxRate } : {}) });
  await followOnOrder(r, actor, 'paid');
  const next = r.kind === 'supplier' ? ' Procurement: get the shipping details from the supplier and upload them.' : '';
  await tellChat(r, 'paid', `💸 Paid ${what(r)} — ${how.toUpperCase()}${ref ? ` ref ${ref}` : ''}.${next}`, { mentionRequester: true });
  return shape(r, actor);
}

export async function cancel(actor, id, { note } = {}, req) {
  const r0 = await loadVisible(actor, id);
  const isHead = isActiveStaff(actor) && actor.staff.isHead && actor.staff.team === r0.team;
  if (!(isAdmin(actor) || isHead || idOf(r0.requestedBy) === idOf(actor._id))) {
    throw fail('Only the person who raised it (or their team head) can cancel it.', 403);
  }
  const r = await paymentRequestRepository.transition(id, ['submitted'],
    { status: 'cancelled' }, entry(actor, 'cancelled', note));
  if (!r) throw fail('Only a request still waiting for approval can be cancelled.', 409);
  auditLogger.logAction(req, 'UPDATE', 'PaymentRequest', id, { change: 'cancelled' });
  await followOnOrder(r, actor, 'cancelled');
  await tellChat(r, 'cancelled', `↩️ ${r.requestedByName} cancelled ${what(r)}.`);
  return shape(r, actor);
}

/**
 * Correct a request: amount, details, who is paid (a saved supplier or typed
 * details) and, for an expense, what it was for. Items and files stay as they
 * are. Compare-and-set on the version read, so two edits at once cannot both land.
 */
export async function update(actor, id, input = {}, req) {
  const r0 = await loadVisible(actor, id);
  if (!mayEdit(actor, r0)) {
    throw fail(!EDITABLE.includes(r0.status)
      ? 'A paid, declined or cancelled request cannot be edited.'
      : 'Only whoever raised it, their team head or the admin can edit it.', 403);
  }
  const isExpense = r0.kind === 'expense';
  const before = { currency: r0.currency || BASE_CURRENCY, foreignAmount: r0.foreignAmount ?? null, fxRate: r0.fxRate ?? null };
  // Either kind may be a foreign bill (worked out in cleanMoney). A deal part stays
  // in its deal's currency.
  const money = isExpense
    ? cleanMoney(r0.team, input, { amount: r0.amount, ...before })
    : supplierMoney(input, r0.deal ? { currency: before.currency } : null, { amount: r0.amount, ...before });
  const { amount } = money;
  const description = input.description != null ? String(input.description).trim().slice(0, 2000) : r0.description || '';
  let { category } = r0;
  // The team's list is checked only when the category CHANGES: an old record
  // (procurement "fuel", from the shared list) can still be corrected as it is.
  if (isExpense && input.category != null && String(input.category) !== r0.category) {
    category = checkCategory(r0.team, input.category);
  }
  if (isExpense && (category !== r0.category || description !== (r0.description || ''))) {
    checkNote(r0.team, category, description);
  }
  const fxChanged = money.currency !== before.currency || money.foreignAmount !== before.foreignAmount || money.fxRate !== before.fxRate;

  let payee = r0.payee;
  let supplier = r0.supplier ?? null;
  let bankNotice = r0.bankNotice ?? null;
  if (r0.kind === 'supplier' && input.supplierId) {
    const picked = await suppliers.payeeFor(input.supplierId);
    ({ payee, bankNotice } = picked);
    supplier = picked.supplier._id;
  } else if (input.payee) {
    payee = cleanPayee(input.payee);
    if (payKeyOf(payee, 'x') !== payKeyOf(r0.payee, 'x')) { supplier = null; bankNotice = null; }
  }
  requireUpiOrQr(payee, (r0.files || []).map((f) => f.kind));

  const changes = [];
  // A foreign bill without rupees yet has no rupee amount to compare: its bill line says it.
  if (amount !== r0.amount && !rupeesPending(money) && !rupeesPending(r0)) changes.push(`amount ${inr(r0.amount)} → ${inr(amount)}`);
  if (fxChanged) changes.push(`bill ${foreignLine(before) || 'in rupees'} → ${foreignLine(money) || 'in rupees'}`);
  if (payee.name !== r0.payee.name) changes.push(`payee ${r0.payee.name} → ${payee.name}`);
  if (payKeyOf(payee, 'x') !== payKeyOf(r0.payee, 'x')) changes.push('payment details');
  if (description !== (r0.description || '')) changes.push('details');
  if (category !== r0.category) changes.push(`for ${categoryLabel(r0.category)} → ${categoryLabel(category)}`);
  if (!changes.length) return shape(r0, actor);

  const moneyChanged = amount !== r0.amount || fxChanged || payee.name !== r0.payee.name || payKeyOf(payee, 'x') !== payKeyOf(r0.payee, 'x');
  const backToAccounts = r0.status !== 'submitted' && moneyChanged;
  const note = changes.join(', ') + (backToAccounts ? ' — back to accounts to approve again' : '');
  // A deal part's new amount must still fit the agreed total: move the lock by the difference first.
  // In hundredths of the deal's currency.
  const wasUnits = toPaise(deals.unitsOf(r0));
  const nowUnits = toPaise(deals.unitsOf(money));
  const delta = r0.deal ? nowUnits - wasUnits : 0;
  let part = r0.part || '';
  if (delta > 0) {
    const before = await deals.reserve(r0.deal, delta);
    part = deals.partFor({ ...before, reservedPaise: before.reservedPaise - wasUnits }, nowUnits);
  } else if (delta < 0) {
    // Named against the other parts: what is asked for besides this one.
    const now = await deals.dealForPayment(r0.deal, r0.order);
    part = deals.partFor({ ...now, reservedPaise: now.reservedPaise - wasUnits }, nowUnits);
  }
  const r = await paymentRequestRepository.transitionInSession(id, [r0.status], { updatedAt: r0.updatedAt }, {
    amount, currency: money.currency, foreignAmount: money.foreignAmount, fxRate: money.fxRate,
    description, category, payee, supplier, bankNotice,
    ...(r0.deal ? { part } : {}),
    ...(backToAccounts ? { status: 'submitted', approvedBy: null, approvedAt: null, decisionNote: '' } : {}),
  }, entry(actor, 'edited', note), {}, undefined);
  if (!r) {
    // Lost the race: put the lock back where it was.
    if (delta > 0) await deals.release(r0.deal, delta, `${r0.number} edit lost a race`);
    throw fail(MOVED, 409);
  }
  // A smaller amount gives its share back only once the edit has landed.
  if (delta < 0) await deals.release(r0.deal, -delta, `${r0.number} edited`);
  auditLogger.logAction(req, 'UPDATE', 'PaymentRequest', id, { change: 'edited', fields: changes, backToAccounts });
  await tellChat(r, 'edited', `✏️ ${actor.name || 'Someone'} edited ${what(r)}: ${note}.`, { mentionAdmins: false, mentionRequester: idOf(r.requestedBy) !== idOf(actor._id) });
  return shape(r, actor);
}

/**
 * The admin corrects a PAID payment's record: how it was paid, the reference /
 * UTR, the payment screenshots (add new, remove wrong ones) and a note. The
 * amount and who was paid are NOT editable — the money has left; a wrong amount
 * is a new payment or a refund. A request paid in one transfer with others
 * (payBatch) is corrected together with them: it was one transfer. One
 * transaction; every change is in each request's history.
 */
export async function editPayment(actor, id, { method, reference, note, removeFileIds, transactionAt, rupees } = {}, proofFiles = [], req) {
  if (!mayPay(actor)) throw fail('Only the admin can edit a payment record.', 403);
  const r0 = await loadVisible(actor, id);
  if (r0.status !== 'paid') throw fail('Only a paid payment\'s details can be edited here.', 409);

  const how = method ? (['razorpay', 'bank', 'upi', 'other'].includes(method) ? method : null) : r0.payment?.method;
  if (!how) throw fail('Choose how it was paid.', 400);
  const ref = reference != null ? String(reference).trim().slice(0, 120) : r0.payment?.reference || '';
  const wasAt = r0.payment?.transactionAt || r0.payment?.paidAt || null;
  const txAt = transactionAt != null && transactionAt !== '' ? cleanTransactionAt(transactionAt) : wasAt;
  let removeIds = removeFileIds;
  if (typeof removeIds === 'string') { try { removeIds = JSON.parse(removeIds); } catch { removeIds = [removeIds]; } }
  removeIds = new Set((Array.isArray(removeIds) ? removeIds : []).map(String));
  const removing = (r0.files || []).filter((f) => f.kind === 'proof' && removeIds.has(idOf(f._id)));
  const uploads = (Array.isArray(proofFiles) ? proofFiles : [proofFiles]).filter(Boolean);
  // A foreign bill's rupees are the admin's own record of the bank debit, so a
  // typo in them is theirs to correct. A rupee payment's amount is not: it was
  // approved, and a wrong one is a new payment or a refund.
  let priced = null;
  if (filled(rupees)) {
    if (!foreignLine(r0)) throw fail('The amount of a paid rupee payment cannot be changed — a wrong amount is a new payment or a refund.', 400);
    if (r0.payment?.batch) throw fail('This was paid in one transfer with others — its amount cannot be changed alone.', 400);
    priced = cleanDebit(r0, rupees);
    if (priced.amount === r0.amount) priced = null;
  }

  const changes = [];
  if (priced) changes.push(`rupees debited ${inr(r0.amount)} → ${inr(priced.amount)} (₹${rateText(priced.fxRate)} per ${r0.currency})`);
  if (how !== r0.payment?.method) changes.push(`paid by ${String(r0.payment?.method || '—').toUpperCase()} → ${how.toUpperCase()}`);
  if (ref !== (r0.payment?.reference || '')) changes.push(`reference ${r0.payment?.reference || '—'} → ${ref || '—'}`);
  if (txAt && (!wasAt || new Date(txAt).getTime() !== new Date(wasAt).getTime())) {
    changes.push(`transaction time ${wasAt ? istTime(wasAt) : '—'} → ${istTime(txAt)}`);
  }
  if (removing.length) changes.push(`${removing.length} screenshot${removing.length === 1 ? '' : 's'} removed`);
  if (uploads.length) changes.push(`${uploads.length} screenshot${uploads.length === 1 ? '' : 's'} added`);
  const extra = String(note || '').trim().slice(0, 500);
  if (!changes.length && !extra) return shape(r0, actor);

  // Checked before anything changes; room is what the record holds after the removals.
  const stored = uploads.length
    ? await storeFiles(uploads, uploads.map(() => 'proof'), actor, { existing: (r0.files || []).length - removing.length })
    : [];
  const batch = r0.payment?.batch || '';
  const targets = batch ? (await paymentRequestRepository.findPaidBatch(batch)).map((r) => r._id) : [r0._id];
  const publicIds = removing.map((f) => f.publicId);
  const log = entry(actor, 'payment_edited', [changes.join(', ') || 'note', extra, batch && targets.length > 1 ? `(whole transfer ${batch}, ${targets.length} payments)` : ''].filter(Boolean).join(' — '));

  let updated;
  try {
    updated = await paymentRequestRepository.inTransaction(async (session) => {
      let mine = null;
      for (const tid of targets) {
        if (publicIds.length) await paymentRequestRepository.pullProofsInSession(tid, publicIds, session);
        const next = await paymentRequestRepository.editPaidInSession(tid, { 'payment.method': how, 'payment.reference': ref, ...(txAt ? { 'payment.transactionAt': txAt } : {}), ...(priced || {}) }, log, stored, session);
        if (!next) throw fail(MOVED, 409);
        if (idOf(tid) === idOf(r0._id)) mine = next;
      }
      return mine;
    });
  } catch (err) {
    await Promise.all(stored.map((f) => deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: resourceTypeOf(f) }).catch(() => {})));
    throw err;
  }
  // Only now, with no request pointing at them any more, delete the removed screenshots.
  await Promise.all(removing.map((f) => deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: resourceTypeOf(f) }).catch(() => {})));
  auditLogger.logAction(req, 'UPDATE', 'PaymentRequest', id, { change: 'payment_edited', fields: changes, batch: batch || undefined });
  await tellChat(updated, 'payment_edited', `✏️ Admin corrected the payment record of ${what(updated)}: ${changes.join(', ') || extra}.`);
  return shape(updated, actor);
}

// ── Read ─────────────────────────────────────────────────────────────────────

/*
  The list's search / filter / sort (utils/listQuery.js does the reading).

  Every filter is ANDed onto the visibility rule (a team sees only its own), so
  no combination can widen what someone sees. Unknown values are ignored rather
  than refused — a stale link still opens, just unfiltered.
*/
const STATUS_QUERY = Object.freeze({
  open: { $in: OPEN_STATUSES },
  to_approve: 'submitted',
  to_pay: { $in: ['approved', 'on_hold'] },
});
export const LIST_SORTS = Object.freeze({
  newest: { field: 'createdAt', dir: -1, type: 'date' },
  oldest: { field: 'createdAt', dir: 1, type: 'date' },
  amount_desc: { field: 'amount', dir: -1, type: 'number' },
  amount_asc: { field: 'amount', dir: 1, type: 'number' },
  // Only meaningful for paid requests (the only ones with a paidAt): ignored otherwise.
  paid_recent: { field: 'payment.paidAt', dir: -1, type: 'date' },
});
export const PAID_METHODS = Object.freeze(['razorpay', 'bank', 'upi', 'other']);
const SEARCH_FIELDS = Object.freeze([
  'number', 'payee.name', 'payee.upiId', 'orderNumber', 'requestedByName', 'description', 'category',
  'payment.reference', 'itemNames', 'customer.name', 'customer.phone', 'customer.city',
]);
const SUMMARY_CAP = 1000;

/** The Mongo query for a viewer and a set of list filters (exported for tests). */
export function listQuery(actor, f = {}) {
  const visible = seesAll(actor)
    ? (f.team && STAFF_TEAM_VALUES.includes(String(f.team)) ? { team: String(f.team) } : {})
    : { team: actor.staff.team };
  const status = STATUS_QUERY[f.status] ?? (STATUS_LABELS[f.status] ? f.status : null);
  const range = istRange(f.from, f.to);
  const amount = amountRange(f.min, f.max);
  const words = searchWords(String(f.q ?? '').replace(/^#/, ''));
  return and(
    visible,
    status ? { status } : null,
    ['supplier', 'expense'].includes(f.kind) ? { kind: f.kind } : null,
    // An equality match on a stored value, so any well-formed one is safe — old values included.
    /^[a-z][a-z0-9_]{1,39}$/.test(f.category || '') ? { category: f.category } : null,
    isObjectId(f.by) ? { requestedBy: new mongoose.Types.ObjectId(f.by) } : null,
    PAID_METHODS.includes(f.method) ? { 'payment.method': f.method } : null,
    // A foreign bill not yet priced (amount 0) has no rupee figure to filter on.
    amount ? { amount: { $gt: 0, ...amount } } : null,
    range && f.dateOf === 'paid'
      // When the money went; older records only know when it was recorded.
      ? { $or: [{ 'payment.transactionAt': range }, { 'payment.transactionAt': null, 'payment.paidAt': range }] }
      : range ? { createdAt: range } : null,
    searchClauses(words, SEARCH_FIELDS, (w) => {
      const n = amountOf(w);
      // "meta ads" finds a meta_ads expense: categories are stored as codes, shown by name.
      const named = w.length >= 3 ? categoriesNamed(w) : [];
      // A typed number is a rupee amount, or a foreign bill's amount ("22950" finds THB 22,950).
      return [...(n ? [{ amount: n }, { foreignAmount: n }] : []), ...(named.length ? [{ category: { $in: named } }] : [])];
    }),
  );
}

/** The sort a list asks for; "recently paid" only on the paid list. */
export function listSort(f = {}) {
  const name = LIST_SORTS[f.sort] && (f.sort !== 'paid_recent' || f.status === 'paid') ? f.sort : 'newest';
  return { name, sort: LIST_SORTS[name] };
}

/**
 * A page of requests. Admin and accounts see every team (filter by `team`);
 * anyone else sees their own team's. `status` narrows to one state, 'open'
 * (not finished), 'to_approve' (accounts' queue) or 'to_pay' (approved or on
 * hold — the admin's queue). Search, filters and sort as in listQuery/listSort.
 * The first page also says how many match and what they add up to.
 */
export async function list(actor, params = {}) {
  if (!seesAll(actor) && !isActiveStaff(actor)) throw fail('Not authorized.', 403);
  const filters = plainQuery(params);
  const { name } = listSort(filters);
  const { items, ...page } = await keysetPage({
    query: listQuery(actor, filters), sorts: LIST_SORTS, sortName: name, cursor: filters.cursor, pageSize: PAGE_SIZE,
    find: paymentRequestRepository.page, count: (q) => paymentRequestRepository.summary(q, SUMMARY_CAP),
  });
  return { ...page, requests: await withDeals(items, (r) => shape(r, actor)) };
}

/**
 * What the expense form offers this person: their team's options and currencies.
 * An admin asks for a team (`team`), as when raising on its behalf.
 */
export function expenseOptions(actor, { team } = {}) {
  const which = isAdmin(actor) ? String(team || '') : (isActiveStaff(actor) ? actor.staff.team : '');
  if (!isAdmin(actor) && !isActiveStaff(actor)) throw fail('Not authorized.', 403);
  if (!EXPENSE_TEAMS.includes(which)) throw fail('Choose the team the expense is for.', 400);
  return expenseOptionsFor(which);
}

/**
 * What the list's filters offer this viewer: the "What for" choices (their
 * team's, or every team's for admin / accounts) and, for admin / accounts only,
 * the "Raised by" people.
 */
export async function listFilterOptions(actor) {
  if (!seesAll(actor) && !isActiveStaff(actor)) throw fail('Not authorized.', 403);
  if (!seesAll(actor)) return { categories: filterCategories(actor.staff.team), people: [] };
  const users = await userRepository.findChatUsers();
  return {
    categories: filterCategories(null),
    people: users.map((u) => ({
      id: idOf(u._id),
      name: u.name || '',
      team: u.role === 'admin' ? 'admin' : u.staff?.team || '',
    })),
  };
}

/** One payment's deal summary (supplierDealService.partSummary), or null. Never throws: it is extra. */
async function dealSummaryOf(r) {
  try {
    return (await deals.summariesFor([r])).get(idOf(r._id)) || null;
  } catch (err) {
    console.error(`[PaymentRequest] ${r.number}: deal summary unavailable:`, err.message);
    return null;
  }
}

/** Shaped rows with their deal summaries attached (`deal`), in two reads for the whole page. */
async function withDeals(rows, toRow) {
  let sums = new Map();
  try {
    sums = await deals.summariesFor(rows);
  } catch (err) {
    console.error('[PaymentRequest] deal summaries unavailable:', err.message);
  }
  return rows.map((r) => {
    const row = toRow(r);
    if (r.deal) row.deal = sums.get(idOf(r._id)) || null;
    return row;
  });
}

export async function get(actor, id) {
  const r = await loadVisible(actor, id);
  const out = shape(r, actor);
  // Its order (or every item it pays for) was cancelled: say so, and offer decline, not pay.
  if (OPEN_STATUSES.includes(r.status) && await orderGone(r)) {
    out.orderCancelled = true;
    out.can = { ...out.can, approve: false, pay: false, decline: mayDecide(actor) };
  }
  // A part of a made-to-order deal: what it is part of (agreed total, paid before,
  // balance after, dates) — worked out from the deal, so every screen agrees.
  if (r.deal) out.deal = await dealSummaryOf(r);
  return out;
}

// ── Linking an expense to an order ───────────────────────────────────────────

/**
 * Orders to link an expense to, for the picker: number, customer, total, date.
 * Any active staff member (anyone who raises expenses); no phone or address leaves
 * the server — only what identifies the order on screen.
 */
export async function orderLookup(actor, q) {
  if (!seesAll(actor) && !isActiveStaff(actor)) throw fail('Not authorized.', 403);
  const rows = await orderRepository.findForPaymentLink(q);
  return rows.map((o) => ({
    id: idOf(o._id),
    // The number the team panel shows (and the link stores): the end of the id.
    number: `#${idOf(o._id).slice(-8).toUpperCase()}`,
    customer: o.shippingAddress?.fullName || o.user?.name || '',
    total: o.totalAmount ?? null,
    createdAt: o.createdAt,
  }));
}

/**
 * Link an expense to an order, change it, or remove it (`orderId` null / '').
 * Allowed at any status — no money changes, it only says which order the cost was
 * for. A supplier payment's order is fixed: it pays for that order's items.
 * Compare-and-set on the version read; logged in the history and the audit log.
 */
export async function linkOrder(actor, id, { orderId } = {}, req) {
  const r0 = await loadVisible(actor, id);
  if (r0.kind !== 'expense') throw fail("A supplier payment's order cannot be changed — it pays for that order's items.", 400);
  if (!mayLinkOrder(actor, r0)) throw fail('Only whoever raised it, their team head or accounts can link it to an order.', 403);
  const link = await expenseOrderLink(orderId);
  const was = r0.orderNumber || '';
  const now = link.orderNumber || '';
  if (String(r0.order || '') === String(link.order || '')) return shape(r0, actor);
  const note = !now ? `order ${was} removed` : was ? `order ${was} → ${now}` : `linked to order ${now}`;
  const r = await paymentRequestRepository.transitionInSession(id, [r0.status], { updatedAt: r0.updatedAt }, {
    order: link.order || null, orderNumber: now,
  }, entry(actor, 'edited', note), {}, undefined);
  if (!r) throw fail(MOVED, 409);
  auditLogger.logAction(req, 'UPDATE', 'PaymentRequest', id, { change: 'order', from: was, to: now });
  return shape(r, actor);
}

/** Supplier requests for an order, for the procurement order panel. */
export async function forOrder(actor, orderId) {
  if (!seesAll(actor) && !isActiveStaff(actor)) throw fail('Not authorized.', 403);
  if (!/^[a-f0-9]{24}$/i.test(String(orderId))) return [];
  const rows = await paymentRequestRepository.findForOrder(orderId);
  return rows.map((r) => ({
    id: idOf(r._id), number: r.number, status: r.status, statusLabel: STATUS_LABELS[r.status],
    kind: r.kind, categoryLabel: r.kind === 'expense' ? categoryLabel(r.category) : 'Supplier', team: r.team,
    dealId: r.deal ? idOf(r.deal) : null, part: r.part || '', partLabel: deals.PART_LABELS[r.part] || '',
    amount: r.amount, currency: r.currency || BASE_CURRENCY, foreignAmount: r.foreignAmount ?? null, rupeesPending: rupeesPending(r),
    itemIds: (r.itemIds || []).map(idOf), itemNames: r.itemNames || [],
    payee: r.payee?.name || '', paidAt: r.payment?.paidAt || null, createdAt: r.createdAt,
    requestedByName: r.requestedByName || '',
    // Shown as an Edit button on the product line (the edit itself re-checks).
    canEdit: mayEdit(actor, r),
  }));
}

/** One attached file, streamed through us (never a public link). */
export async function getFile(actor, id, fileId) {
  const r = await loadVisible(actor, id);
  const f = (r.files || []).find((x) => idOf(x._id) === String(fileId));
  if (!f) throw fail('File not found.', 404);
  const buffer = await readPrivateAsset(f, async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`File fetch failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  });
  return { buffer, contentType: f.contentType, name: f.name || `${r.number}-${f.kind}` };
}

/** For the PDF: the full record, for someone allowed to see it. */
export async function loadForSlip(actor, id) {
  const r = await loadVisible(actor, id);
  return r.deal ? { ...r, dealSummary: await dealSummaryOf(r) } : r;
}

// ── Shipping guard (teamWorkflowService.shipWithProof) ──────────────────────────

/**
 * Items whose supplier payment is still in flight cannot ship: procurement asks
 * the supplier for shipping only once accounts has paid. Items with no request
 * (own stock, a supplier on credit, orders from before requests existed) ship
 * as they always have.
 */
export async function assertNoPendingSupplierPayment(orderId, itemIds) {
  const pending = await openSupplierPaymentFor(orderId, itemIds);
  if (pending) {
    throw fail(`Supplier payment ${pending.number} is ${STATUS_LABELS[pending.status].toLowerCase()} — ship once it is paid.`, 409);
  }
  // Made to order and paid in parts: the balance too.
  const unpaid = await deals.unpaidBalanceReason(orderId, itemIds);
  if (unpaid) throw fail(unpaid, 409);
}

/** The open (not paid, cancelled or declined) supplier payment covering any of these items, if one exists. */
export async function openSupplierPaymentFor(orderId, itemIds) {
  const open = await paymentRequestRepository.findOpenForOrder(orderId);
  const ids = itemIds.map(String);
  return open.find((r) => (r.itemIds || []).some((id) => ids.includes(idOf(id)))) || null;
}

// ── Pay a supplier in one transfer ───────────────────────────────────────────

/** How many open supplier payments the grouped view reads — far above a real queue. */
export const TO_PAY_CAP = 500;
export const MAX_BATCH = 50;
const TO_PAY = ['approved', 'on_hold'];

/** An opaque id for a pay destination: the key itself holds the account number. */
const groupIdOf = (r) => crypto.createHash('sha256').update(payKeyOf(r.payee, idOf(r._id))).digest('hex').slice(0, 16);

const destinationLabel = (p = {}) => (p.method === 'upi' ? (p.upiId ? `UPI ${p.upiId}` : 'UPI by QR (see the request)') : `${p.bankName || 'Bank'} ${maskAccount(p.accountNumber)} · ${bankCodeLabel(p)}`);

/** The "to pay, by supplier" sorts: longest waiting first unless asked. */
const GROUP_SORTS = Object.freeze({
  oldest: (a, b) => new Date(a.oldestAt) - new Date(b.oldestAt),
  total_desc: (a, b) => b.total - a.total,
  count_desc: (a, b) => b.count - a.count,
  name: (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
});

/**
 * Approved supplier payments, one row per place the money goes (same bank account
 * or UPI ID): how many, and the total. Admin and accounts.
 *
 * Search / filter / sort work on the groups, after grouping: the open queue is
 * one bounded read (TO_PAY_CAP), so this adds no query. A group matches when every
 * typed word is in its supplier name, UPI ID, bank, IFSC / SWIFT, or one of its payments'
 * PR number, order number or customer — or is its total or one payment's amount.
 * A match shows the whole group (its count and total stay what is to pay).
 */
export async function supplierPayGroups(actor, params = {}) {
  if (!seesAll(actor)) throw fail('Not authorized.', 403);
  const f = plainQuery(params);
  const rows = await paymentRequestRepository.findSupplierToPay(TO_PAY_CAP);
  const groups = new Map();
  const text = new Map();
  const amounts = new Map();
  for (const r of rows) {
    const id = groupIdOf(r);
    const g = groups.get(id) || {
      id, name: r.payee.name, method: r.payee.method, destination: destinationLabel(r.payee),
      count: 0, total: 0, onHold: 0, bankNotice: false, oldestAt: r.createdAt,
    };
    g.name = r.payee.name; // newest name wins (rows are oldest first)
    g.count += 1;
    g.total = round2(g.total + r.amount);
    if (r.status === 'on_hold') g.onHold += 1;
    if (r.bankNotice?.at) g.bankNotice = true;
    groups.set(id, g);
    const p = r.payee || {};
    text.set(id, `${text.get(id) || ''} ${[p.name, p.upiId, p.bankName, p.ifsc, p.swift, g.destination, r.number, r.orderNumber, r.customer?.name].filter(Boolean).join(' ')}`.toLowerCase());
    amounts.set(id, [...(amounts.get(id) || []), r.amount]);
  }
  const words = searchWords(f.q);
  const matches = (g) => (!['bank', 'upi'].includes(f.method) || g.method === f.method)
    && words.every((w) => text.get(g.id).includes(w) || (amountOf(w) !== null && (g.total === amountOf(w) || amounts.get(g.id).includes(amountOf(w)))));
  const sortName = GROUP_SORTS[f.sort] ? f.sort : 'oldest';
  const shown = [...groups.values()].filter(matches).sort(GROUP_SORTS[sortName]);
  return {
    groups: shown,
    sort: sortName,
    summary: { count: shown.length, total: round2(shown.reduce((n, g) => n + g.total, 0)), capped: false },
    truncated: rows.length >= TO_PAY_CAP,
  };
}

/** One destination's approved supplier payments, oldest first. */
export async function supplierPayGroup(actor, groupId) {
  if (!seesAll(actor)) throw fail('Not authorized.', 403);
  const rows = (await paymentRequestRepository.findSupplierToPay(TO_PAY_CAP)).filter((r) => groupIdOf(r) === String(groupId));
  if (!rows.length) throw fail('Nothing left to pay for this supplier.', 404);
  return {
    id: String(groupId),
    name: rows[rows.length - 1].payee.name,
    destination: destinationLabel(rows[0].payee),
    total: round2(rows.reduce((n, r) => n + r.amount, 0)),
    requests: await withDeals(rows, (r) => shape(r, actor)),
  };
}

/**
 * The admin records ONE transfer that paid several approved supplier requests to
 * the same account. All of them become paid together, or none does: they are
 * moved in one transaction, each by the same compare-and-set as a single payment.
 * `expectedTotal` is the total the admin saw and sent; if the requests no longer
 * add up to it (one was held or paid meanwhile), nothing changes.
 * Unticked requests are untouched and stay in the queue.
 */
export async function payBatch(actor, { ids, expectedTotal, method, reference, note, transactionAt } = {}, proofFiles = [], req) {
  if (!mayPay(actor)) throw fail('Only the admin pays payment requests — accounts approves them.', 403);
  let list = ids;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = [list]; } }
  const wanted = [...new Set((Array.isArray(list) ? list : []).map(String))];
  if (!wanted.length) throw fail('Tick the payments you are paying.', 400);
  if (wanted.length > MAX_BATCH) throw fail(`Pay at most ${MAX_BATCH} at a time.`, 400);
  if (wanted.some((id) => !/^[a-f0-9]{24}$/i.test(id))) throw fail('Request not found.', 404);
  const how = ['razorpay', 'bank', 'upi', 'other'].includes(method) ? method : null;
  if (!how) throw fail('Choose how it was paid.', 400);
  const ref = String(reference || '').trim(); // optional, as for a single payment
  const txAt = cleanTransactionAt(transactionAt);

  const rows = await paymentRequestRepository.findByIds(wanted);
  if (rows.length !== wanted.length) throw fail('Request not found.', 404);
  const notReady = rows.filter((r) => r.kind !== 'supplier' || !TO_PAY.includes(r.status));
  if (notReady.length) {
    throw fail(`${notReady.map((r) => r.number).join(', ')} ${notReady.length === 1 ? 'is' : 'are'} not waiting to be paid — refresh the list.`, 409);
  }
  // One transfer carries one rupee debit; a foreign bill needs its own (markPaid records it).
  const foreign = rows.filter((r) => (r.currency || BASE_CURRENCY) !== BASE_CURRENCY);
  if (foreign.length) {
    throw fail(`${foreign.map((r) => r.number).join(', ')} ${foreign.length === 1 ? 'is a foreign-currency bill' : 'are foreign-currency bills'} — pay ${foreign.length === 1 ? 'it' : 'each'} on its own and record the rupees the bank debited.`, 400);
  }
  if (new Set(rows.map((r) => payKeyOf(r.payee, idOf(r._id)))).size !== 1) {
    throw fail('These payments go to different accounts — pay one supplier at a time.', 400);
  }
  // One cancelled order refuses the whole transfer, before any money is recorded.
  for (const r of rows) await assertOrderLive(r);
  const total = round2(rows.reduce((n, r) => n + r.amount, 0));
  if (round2(expectedTotal) !== total) {
    throw fail(`The total is now ${inr(total)}, not ${inr(round2(expectedTotal) || 0)} — refresh and check before paying.`, 409);
  }

  const uploads = (Array.isArray(proofFiles) ? proofFiles : [proofFiles]).filter(Boolean);
  const fullest = Math.max(0, ...rows.map((r) => (r.files || []).length));
  const proof = uploads.length ? await storeFiles(uploads, uploads.map(() => 'proof'), actor, { existing: fullest }) : [];
  const batch = `PB-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const now = new Date();
  const payment = { method: how, reference: ref.slice(0, 120), paidAt: now, transactionAt: txAt, paidBy: actor._id, paidByName: actor.name || '', batch };
  const together = `one transfer for ${rows.length} payment${rows.length === 1 ? '' : 's'}, ${inr(total)}`;
  const log = entry(actor, 'paid', [`${how.toUpperCase()} ${ref}`.trim(), together, note].filter(Boolean).join(' — '));

  let paid;
  try {
    paid = await paymentRequestRepository.inTransaction(async (session) => {
      const out = [];
      for (const r of rows) {
        const next = await paymentRequestRepository.transitionInSession(r._id, TO_PAY, { kind: 'supplier' },
          { status: 'paid', payment }, log, proof.length ? { files: { $each: proof } } : {}, session);
        if (!next) throw fail(MOVED, 409); // aborts: none of them is marked paid
        out.push(next);
      }
      return out;
    });
  } catch (err) {
    // Nothing was recorded, so the screenshot belongs to no payment.
    await Promise.all(proof.map((f) => deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: resourceTypeOf(f) }).catch(() => {})));
    throw err;
  }

  for (const r of paid) {
    auditLogger.logAction(req, 'UPDATE', 'PaymentRequest', idOf(r._id), { change: 'paid', method: how, reference: ref, batch });
    await followOnOrder(r, actor, 'paid');
    await tellChat(r, 'paid', `💸 Paid ${what(r)} — ${how.toUpperCase()}${ref ? ` ref ${ref}` : ''} (${together}). Procurement: get the shipping details from the supplier and upload them.`, { mentionRequester: true });
  }
  return { batch, total, count: paid.length, requests: paid.map((r) => shape(r, actor)) };
}
