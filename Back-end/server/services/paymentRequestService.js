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
  BASE_CURRENCY, MAX_FX_RATE, MIN_FX_RATE, categoriesFor, categoryLabel, expenseOptionsFor,
  findCategory, isCurrencyAllowed, noteRequiredFor,
} from '../config/expenseCategories.js';
import { workflowView, STAGE } from '../utils/teamWorkflow.js';
import { variantDisplayName } from '../utils/orderLines.js';
import { cleanPayee, maskAccount, payKeyOf } from '../utils/payee.js';
import * as suppliers from './supplierService.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v == null ? '' : String(v._id ?? v));

export const PAYMENT_FILES_FOLDER = 'payment-requests'; // a PRIVATE prefix (storage/assetScope.js)
export const MAX_PAYMENT_FILE_BYTES = MAX_ATTACHMENT_BYTES;
export const MAX_AMOUNT = 10000000; // ₹1 crore: a typo guard, not a business limit
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
const mayEdit = (u, r) => EDITABLE.includes(r.status) && (
  isAdmin(u)
  || (r.status === 'submitted' && (idOf(r.requestedBy) === idOf(u?._id)
    || (isActiveStaff(u) && u.staff.isHead === true && u.staff.team === r.team)))
);

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
 * The money on an expense: always rupees in `amount`, plus — for a foreign bill —
 * its currency, amount and the quoted rate. The rupees are worked out HERE from
 * those two; a client-sent rupee figure that disagrees is refused rather than
 * trusted or silently replaced.
 *
 * `current` (an edit): fields not sent keep their value, and the currency is
 * checked against the team's list only when it changes — an old record keeps
 * the currency it was raised in.
 */
function cleanMoney(team, input, current = null) {
  const was = current ? (current.currency || BASE_CURRENCY) : null;
  const currency = filled(input.currency) ? String(input.currency).trim().toUpperCase() : (was || BASE_CURRENCY);
  if (currency !== was && !isCurrencyAllowed(team, currency)) {
    throw fail(currency === BASE_CURRENCY ? 'Choose the currency.' : `${STAFF_TEAM_LABELS[team] || team} expenses are claimed in rupees (₹).`, 400);
  }
  if (currency === BASE_CURRENCY) {
    const amount = filled(input.amount) || !current ? cleanAmount(input.amount) : current.amount;
    return { amount, currency, foreignAmount: null, fxRate: null };
  }
  const foreignAmount = round2(filled(input.foreignAmount) ? input.foreignAmount : current?.foreignAmount);
  if (!Number.isFinite(foreignAmount) || foreignAmount <= 0) throw fail(`Enter the bill amount in ${currency}.`, 400);
  const rate = Number(filled(input.fxRate) ? input.fxRate : current?.fxRate);
  const fxRate = Math.round(rate * 1e6) / 1e6;
  if (!Number.isFinite(fxRate) || fxRate < MIN_FX_RATE || fxRate > MAX_FX_RATE) {
    throw fail(`Enter the exchange rate from your bank or forex quote: rupees for 1 ${currency} (e.g. 2.45).`, 400);
  }
  const amount = cleanAmount(foreignAmount * fxRate);
  if (filled(input.amount) && round2(input.amount) !== amount) {
    throw fail(`The rupee amount is worked out from the ${currency} amount and the rate (${inr(amount)}). Change those instead.`, 400);
  }
  return { amount, currency, foreignAmount, fxRate };
}

/** "THB 10,000 @ ₹2.45" — for chat, the slip and the edit log; '' for a rupee request. */
export const foreignLine = (r) => (r?.currency && r.currency !== BASE_CURRENCY && r.foreignAmount != null
  ? `${r.currency} ${Number(r.foreignAmount).toLocaleString('en-IN', { maximumFractionDigits: 2 })} @ ₹${r.fxRate}`
  : '');

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
  ? `supplier payment ${r.number} — ${inr(r.amount)} to ${r.payee.name}${r.orderNumber ? ` for ${r.orderNumber}` : ''}`
  : `${categoryLabel(r.category)} expense ${r.number} — ${inr(r.amount)}${foreignLine(r) ? ` (${foreignLine(r)})` : ''} to ${r.payee.name}`);

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
    amount: r.amount, // rupees, always
    // Records from before currencies have none: they are rupees.
    currency: r.currency || BASE_CURRENCY,
    foreignAmount: r.foreignAmount ?? null,
    fxRate: r.fxRate ?? null,
    category: r.category,
    categoryLabel: categoryLabel(r.category),
    description: r.description,
    payee: {
      ...r.payee,
      // Full bank number only for the people who pay it and the person who asked.
      accountNumber: full ? r.payee?.accountNumber || '' : maskAccount(r.payee?.accountNumber),
    },
    order: r.order ? { id: idOf(r.order), number: r.orderNumber } : null,
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

  const { files, kinds } = filesFrom(uploaded);
  requireUpiOrQr(payee, kinds);
  const stored = await storeFiles(files, kinds, actor);
  const doc = await paymentRequestRepository.create({
    number: await nextNumber(),
    kind: 'expense',
    status: 'submitted',
    team,
    requestedBy: actor._id,
    requestedByName: actor.name || '',
    ...money, category, description, payee,
    files: stored,
    history: [entry(actor, 'submitted')],
  });
  auditLogger.logAction(req, 'CREATE', 'PaymentRequest', doc._id, { kind: 'expense', amount, team, currency: money.currency });
  await tellChat(doc, 'submitted', `🧾 New ${what(doc)} from ${doc.requestedByName} (${STAFF_TEAM_LABELS[team]}). Accounts: please approve or decline.`);
  return shape(doc, actor);
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

  const wanted = [...new Set((Array.isArray(input.itemIds) ? input.itemIds : [input.itemIds]).filter(Boolean).map(String))];
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

  const amount = cleanAmount(input.amount);
  const { payee, supplierId, bankNotice } = await supplierPayee(actor, input, req);
  const description = String(input.description || '').trim().slice(0, 2000);
  const { files, kinds } = filesFrom(uploaded);
  requireUpiOrQr(payee, kinds);

  const stored = await storeFiles(files, kinds, actor);

  const items = (order.items || []).filter((i) => wanted.includes(idOf(i._id)));
  const doc = await paymentRequestRepository.create({
    number: await nextNumber(),
    kind: 'supplier',
    status: 'submitted',
    team: STAFF_TEAMS.PROCUREMENT,
    requestedBy: actor._id,
    requestedByName: actor.name || '',
    amount,
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
    files: stored,
    history: [entry(actor, 'submitted')],
  });
  auditLogger.logAction(req, 'CREATE', 'PaymentRequest', doc._id, { kind: 'supplier', amount, orderId: idOf(order._id) });
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

export async function approve(actor, id, { note } = {}, req) {
  await loadVisible(actor, id);   // 404s a request this person may not see
  if (!mayDecide(actor)) throw fail('Only accounts (or an admin) approves payments.', 403);
  const r = await paymentRequestRepository.transition(id, ['submitted'],
    { status: 'approved', approvedBy: actor._id, approvedAt: new Date(), decisionNote: String(note || '').slice(0, 1000) },
    entry(actor, 'approved', note));
  if (!r) throw fail(MOVED, 409);
  auditLogger.logAction(req, 'UPDATE', 'PaymentRequest', id, { change: 'approved' });
  await tellChat(r, 'approved', `✅ ${isAdmin(actor) ? 'Admin' : 'Accounts'} approved ${what(r)}. Admin: please pay and record the payment.`, { mentionAdmins: true });
  return shape(r, actor);
}

export async function decline(actor, id, { note } = {}, req) {
  await loadVisible(actor, id);   // 404s a request this person may not see
  if (!mayDecide(actor)) throw fail('Only accounts (or an admin) declines payments.', 403);
  const reason = String(note || '').trim();
  if (reason.length < 3) throw fail('Say why it is declined — the requester sees this.', 400);
  const r = await paymentRequestRepository.transition(id, ['submitted', 'on_hold'],
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

/** The admin records the payment made (Razorpay / bank / UPI), with a reference and a screenshot. */
export async function markPaid(actor, id, { method, reference, note, transactionAt } = {}, proofFiles = [], req) {
  if (!mayPay(actor)) throw fail('Only the admin pays payment requests — accounts approves them.', 403);
  const how = ['razorpay', 'bank', 'upi', 'other'].includes(method) ? method : null;
  if (!how) throw fail('Choose how it was paid.', 400);
  // Optional: not every payment has one to hand (cash, some UPI apps).
  const ref = String(reference || '').trim();
  const now = new Date();
  const txAt = cleanTransactionAt(transactionAt, now.getTime());
  const r0 = await loadVisible(actor, id);
  // The admin paying a request still waiting for approval approves it in the same step.
  const from = ['submitted', 'approved', 'on_hold'];
  const uploads = (Array.isArray(proofFiles) ? proofFiles : [proofFiles]).filter(Boolean);
  const proof = uploads.length ? await storeFiles(uploads, uploads.map(() => 'proof'), actor, { existing: (r0.files || []).length }) : [];
  const r = await paymentRequestRepository.transition(id, from, {
    ...(r0.status === 'submitted' ? { approvedBy: actor._id, approvedAt: now } : {}),
    status: 'paid',
    payment: { method: how, reference: ref.slice(0, 120), paidAt: now, transactionAt: txAt, paidBy: actor._id, paidByName: actor.name || '' },
  }, entry(actor, 'paid', [`${how.toUpperCase()} ${ref}`.trim(), note].filter(Boolean).join(' — ')), proof.length ? { files: { $each: proof } } : {});
  if (!r) {
    // Lost the race: the screenshot belongs to no payment.
    await Promise.all(proof.map((f) => deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: resourceTypeOf(f) }).catch(() => {})));
    throw fail(MOVED, 409);
  }
  auditLogger.logAction(req, 'UPDATE', 'PaymentRequest', id, { change: 'paid', method: how, reference: ref });
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
      : 'Only whoever raised it (or their team head) can edit it while it waits for accounts. Ask an admin to change it now.', 403);
  }
  const isExpense = r0.kind === 'expense';
  const before = { currency: r0.currency || BASE_CURRENCY, foreignAmount: r0.foreignAmount ?? null, fxRate: r0.fxRate ?? null };
  // A supplier payment is rupees; an expense may be a foreign bill (worked out in cleanMoney).
  const money = isExpense
    ? cleanMoney(r0.team, input, { amount: r0.amount, ...before })
    : { amount: filled(input.amount) ? cleanAmount(input.amount) : r0.amount, ...before };
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
  if (amount !== r0.amount) changes.push(`amount ${inr(r0.amount)} → ${inr(amount)}`);
  if (fxChanged) changes.push(`bill ${foreignLine(before) || 'in rupees'} → ${foreignLine(money) || 'in rupees'}`);
  if (payee.name !== r0.payee.name) changes.push(`payee ${r0.payee.name} → ${payee.name}`);
  if (payKeyOf(payee, 'x') !== payKeyOf(r0.payee, 'x')) changes.push('payment details');
  if (description !== (r0.description || '')) changes.push('details');
  if (category !== r0.category) changes.push(`for ${categoryLabel(r0.category)} → ${categoryLabel(category)}`);
  if (!changes.length) return shape(r0, actor);

  const moneyChanged = amount !== r0.amount || fxChanged || payee.name !== r0.payee.name || payKeyOf(payee, 'x') !== payKeyOf(r0.payee, 'x');
  const backToAccounts = r0.status !== 'submitted' && moneyChanged;
  const note = changes.join(', ') + (backToAccounts ? ' — back to accounts to approve again' : '');
  const r = await paymentRequestRepository.transitionInSession(id, [r0.status], { updatedAt: r0.updatedAt }, {
    amount, currency: money.currency, foreignAmount: money.foreignAmount, fxRate: money.fxRate,
    description, category, payee, supplier, bankNotice,
    ...(backToAccounts ? { status: 'submitted', approvedBy: null, approvedAt: null, decisionNote: '' } : {}),
  }, entry(actor, 'edited', note), {}, undefined);
  if (!r) throw fail(MOVED, 409);
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
export async function editPayment(actor, id, { method, reference, note, removeFileIds, transactionAt } = {}, proofFiles = [], req) {
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

  const changes = [];
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
        const next = await paymentRequestRepository.editPaidInSession(tid, { 'payment.method': how, 'payment.reference': ref, ...(txAt ? { 'payment.transactionAt': txAt } : {}) }, log, stored, session);
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

const decodeCursor = (c) => {
  try {
    const [iso, id] = Buffer.from(String(c), 'base64url').toString().split('|');
    const createdAt = new Date(iso);
    return Number.isNaN(createdAt.getTime()) || !/^[a-f0-9]{24}$/i.test(id || '') ? null : { createdAt, id };
  } catch { return null; }
};
const encodeCursor = (r) => Buffer.from(`${new Date(r.createdAt).toISOString()}|${idOf(r._id)}`).toString('base64url');

/**
 * A page of requests. Admin and accounts see every team (filter by `team`);
 * anyone else sees their own team's. `status` narrows to one state, 'open'
 * (not finished), 'to_approve' (accounts' queue) or 'to_pay' (approved or on
 * hold — the admin's queue).
 */
export async function list(actor, { status, team, cursor } = {}) {
  if (!seesAll(actor) && !isActiveStaff(actor)) throw fail('Not authorized.', 403);
  const query = {};
  if (seesAll(actor)) { if (team) query.team = String(team); } else query.team = actor.staff.team;
  if (status === 'open') query.status = { $in: OPEN_STATUSES };
  else if (status === 'to_approve') query.status = 'submitted';
  else if (status === 'to_pay') query.status = { $in: ['approved', 'on_hold'] };
  else if (status && STATUS_LABELS[status]) query.status = status;
  const before = cursor ? decodeCursor(cursor) : null;
  const rows = await paymentRequestRepository.page(query, { before, limit: PAGE_SIZE + 1 });
  const items = rows.slice(0, PAGE_SIZE);
  return {
    requests: items.map((r) => shape(r, actor)),
    nextCursor: rows.length > PAGE_SIZE ? encodeCursor(items[items.length - 1]) : null,
  };
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

export async function get(actor, id) {
  return shape(await loadVisible(actor, id), actor);
}

/** Supplier requests for an order, for the procurement order panel. */
export async function forOrder(actor, orderId) {
  if (!seesAll(actor) && !isActiveStaff(actor)) throw fail('Not authorized.', 403);
  if (!/^[a-f0-9]{24}$/i.test(String(orderId))) return [];
  const rows = await paymentRequestRepository.findForOrder(orderId);
  return rows.map((r) => ({
    id: idOf(r._id), number: r.number, status: r.status, statusLabel: STATUS_LABELS[r.status],
    amount: r.amount, itemIds: (r.itemIds || []).map(idOf), itemNames: r.itemNames || [],
    payee: r.payee?.name || '', paidAt: r.payment?.paidAt || null, createdAt: r.createdAt,
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
  return loadVisible(actor, id);
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

const destinationLabel = (p = {}) => (p.method === 'upi' ? (p.upiId ? `UPI ${p.upiId}` : 'UPI by QR (see the request)') : `${p.bankName || 'Bank'} ${maskAccount(p.accountNumber)} · ${p.ifsc}`);

/**
 * Approved supplier payments, one row per place the money goes (same bank account
 * or UPI ID): how many, and the total. Admin and accounts.
 */
export async function supplierPayGroups(actor) {
  if (!seesAll(actor)) throw fail('Not authorized.', 403);
  const rows = await paymentRequestRepository.findSupplierToPay(TO_PAY_CAP);
  const groups = new Map();
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
  }
  return {
    groups: [...groups.values()].sort((a, b) => new Date(a.oldestAt) - new Date(b.oldestAt)),
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
    requests: rows.map((r) => shape(r, actor)),
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
  if (new Set(rows.map((r) => payKeyOf(r.payee, idOf(r._id)))).size !== 1) {
    throw fail('These payments go to different accounts — pay one supplier at a time.', 400);
  }
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
