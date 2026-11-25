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
 *   put on hold                accounts or admin — a brake, on an approved request:
 *                              a held request CANNOT be paid until it is released
 *   release a hold             accounts or admin — back to approved, payable again
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
import { slipProvenance, markEdited } from './slipReader/slipReaderService.js';
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
  filterCategories, findCategory, isCurrencyAllowed, noteRequiredFor, SUBSCRIPTION_CATEGORY, REIMBURSEMENT, REIMBURSEMENT_TYPES,
} from '../config/expenseCategories.js';
import * as claims from './reimbursement.js';
import { taskForLink, taskFields, taskCode } from './taskLink.js';
import { workflowView, STAGE } from '../utils/teamWorkflow.js';
import { variantDisplayName } from '../utils/orderLines.js';
import { bankCodeLabel, cardLabelOf, cleanPayee, maskAccount, payKeyOf } from '../utils/payee.js';
import {
  and, amountOf, amountRange, isObjectId, istRange, keysetPage, plainQuery, searchClauses, searchWords,
} from '../utils/listQuery.js';
import * as suppliers from './supplierService.js';
import * as deals from './supplierDealService.js';
import * as bills from './supplierBillService.js';
import { itemsCancelled } from './supplierAdvanceGuard.js';
import { partForRequest, requestPartReplaced } from '../utils/supplierParts.js';
import * as credit from './supplierLedgerService.js';
import { projectForLink, projectCode } from './staffProjectService.js';
import { toPaise, fromPaise } from '../utils/money.js';
import { cleanRichTextWithin, richTextLength } from '../utils/richText.js';

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
  Editing (owner decision 2026-11-21, "edit until accounts or admin approves"):
  only WHOEVER RAISED IT, or the admin, and only before approval —
    submitted  edit in place; it stays waiting for accounts.
    on_hold    edit (e.g. answer a queried bill); it goes back to accounts as submitted.
    declined   edit and send again: the same PR goes back to accounts as submitted.
               Not a supplier deal part or one that used supplier credit — declining
               gave their share / credit back, so those are raised afresh.
  Approved, paid and cancelled are locked. Every edit needs a reason and is kept
  in `edits` (old → new); `rev` makes an edit and an approval at the same moment
  end with exactly one of them landing (update + approve compare-and-set on it).
*/
const EDITABLE = Object.freeze(['submitted', 'on_hold', 'declined']);
const resubmittable = (r) => r.status !== 'declined' || r.kind === 'expense' || (!r.deal && !r.supplierBill && !r.credit?.amount);
// A subscription / due expense ("Mark paid") is not edited here: its money follows the
// item's own rules, and a declined one reopens the cycle to be marked paid again —
// resending it as well could pay that cycle twice.
const fromSubscription = (r) => Boolean(r.subscription?.item);
const mayEdit = (u, r) => EDITABLE.includes(r.status) && resubmittable(r) && !fromSubscription(r)
  && (isAdmin(u) || idOf(r.requestedBy) === idOf(u?._id));
/** The compare-and-set clause for "still the version that was read" (old records have no rev). */
const revIs = (rev) => ({ rev: Number(rev) > 0 ? Number(rev) : { $in: [0, null] } });

/** Who may link / unlink a request to an order, project or reference: who raised it, their team head, accounts, the admin. */
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

// Details may be formatted (see utils/richText.js): limits and "is it filled in"
// count the words, not the markup.
const DESCRIPTION_MAX = 2000;
function cleanDetails(raw) {
  const { value, tooLong } = cleanRichTextWithin(raw, DESCRIPTION_MAX);
  if (tooLong) throw fail(`Details are too long — keep them under ${DESCRIPTION_MAX} characters.`, 400);
  return value;
}

function checkNote(team, category, description) {
  if (noteRequiredFor(team, category) && richTextLength(description) < 3) {
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
 * The money on a Reimbursement (services/reimbursement.js): always rupees. Fuel is
 * km × the per-km rate — any amount the browser sent is ignored. Food /
 * Transportation / Others are the typed amount (on an edit, unchanged if not sent).
 * `current`: the request as stored (an edit), whose claim details and rate carry over.
 */
async function claimMoney(input, current = null) {
  if (filled(input.currency) && String(input.currency).trim().toUpperCase() !== BASE_CURRENCY) {
    throw fail('A reimbursement is paid in rupees — enter the amount in ₹.', 400);
  }
  const was = current?.category === REIMBURSEMENT ? current.reimbursement || null : null;
  const { reimbursement, amount: worked } = await claims.cleanClaim(input.reimbursement, { current: was });
  const amount = worked ?? (filled(input.amount) || !current ? cleanAmount(input.amount) : current.amount);
  if (worked != null && worked > MAX_AMOUNT) throw fail('That amount looks too large — check the km.', 400);
  return { reimbursement, money: { amount, currency: BASE_CURRENCY, foreignAmount: null, fxRate: null } };
}

/** The parts of a claim an edit compares. */
const claimDiffKey = (c) => [c.type, c.on, c.km ?? null, c.ratePerKm ?? null, c.from || '', c.to || ''];

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

/**
 * The money moved when supplier credit pays part of the bill: the bill less the
 * credit, in the bill's own field (rupees: `amount`; a foreign bill: `foreignAmount`).
 * Something must still be transferred.
 */
function netOfCredit(money, creditPaise) {
  if (!creditPaise) return money;
  const field = money.currency === BASE_CURRENCY ? 'amount' : 'foreignAmount';
  const billPaise = toPaise(money[field]);
  if (creditPaise >= billPaise) {
    throw fail(`The bill (${deals.moneyOf(billPaise, money.currency)}) must be more than the supplier credit used on it (${deals.moneyOf(creditPaise, money.currency)}).`, 400);
  }
  return { ...money, [field]: fromPaise(billPaise - creditPaise) };
}

/** Paid from a foreign-currency account (no rupees were debited): its `payment.fromAccount`, or null. */
export const paidFromForeign = (r) => (r?.status === 'paid' && r.payment?.fromAccount?.currency ? r.payment.fromAccount : null);

/**
 * A foreign bill whose rupees are not recorded yet (raised without a rate, not paid).
 * Not one paid from a foreign account: that has no rupees at all, by design.
 */
export const rupeesPending = (r) => Boolean(r?.currency && r.currency !== BASE_CURRENCY && !(Number(r.amount) > 0) && !paidFromForeign(r));

/** "THB 10,000" — a foreign amount in its currency. */
const unitsText = (currency, amount) => `${currency} ${Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * A foreign bill paid from a foreign-currency account (e.g. HR's Thai bank
 * account): no rupees were debited. What was sent must be the bill itself — the
 * same currency, and the same amount to the last satang / cent — so the supplier's
 * balance moves exactly as for a payment from the rupee account. A wrong bill is
 * edited first; a figure that does not match is refused, never recorded.
 * Returns the `payment.fromAccount` record.
 */
function cleanFromAccount(r, { sentAmount, sentCurrency, accountLabel }) {
  const bill = r.currency || BASE_CURRENCY;
  if (bill === BASE_CURRENCY || r.foreignAmount == null) {
    throw fail('This bill is in rupees — record it as paid from the Indian rupee account.', 400);
  }
  const cur = filled(sentCurrency) ? String(sentCurrency).trim().toUpperCase().slice(0, 8) : bill;
  if (cur !== bill) throw fail(`This bill is in ${bill} — it can be paid from a ${bill} account or the Indian rupee account, not ${cur}.`, 400);
  const typed = String(sentAmount ?? '').replace(/,/g, '').trim();
  if (!typed) throw fail(`Enter the ${bill} amount sent.`, 400);
  if (!/^\d+(\.\d{1,2})?$/.test(typed) || !(Number(typed) > 0)) {
    throw fail(`Enter the ${bill} amount sent as a number with at most two decimals, e.g. 10000 or 10000.50.`, 400);
  }
  if (toPaise(typed) !== toPaise(r.foreignAmount)) {
    throw fail(`This bill is ${unitsText(bill, r.foreignAmount)}, so that is what is sent — you entered ${unitsText(bill, typed)}. If the bill is wrong, edit the request first.`, 400);
  }
  const label = String(accountLabel ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return { currency: bill, amount: fromPaise(toPaise(typed)), label };
}

/** "THB 10,000 sent from HR's Thailand account (no rupees debited)". */
const fromAccountText = (a) => `${unitsText(a.currency, a.amount)} sent from ${a.label || `a ${a.currency} account`} (no rupees debited)`;

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
const moneyText = (r) => (paidFromForeign(r)
  ? `${foreignLine(r)} (paid from ${paidFromForeign(r).label || `a ${r.currency} account`})`
  : rupeesPending(r)
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

/**
 * A supplier's UPI payee needs their UPI ID or a payment QR — one way or the
 * other to pay them. Expense requests may leave it for accounts (`optional`).
 */
function requireUpiOrQr(payee, kinds, { optional = false } = {}) {
  if (optional) return;
  if (payee.method === 'upi' && !payee.upiId && !kinds.includes('qr')) {
    throw fail('Enter their UPI ID, or attach their payment QR.', 400);
  }
}

/** How the admin paid it: the same list everywhere (pay, pay in one transfer, correct a payment). */
export const PAID_METHODS = Object.freeze(['razorpay', 'bank', 'upi', 'card', 'other']);
const paidMethodOf = (m) => (PAID_METHODS.includes(m) ? m : null);

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
  : `${expenseLabel(r)} expense ${r.number} — ${moneyText(r)}${r.payee?.name ? ` to ${r.payee.name}` : ''}`);

/** "Reimbursement – Fuel (42 km × ₹15)" for a reimbursement; the category's name otherwise. */
export const expenseLabel = (r) => (r?.category === REIMBURSEMENT && r.reimbursement?.type
  ? `${categoryLabel(r.category)} – ${claims.claimLabel(r.reimbursement)}`
  : categoryLabel(r?.category));

// ── Shapes ───────────────────────────────────────────────────────────────────

/**
 * A held request's hold, for every view that lists it: why (decisionNote — what
 * hold() saved), and who held it and when (its latest 'on_hold' history entry).
 * null unless it is on hold now. The status is the one source of truth; this only
 * reads it, so a hold shows the same everywhere and ends wherever it ends.
 */
export function holdOf(r) {
  if (r?.status !== 'on_hold') return null;
  const h = [...(r.history || [])].reverse().find((e) => e.action === 'on_hold') || null;
  return { note: r.decisionNote || h?.note || '', byName: h?.byName || '', role: h?.role || '', at: h?.at || null };
}

/** Rows read without their history (the lists): fetch it for the held ones only, so holdOf can name who held it. */
async function withHoldHistory(rows) {
  const held = rows.filter((r) => r.status === 'on_hold' && !r.history);
  if (!held.length) return rows;
  const found = new Map((await paymentRequestRepository.findHistories(held.map((r) => r._id))).map((x) => [idOf(x._id), x.history || []]));
  return rows.map((r) => (r.status === 'on_hold' && !r.history ? { ...r, history: found.get(idOf(r._id)) || [] } : r));
}

/**
 * A subscription expense is approved by someone other than whoever marked it paid —
 * accounts or the admin, never their own (they recorded the payment themselves).
 */
const ownSubscriptionExpense = (u, r) => Boolean(r?.subscription) && idOf(r.requestedBy) === idOf(u?._id);

const subscriptionOf = (r) => (r.subscription?.item ? {
  id: idOf(r.subscription.item),
  number: r.subscription.number,
  name: r.subscription.name || '',
  cycleDueDate: r.subscription.cycleDueDate,
  alreadyPaid: Boolean(r.subscription.alreadyPaid),
  paid: r.subscription.paid ? {
    method: r.subscription.paid.method,
    autoDebit: Boolean(r.subscription.paid.autoDebit),
    on: r.subscription.paid.on,
    reference: r.subscription.paid.reference || '',
  } : null,
} : null);

/** After a subscription expense moves: its cycle follows (subscriptionDueService). Never throws. */
async function followOnSubscription(r) {
  if (!r?.subscription?.item) return;
  try {
    const subs = await import('./subscriptionDueService.js');
    await subs.settleFromExpense(r);
  } catch (err) {
    // The expense is the source of truth; the item re-syncs when it is next opened.
    console.error(`[PaymentRequest] ${r.number}: subscription cycle not updated:`, err.message);
  }
}

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
    // Paid from a foreign-currency account: what was sent, from which account. No rupees.
    paidFrom: paidFromForeign(r) ? { currency: r.payment.fromAccount.currency, amount: r.payment.fromAccount.amount, label: r.payment.fromAccount.label || '' } : null,
    category: r.category,
    categoryLabel: r.kind === 'expense' ? expenseLabel(r) : categoryLabel(r.category),
    // A Reimbursement's kind, date, and for Fuel the km and the rate it was claimed at.
    reimbursement: r.reimbursement?.type ? {
      type: r.reimbursement.type,
      on: r.reimbursement.on,
      km: r.reimbursement.km ?? null,
      ratePerKm: r.reimbursement.ratePerKm ?? null,
      from: r.reimbursement.from || '',
      to: r.reimbursement.to || '',
    } : null,
    description: r.description,
    payee: {
      ...r.payee,
      // Full bank number only for the people who pay it and the person who asked.
      accountNumber: full ? r.payee?.accountNumber || '' : maskAccount(r.payee?.accountNumber),
    },
    order: r.order ? { id: idOf(r.order), number: r.orderNumber } : null,
    // The snapshot taken when it was linked: still reads right after a rename or delete.
    project: r.project ? { id: idOf(r.project), code: r.projectCode || '', name: r.projectName || '' } : null,
    task: r.task ? { id: idOf(r.task), code: taskCode(r.taskNumber), title: r.taskTitle || '' } : null,
    reference: r.reference || '',
    // Raised by "Mark paid" on a subscription / due: which one, which cycle, and how it was paid already.
    subscription: subscriptionOf(r),
    // One part of a made-to-order deal (advance / part / balance), or ''.
    dealId: r.deal ? idOf(r.deal) : null,
    // The supplier bill this pays (all or part of), from "We owe suppliers".
    supplierBillId: r.supplierBill ? idOf(r.supplierBill) : null,
    part: r.part || '',
    partLabel: deals.PART_LABELS[r.part] || '',
    itemNames: r.itemNames || [],
    customer: r.customer || null,
    closedBy: r.closedBy || '',
    supplier: r.supplier ? { id: idOf(r.supplier) } : null,
    // Supplier credit used: the bill = what is transferred + this.
    credit: r.credit?.amount ? { amount: r.credit.amount, entryId: idOf(r.credit.entry) } : null,
    bill: r.credit?.amount ? deals.unitsOf(r) : null,
    bankNotice: r.bankNotice?.at ? { at: r.bankNotice.at, byName: r.bankNotice.byName || '' } : null,
    files: (r.files || []).map((f) => ({ id: idOf(f._id), kind: f.kind, name: f.name, contentType: f.contentType, bytes: f.bytes })),
    payment: r.status === 'paid' ? r.payment : null,
    decisionNote: r.decisionNote || '',
    hold: holdOf(r),
    history: (r.history || []).map((h) => ({ at: h.at, byName: h.byName, role: h.role, action: h.action, note: h.note })),
    // Changed after it was submitted: accounts sees the tag in lists and the full
    // old → new history on the request before approving. Lists carry no `edits`.
    rev: r.rev || 0,
    editedAt: r.editedAt || null,
    edits: r.edits ? r.edits.map((e) => ({
      at: e.at, byName: e.byName, role: e.role, reason: e.reason, fromStatus: e.fromStatus || '',
      changes: (e.changes || []).map((c) => ({ field: c.field, from: c.from, to: c.to })),
    })) : undefined,
    createdAt: r.createdAt,
    approver: 'accounts',
    can: {
      approve: mayDecide(viewer) && r.status === 'submitted' && !ownSubscriptionExpense(viewer, r),
      decline: mayDecide(viewer) && ['submitted', 'on_hold'].includes(r.status),
      // Only the admin pays — an approved request, or a waiting one directly
      // (the approval is recorded with the payment).
      // Never while on hold: a hold means "do not pay this yet" (release it first).
      pay: mayPay(viewer) && PAYABLE.includes(r.status) && !r.subscription?.alreadyPaid,
      hold: mayHold(viewer) && r.status === 'approved',
      release: mayHold(viewer) && r.status === 'on_hold',
      cancel: r.status === 'submitted' && (idOf(r.requestedBy) === idOf(viewer?._id) || isHeadOfTeam || isAdmin(viewer)),
      edit: mayEdit(viewer, r),
      // Which order an expense was for: any status (no money changes).
      linkOrder: r.kind === 'expense' && mayLinkOrder(viewer, r),
      // Which project / other ID it belongs to: any kind, any status (no money changes).
      linkProject: mayLinkOrder(viewer, r),
      // After paying: the admin may correct how it was paid, the reference and the screenshots.
      editPayment: mayPay(viewer) && r.status === 'paid',
    },
    // Only for whoever pays: sent back with "Pay" (see payVersionOf).
    ...(mayPay(viewer) ? { payVersion: payVersionOf(r) } : {}),
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
  const description = cleanDetails(input.description);
  // A reimbursement: its details, and for Fuel the server's own amount (km × rate).
  const claim = category === REIMBURSEMENT ? await claimMoney(input) : null;
  if (claim) claims.checkClaimNote(claim.reimbursement, description);
  else checkNote(team, category, description);
  const money = claim ? claim.money : cleanMoney(team, input);
  const { amount } = money;
  // Every pay detail is optional on an expense: accounts usually fills them in.
  const payee = cleanPayee(input.payee, { optional: true });

  const link = await expenseOrderLink(input.orderId);
  const extra = await otherLinks(actor, input);
  // A double-clicked "Submit" or a replayed request: the first one, unchanged.
  const clientId = cleanClientId(input.clientId);
  if (clientId) {
    const seen = await paymentRequestRepository.findByClientId(actor._id, clientId);
    if (seen) return shape(seen, actor);
  }

  const { files, kinds } = filesFrom(uploaded);
  requireUpiOrQr(payee, kinds, { optional: true });
  if (claim) claims.checkClaimBill(claim.reimbursement, amount, kinds);
  const stored = await storeFiles(files, kinds, actor);
  let doc;
  try {
    doc = await paymentRequestRepository.create({
      number: await nextNumber(),
      kind: 'expense',
      ...(claim ? { reimbursement: claim.reimbursement } : {}),
      ...link,
      ...extra,
      status: 'submitted',
      team,
      requestedBy: actor._id,
      requestedByName: actor.name || '',
      ...money, category, description, payee,
      files: stored,
      ...(clientId ? { clientId } : {}),
      history: [entry(actor, 'submitted', extra.projectCode ? `for project ${extra.projectCode}` : '')],
    });
  } catch (err) {
    // The same submit twice at the same moment: the unique index kept one. Drop our copies of the files.
    if (err?.code === 11000 && clientId) {
      const seen = await paymentRequestRepository.findByClientId(actor._id, clientId);
      if (seen) {
        await Promise.all(stored.map((f) => deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: resourceTypeOf(f) }).catch(() => {})));
        return shape(seen, actor);
      }
    }
    throw err;
  }
  auditLogger.logAction(req, 'CREATE', 'PaymentRequest', doc._id, { kind: 'expense', amount, team, currency: money.currency, foreignAmount: money.foreignAmount, ...(link.order ? { orderId: idOf(link.order) } : {}), ...(extra.project ? { projectId: idOf(extra.project) } : {}) });
  await tellChat(doc, 'submitted', `🧾 New ${what(doc)} from ${doc.requestedByName} (${STAFF_TEAM_LABELS[team]}). Accounts: please approve or decline.`);
  return shape(doc, actor);
}

/**
 * The expense for a subscription / due cycle marked paid (subscriptionDueService
 * markPaid builds `spec`: the money from the item, never from the browser).
 *
 * One write, two documents, in one transaction: `claim(session, { id, number })`
 * marks the cycle on the item (a compare-and-set that only one caller wins), and
 * the expense is created beside it. Either both are saved or neither is. A caller
 * that loses the claim gets `{ claimed: null }` and its uploaded receipts are
 * removed. The unique index on `subscription.cycle` is the last guard: one expense
 * per marked cycle, whatever happens.
 */
export async function raiseForSubscription(actor, spec, uploads, claim, req) {
  const files = (uploads || []).filter((f) => f?.buffer?.length);
  const stored = await storeFiles(files, files.map(() => 'bill'), actor);
  const drop = () => Promise.all(stored.map((f) => deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: resourceTypeOf(f) }).catch(() => {})));
  const id = new mongoose.Types.ObjectId();
  const number = await nextNumber();
  let claimed = null;
  let doc = null;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      claimed = null;
      doc = null;
      claimed = await claim(session, { id, number });
      if (!claimed) return;
      doc = await paymentRequestRepository.create({
        _id: id,
        number,
        kind: 'expense',
        status: 'submitted',
        team: spec.team,
        requestedBy: actor._id,
        requestedByName: actor.name || '',
        ...spec.money,
        category: SUBSCRIPTION_CATEGORY,
        description: spec.description,
        payee: { name: spec.payeeName.slice(0, 120), method: '' },
        reference: spec.reference.slice(0, REFERENCE_MAX),
        subscription: spec.subscription,
        files: stored,
        history: [entry(actor, 'submitted', spec.historyNote)],
      }, session);
    });
  } catch (err) {
    await drop();
    throw err;
  } finally {
    await session.endSession();
  }
  if (!doc) {
    await drop();
    return { claimed: null, expense: null };
  }
  auditLogger.logAction(req, 'CREATE', 'PaymentRequest', doc._id, {
    kind: 'expense', amount: doc.amount, team: doc.team, currency: doc.currency, foreignAmount: doc.foreignAmount,
    subscriptionId: idOf(spec.subscription.item), cycleDueDate: spec.subscription.cycleDueDate, alreadyPaid: spec.subscription.alreadyPaid,
  });
  const ask = spec.subscription.alreadyPaid ? 'Already paid — accounts: please approve (it closes as paid) or decline.' : 'Accounts: please approve or decline.';
  await tellChat(doc, 'submitted', `🧾 New ${what(doc)} from ${doc.requestedByName} (${STAFF_TEAM_LABELS[doc.team] || doc.team}) for ${spec.subscription.name} (${spec.subscription.number}), due ${spec.dueText}. ${ask}`);
  return { claimed, expense: shape(doc, actor) };
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

/** The optional project (typed as "PRJ-0007") and other ID on a request: checked, then snapshotted. */
async function otherLinks(actor, input) {
  const [p, t] = await Promise.all([
    projectForLink(actor, input.project, { seesAll: seesAll(actor) }),
    taskForLink(actor, input.task, { seesAll: seesAll(actor) }),
  ]);
  return {
    ...(p ? { project: p._id, projectCode: projectCode(p.number), projectName: p.name || '' } : {}),
    ...(t ? taskFields(t) : {}),
    reference: cleanReference(input.reference),
  };
}

const REFERENCE_MAX = 60;
/** Free text, one line, at most 60 characters; '' for none. */
function cleanReference(raw) {
  if (raw == null) return '';
  if (typeof raw !== 'string') throw fail('The other ID must be text.', 400);
  // eslint-disable-next-line no-control-regex
  const text = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > REFERENCE_MAX) throw fail(`Keep the other ID under ${REFERENCE_MAX} characters.`, 400);
  return text;
}
const cleanClientId = (raw) => (typeof raw === 'string' && /^[\w-]{8,64}$/.test(raw) ? raw : undefined);

/**
 * A supplier payment that is not for one order's item (owner, 2026-11-24): stock,
 * or goods for several orders on one bill. Before this, procurement could only
 * raise these as a "Product purchase" expense with the supplier typed as text —
 * so they never showed under the supplier and could not be paid in one transfer
 * (PR-0144/0145/0146, RK New Popular).
 *
 * The supplier MUST be a saved one (picked from the list, or saved now): that link
 * is what keeps it under "Supplier payments — by supplier". "What was bought" is
 * required, since there are no item names. No order, items, deal or supplier
 * credit (those belong to an order's payment). Idempotent on `clientId`.
 */
async function createStockSupplierRequest(actor, input, uploaded, req) {
  if (filled(input.dealId) || filled(input.partId)) throw fail('A supplier deal or part is paid from its order.', 400);
  if (Number(input.creditToUse) > 0) throw fail('Supplier credit is used on a payment raised from an order.', 400);
  // "Pay" on a bill we owe (supplierBillService): the bill's supplier, in rupees, within what is left on it.
  const bill = filled(input.supplierBillId) ? await bills.billForPayment(input.supplierBillId) : null;
  if (bill) {
    if (filled(input.currency) && String(input.currency).trim().toUpperCase() !== BASE_CURRENCY) throw fail('Supplier bills are paid in rupees.', 400);
    // Whatever the browser sent, the payment goes to the bill's supplier.
    input = { ...input, supplierId: idOf(bill.supplier), saveSupplier: undefined, payee: undefined, currency: BASE_CURRENCY, foreignAmount: undefined };
    if (!filled(input.description)) input.description = `Bill ${bill.billNumber} (${bill.number})`;
    if (!filled(input.reference)) input.reference = bill.billNumber;
  }
  if (!input.supplierId && !truthy(input.saveSupplier)) {
    throw fail('Pick the supplier from the list (or save them as a new supplier), so the payment shows under that supplier.', 400);
  }
  const description = cleanDetails(input.description);
  if (description.replace(/[^a-z]/gi, '').length < 3) throw fail('Say what was bought (for example "20 floor mats, bill 4471").', 400);
  const money = supplierMoney(input, bill ? { currency: BASE_CURRENCY } : null);
  const extra = await otherLinks(actor, input);
  const clientId = cleanClientId(input.clientId);
  if (clientId) {
    const seen = await paymentRequestRepository.findByClientId(actor._id, clientId);
    if (seen) return shape(seen, actor);
  }
  const { files, kinds } = filesFrom(uploaded);
  // Checked before a new supplier is saved, so a refused request saves nothing.
  if (!input.supplierId) requireUpiOrQr(cleanPayee(input.payee), kinds);
  const { payee, supplierId, bankNotice } = await supplierPayee(actor, input, req);
  requireUpiOrQr(payee, kinds);
  // The bill's share is taken before anything is saved, and given back if the save fails.
  const billPaise = bill ? toPaise(money.amount) : 0;
  if (bill) await bills.reserve(bill._id, billPaise);
  let stored;
  try {
    stored = await storeFiles(files, kinds, actor);
  } catch (err) {
    if (bill) await bills.release(bill._id, billPaise, 'files failed');
    throw err;
  }
  let doc;
  try {
    doc = await paymentRequestRepository.create({
      number: await nextNumber(),
      kind: 'supplier',
      status: 'submitted',
      team: STAFF_TEAMS.PROCUREMENT,
      requestedBy: actor._id,
      requestedByName: actor.name || '',
      ...money,
      category: 'supplier',
      description,
      payee,
      ...extra,
      supplier: supplierId,
      bankNotice,
      files: stored,
      ...(clientId ? { clientId } : {}),
      ...(bill ? { supplierBill: bill._id } : {}),
      history: [entry(actor, 'submitted', bill
        ? `for ${bill.supplierName}'s bill ${bill.billNumber} (${bill.number}): ${bills.rupees(billPaise)} of ${bills.rupees(bill.amountPaise)}`
        : 'not for one order (stock / several orders)')],
    });
  } catch (err) {
    if (bill) await bills.release(bill._id, billPaise, 'request failed to save');
    await Promise.all(stored.map((f) => deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: resourceTypeOf(f) }).catch(() => {})));
    // The same submit twice at the same moment: the unique index kept one.
    if (err?.code === 11000 && clientId) {
      const seen = await paymentRequestRepository.findByClientId(actor._id, clientId);
      if (seen) return shape(seen, actor);
    }
    throw err;
  }
  auditLogger.logAction(req, 'CREATE', 'PaymentRequest', doc._id, { kind: 'supplier', stock: true, amount: money.amount, currency: money.currency, foreignAmount: money.foreignAmount, supplierId: idOf(supplierId), ...(bill ? { supplierBillId: idOf(bill._id) } : {}) });
  const warn = bankNotice ? ` ⚠️ This supplier's bank details were changed on ${new Date(bankNotice.at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} by ${bankNotice.byName || 'someone'} — confirm them with the supplier before paying.` : '';
  await tellChat(doc, 'submitted', `🧾 New ${what(doc)} — ${plainLine(description)}. Raised by ${doc.requestedByName}. Accounts: please approve or decline.${warn}`);
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
  // Stock, or several orders' goods on one bill: no single order's item to pay for.
  if (!filled(input.orderId)) return createStockSupplierRequest(actor, input, uploaded, req);
  const order = await orderRepository.findForWorkflow(input.orderId);
  const view = order && workflowView(order);
  if (!view) throw fail('Order not found in the team workflow.', 404);

  // A part of a supplier deal pays for the deal's items — whatever the client sent.
  const deal = input.dealId ? await deals.dealForPayment(input.dealId, order._id) : null;
  const wanted = deal
    ? deal.itemIds.map(idOf)
    : [...new Set((Array.isArray(input.itemIds) ? input.itemIds : [input.itemIds]).filter(Boolean).map(String))];
  if (!wanted.length) throw fail('Choose the item(s) this payment is for.', 400);
  const target = await checkPayableLines(actor, order, view, wanted, { partId: input.partId, deal });

  const bill = supplierMoney(input, deal);
  const extra = await otherLinks(actor, input);
  const { payee, supplierId, bankNotice } = await supplierPayee(actor, input, req);
  // Supplier credit (services/supplierLedgerService.js): the bill stays the bill (the
  // deal counts it in full); only what is transferred is less. Re-checked under the
  // supplier's lock when it is saved.
  const creditPaise = Number(input.creditToUse) > 0
    ? await credit.checkCreditUse({ supplierId, currency: bill.currency, creditInput: input.creditToUse, billPaise: toPaise(deals.unitsOf(bill)) })
    : 0;
  const money = netOfCredit(bill, creditPaise);
  const { amount } = money;
  const description = cleanDetails(input.description);
  const { files, kinds } = filesFrom(uploaded);
  requireUpiOrQr(payee, kinds);

  // The lock on the agreed total, taken last, just before saving, and given back if
  // anything after it fails: no overpaying, even with two people at once.
  // In hundredths of the deal's currency (the deal and its parts share one).
  const amountPaise = toPaise(deals.unitsOf(bill));
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
  const fields = {
    _id: new mongoose.Types.ObjectId(),
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
    ...extra,
    itemIds: items.map((i) => i._id),
    // A part of a split item names the part, so the slip says what was bought.
    itemNames: items.map((i) => `${variantDisplayName(i.name, i.variantLabel)}${target?.part.what ? ` · part: ${target.part.what}` : ''}`),
    ...(target ? { partId: target.part._id, partWhat: target.part.what || '' } : {}),
    customer: {
      name: order.shippingAddress?.fullName || order.user?.name || '',
      phone: order.shippingAddress?.phone || order.user?.phone || '',
      alternatePhone: order.shippingAddress?.alternatePhone || '',
      city: [order.shippingAddress?.city, order.shippingAddress?.state].filter(Boolean).join(', '),
    },
    closedBy: order.salesUser ? `GTM lead: ${order.salesUser.name || 'GTM'}` : 'Website',
    supplier: supplierId,
    bankNotice,
    ...(deal ? { deal: deal._id, part: deals.partFor(before, amountPaise) } : {}),
    files: stored,
    history: [entry(actor, 'submitted', [
      deal ? `${deals.PART_LABELS[deals.partFor(before, amountPaise)]} of the agreed ${deals.moneyOf(before.agreedPaise, before.currency)}` : '',
      creditPaise ? `bill ${deals.moneyOf(amountPaise, money.currency)} − ${deals.moneyOf(creditPaise, money.currency)} supplier credit` : '',
    ].filter(Boolean).join('; '))],
  };
  // One transaction: the order's guard, the "already in flight?" check again, the
  // credit row and the request — all land, or none. The early check above gives a
  // quick answer; this one is what holds when two are raised at the same moment
  // (the guard write makes the second transaction retry and see the first).
  doc = await paymentRequestRepository.inTransaction(async (session) => {
    await orderRepository.bumpSupplierPayGuard(order._id, session);
    const live = await paymentRequestRepository.findOpenForOrder(order._id, session);
    const clash = live.find((r) => clashes(r, wanted, target));
    if (clash) throw fail(`${clash.number} for this item is already ${STATUS_LABELS[clash.status].toLowerCase()}.`, 409);
    if (!creditPaise) return paymentRequestRepository.create(fields, session);
    const used = await credit.useCredit(session, { supplierId, currency: money.currency, creditPaise, request: fields, actor });
    return paymentRequestRepository.create({ ...fields, credit: { amount: fromPaise(creditPaise), entry: used._id } }, session);
  });
  } catch (err) {
    if (deal) await deals.release(deal._id, amountPaise, 'request failed to save');
    // Nothing was saved: the uploaded bill / QR belong to no request.
    await Promise.all((stored || []).map((f) => deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: resourceTypeOf(f) }).catch(() => {})));
    throw err;
  }
  auditLogger.logAction(req, 'CREATE', 'PaymentRequest', doc._id, { kind: 'supplier', amount, currency: money.currency, foreignAmount: money.foreignAmount, ...(creditPaise ? { creditPaise } : {}), orderId: idOf(order._id), ...(deal ? { dealId: idOf(deal._id), part: doc.part } : {}) });
  // The items now read "Payment Pending" until the admin pays (then "Ordered From
  // Supplier") or the request is cancelled / declined (then back where they were).
  // The request is the record; if marking a line fails, it is logged, and the
  // shipping guard still holds the item until the payment is made.
  const wf = await import('./teamWorkflowService.js'); // lazy: that module imports this one
  for (const itemId of doc.itemIds.map(idOf)) {
    try {
      await wf.markPaymentPending(actor, idOf(order._id), itemId, { supplierName: payee.name, ref: doc.number, partId: doc.partId }, req);
    } catch (err) {
      console.error(`[PaymentRequest] ${doc.number}: could not mark ${itemId} payment pending:`, err.message);
    }
  }
  const warn = bankNotice ? ` ⚠️ This supplier's bank details were changed on ${new Date(bankNotice.at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} by ${bankNotice.byName || 'someone'} — confirm them with the supplier before paying.` : '';
  await tellChat(doc, 'submitted', `🧾 New ${what(doc)} — ${doc.itemNames.join(', ')}. Raised by ${doc.requestedByName}. Accounts: please approve or decline.${warn}`);
  return shape(doc, actor);
}

/**
 * May these items of the order be paid for now? The checks every supplier payment
 * passes when it is raised — and again when a declined one is sent back to
 * accounts (update): the item has not shipped, is not ours, its part is still the
 * active one, no other open payment covers it, and an item paid in parts goes
 * through its deal. Returns the split-item part target (or null). `exceptId`: the
 * request being resubmitted, which is not a clash with itself.
 */
async function checkPayableLines(actor, order, view, wanted, { partId, deal = null, exceptId = null } = {}) {
  const payable = new Set(view.lines.filter((l) => l.stage === STAGE.TO_SHIP || l.stage === STAGE.WITH_SUPPLIER
    // A split item: one part's payment waiting does not stop paying another part.
    || (l.split && l.stage === STAGE.PAYMENT_PENDING)).map((l) => l.itemId));
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
  const target = supplierPartTarget(view, wanted, partId, deal);
  const open = (await paymentRequestRepository.findOpenForOrder(order._id)).filter((r) => idOf(r._id) !== exceptId);
  const busy = open.find((r) => clashes(r, wanted, target));
  if (busy) throw fail(`${busy.number} for this ${target ? 'part' : 'item'} is already ${STATUS_LABELS[busy.status].toLowerCase()}.`, 409);
  if (!deal) {
    // Paid in parts: every payment for the item goes through its deal, so the agreed total holds.
    const [dealt] = (await deals.forOrder(actor, idOf(order._id))).filter((d) => d.itemIds.some((id) => wanted.includes(id)));
    if (dealt) throw fail(`This item is paid in parts (agreed ${deals.moneyOf(Math.round(dealt.agreedTotal * 100), dealt.currency)} with ${dealt.supplierName}) — raise the next part from its supplier deal.`, 409);
  }
  return target;
}

/**
 * The supplier part a payment is for, when its item is bought from several
 * suppliers (utils/supplierParts.js); null for an ordinary item. A split item is
 * paid one part at a time, and only a part with no payment yet.
 */
function supplierPartTarget(view, wanted, partId, deal) {
  const split = view.lines.filter((l) => wanted.includes(l.itemId) && l.split);
  if (!split.length) return null;
  if (deal || wanted.length !== 1) {
    throw fail('An item bought from several suppliers is paid one part at a time — raise the payment from its part.', 400);
  }
  const line = split[0];
  const part = (line.parts || []).find((p) => idOf(p._id) === String(partId || ''));
  if (!part) throw fail('Choose which supplier part this payment is for (refresh the order).', 400);
  if (part.status !== 'active') throw fail('That supplier was changed — pay the new supplier from its part.', 409);
  if (part.orderedAt) throw fail(`This part is already paid (${part.orderedRef || 'paid'}). For more from the same supplier, add another part.`, 409);
  return { line, part };
}

/** Does an open request already cover what this one would pay for? (Per part on a split item.) */
function clashes(r, wanted, target) {
  if (!(r.itemIds || []).some((id) => wanted.includes(idOf(id)))) return false;
  if (!target) return true;
  return idOf(partForRequest(target.line.parts, r)?._id) === idOf(target.part._id);
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
  // …and any supplier credit it used goes back to the supplier's balance (once).
  if (r.credit?.amount && outcome !== 'paid') await credit.restoreCredit(r, `${r.number} ${outcome}`);
  // A supplier bill's payment: a declined / cancelled one gives its share back; paid or not, the bill's paid figure follows.
  if (r.supplierBill) {
    if (outcome !== 'paid') await bills.release(r.supplierBill, toPaise(r.amount), `${r.number} ${outcome}`);
    await bills.resync(r.supplierBill);
  }
  if (r.kind !== 'supplier' || !r.order) return;
  try {
    const wf = await import('./teamWorkflowService.js');
    const ids = (r.itemIds || []).map(idOf);
    const which = { ref: r.number, partId: r.partId ? idOf(r.partId) : undefined };
    if (outcome === 'paid') await wf.markPaidOrdered(actor, idOf(r.order), ids, r.payee?.name, which);
    else await wf.clearPaymentPending(actor, idOf(r.order), ids, `${r.number} ${outcome}`, which);
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
const PAY_CHANGED = 'The amount or who is paid was changed since you opened this request. Check the new details, then pay again.';

const PAYEE_PINNED = Object.freeze(['name', 'method', 'upiId', 'accountNumber', 'ifsc', 'swift']);
/**
 * What the admin agrees to when paying: the money and where it goes. `payVersion`
 * is a fingerprint of it, sent to the payer's screen and back with "Pay", so a
 * request edited after they opened it (a new amount, a new bank account) is
 * refused rather than recorded as paid with figures nobody looked at.
 */
const payFacts = (r) => [r.amount, r.currency || BASE_CURRENCY, r.foreignAmount ?? null, ...PAYEE_PINNED.map((k) => r.payee?.[k] || '')];
export const payVersionOf = (r) => crypto.createHash('sha256').update(JSON.stringify(payFacts(r))).digest('hex').slice(0, 20);
/** The same facts as a compare-and-set filter: the write lands only if none changed since the read. */
function payPinned(r) {
  const f = { amount: r.amount, currency: r.currency ? r.currency : { $in: [BASE_CURRENCY, null] }, foreignAmount: r.foreignAmount ?? null };
  for (const k of PAYEE_PINNED) f[`payee.${k}`] = r.payee?.[k] ? r.payee[k] : { $in: ['', null] };
  return f;
}

/**
 * A supplier payment pays for an order's items; once the order (or every item the
 * payment covers) is cancelled there is nothing to buy. Refuse to approve or pay it —
 * decline it instead. One-off payments too, not only deal parts: an approved one-off
 * payment could otherwise still be paid after the customer's order was cancelled.
 * An item with only some units cancelled is still live (supplierAdvanceGuard.itemsCancelled).
 */

// Why a paid supplier PR is owed back, from ONE read of its order.
async function paidRefundWhy(r) {
  if (!r.order) return null;
  const order = await orderRepository.findForWorkflow(idOf(r.order));
  if (itemsCancelled(order, r.itemIds)) return 'cancelled';
  return requestPartReplaced(order, r) ? 'supplier_changed' : null;
}
async function orderGone(r) {
  if (r.kind !== 'supplier' || !r.order) return false;
  return itemsCancelled(await orderRepository.findForWorkflow(idOf(r.order)), r.itemIds);
}

async function assertOrderLive(r) {
  if (await orderGone(r)) throw fail(`${r.number}: this order (or the item) was cancelled — decline this supplier payment instead.`, 409);
}

/** A subscription expense paid already: what approving it records as the payment, or null. */
function alreadyPaidSet(r, now) {
  const p = r.subscription?.alreadyPaid ? r.subscription.paid : null;
  if (!p) return null;
  return {
    status: 'paid',
    payment: {
      method: p.method, reference: p.reference || '', paidAt: now, transactionAt: p.on,
      paidBy: r.requestedBy, paidByName: r.requestedByName || '',
    },
  };
}

const EDITED_SINCE = 'This payment was edited since you opened it. Check the new details, then approve again.';

/**
 * `rev` (optional): the version accounts was shown. When sent, an edit that
 * landed in between makes this fail with EDITED_SINCE instead of approving
 * figures nobody looked at; the edit and the approval cannot both win.
 */
export async function approve(actor, id, { note, rev } = {}, req) {
  const r0 = await loadVisible(actor, id);   // 404s a request this person may not see
  if (!mayDecide(actor)) throw fail('Only accounts (or an admin) approves payments.', 403);
  if (ownSubscriptionExpense(actor, r0)) throw fail('You marked this one paid yourself — someone else in accounts (or the admin) approves it.', 403);
  const pinned = rev != null && rev !== '';
  if (pinned && Number(rev) !== (r0.rev || 0)) throw fail(EDITED_SINCE, 409);
  await assertOrderLive(r0);
  const now = new Date();
  // Paid already (company card, auto-debit): approving it closes it as paid — the
  // admin is not asked to pay money that has already left.
  const settled = alreadyPaidSet(r0, now);
  const r = await paymentRequestRepository.transitionInSession(id, ['submitted'], pinned ? revIs(rev) : {},
    { status: 'approved', approvedBy: actor._id, approvedAt: now, decisionNote: String(note || '').slice(0, 1000), ...settled },
    entry(actor, settled ? 'approved — already paid' : 'approved', note), {}, undefined);
  if (!r) {
    const cur = pinned ? await paymentRequestRepository.findById(id) : null;
    throw fail(cur && cur.status === 'submitted' && (cur.rev || 0) !== Number(rev) ? EDITED_SINCE : MOVED, 409);
  }
  auditLogger.logAction(req, 'UPDATE', 'PaymentRequest', id, { change: settled ? 'approved (already paid)' : 'approved' });
  await followOnSubscription(r);
  await tellChat(r, 'approved', settled
    ? `✅ ${isAdmin(actor) ? 'Admin' : 'Accounts'} approved ${what(r)} — already paid, closed as paid.`
    : `✅ ${isAdmin(actor) ? 'Admin' : 'Accounts'} approved ${what(r)}. Admin: please pay and record the payment.`, settled ? { mentionRequester: true } : { mentionAdmins: true });
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
  await followOnSubscription(r);
  await tellChat(r, 'declined', `⛔ ${isAdmin(actor) ? 'Admin' : 'Accounts'} declined ${what(r)}: “${reason.slice(0, 200)}”.`, { mentionRequester: true });
  return shape(r, actor);
}

/** Why a held request cannot be paid — named, so the admin knows who to ask. */
const heldMessage = (r) => {
  const h = holdOf(r);
  return `${r.number} is on hold${h?.note ? ` (“${h.note.slice(0, 200)}”)` : ''}${h?.byName ? ` — held by ${h.byName}` : ''}. Release the hold before paying it.`;
};

/** What a payment may be recorded from: approved — or still waiting, which the admin's payment also approves. Never on hold. */
const PAYABLE = Object.freeze(['submitted', 'approved']);

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
 * Lift a hold: the request is approved again and can be paid. Accounts or the
 * admin — whoever may hold may release. A note is optional ("funds arrived").
 * Compare-and-set like every change: two releases at once release it once.
 */
export async function release(actor, id, { note } = {}, req) {
  if (!mayHold(actor)) throw fail('Only accounts or an admin can release a hold.', 403);
  const said = String(note || '').trim().slice(0, 1000);
  await loadVisible(actor, id);
  const r = await paymentRequestRepository.transition(id, ['on_hold'],
    { status: 'approved', decisionNote: '' }, entry(actor, 'released', said));
  if (!r) throw fail(MOVED, 409);
  auditLogger.logAction(req, 'UPDATE', 'PaymentRequest', id, { change: 'released' });
  await tellChat(r, 'released', `▶️ ${isAdmin(actor) ? 'Admin' : 'Accounts'} released the hold on ${what(r)} — it can be paid now${said ? `: “${said.slice(0, 200)}”` : '.'}`, { mentionAdmins: true, mentionRequester: true });
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
export async function markPaid(actor, id, { method, reference, note, transactionAt, rupees, paidFrom, sentAmount, sentCurrency, accountLabel, payVersion, slipRead } = {}, proofFiles = [], req) {
  if (!mayPay(actor)) throw fail('Only the admin pays payment requests — accounts approves them.', 403);
  const how = paidMethodOf(method);
  if (!how) throw fail('Choose how it was paid.', 400);
  // Optional: not every payment has one to hand (cash, some UPI apps).
  const ref = String(reference || '').trim();
  const now = new Date();
  const txAt = cleanTransactionAt(transactionAt, now.getTime());
  const r0 = await loadVisible(actor, id);
  // The screen the admin paid from showed other figures: refuse, never record them.
  // (Optional only so a browser tab opened before this shipped can still pay; the
  // compare-and-set below pins the same facts either way.)
  if (filled(payVersion) && String(payVersion) !== payVersionOf(r0)) throw fail(PAY_CHANGED, 409);
  if (r0.status === 'on_hold') throw fail(heldMessage(await paymentRequestRepository.findById(id) || r0), 409);
  if (r0.subscription?.alreadyPaid) throw fail(`${r0.number} was paid already (${r0.requestedByName} marked it paid) — accounts approves it, which closes it as paid.`, 409);
  await assertOrderLive(r0);
  const isForeign = Boolean(foreignLine(r0));
  const fromForeign = paidFrom === 'foreign';
  if (filled(paidFrom) && !['inr', 'foreign'].includes(paidFrom)) throw fail('Choose which account it was paid from.', 400);
  let priced = null;
  let fromAccount = null;
  if (fromForeign) {
    if (filled(rupees)) throw fail('Paid from a foreign account means no rupees were debited — leave the rupees empty, or choose the Indian rupee account.', 400);
    fromAccount = cleanFromAccount(r0, { sentAmount, sentCurrency, accountLabel });
  } else if (isForeign && filled(rupees)) {
    priced = cleanDebit(r0, rupees);
    if (priced.amount === r0.amount) priced = null;
  } else if (rupeesPending(r0)) {
    throw fail(`Enter the rupees the bank debited for this ${foreignLine(r0)} bill.`, 400);
  } else if (filled(rupees) && round2(rupees) !== r0.amount) {
    throw fail(`This request is for ${inr(r0.amount)} — that is what accounts approved. Edit the request to change it.`, 400);
  }
  // The admin paying a request still waiting for approval approves it in the same step.
  // Not on hold: the compare-and-set below refuses a hold that lands after the check above.
  const from = PAYABLE;
  const uploads = (Array.isArray(proofFiles) ? proofFiles : [proofFiles]).filter(Boolean);
  const proof = uploads.length ? await storeFiles(uploads, uploads.map(() => 'proof'), actor, { existing: (r0.files || []).length }) : [];
  const debit = priced ? `${inr(priced.amount)} debited for ${foreignLine({ ...r0, fxRate: null })} (₹${rateText(priced.fxRate)} per ${r0.currency})`
    : fromAccount ? `${fromAccountText(fromAccount)}${r0.amount > 0 ? ` — the earlier estimate of ${inr(r0.amount)} is dropped` : ''}` : '';
  // No rupees left the company: an older request's rupee estimate is not what it
  // cost, so it comes out of the rupee totals (the history keeps it).
  const unpriced = fromAccount ? { amount: 0, fxRate: null } : null;
  // Pinned to the money and payee read above: an edit landing between that read and
  // this write makes it a lost race (409), never a payment recorded with other figures.
  const r = await paymentRequestRepository.transitionInSession(id, from, payPinned(r0), {
      ...(r0.status === 'submitted' ? { approvedBy: actor._id, approvedAt: now } : {}),
      ...(priced || unpriced || {}),
      status: 'paid',
      payment: {
        method: how, reference: ref.slice(0, 120), paidAt: now, transactionAt: txAt, paidBy: actor._id, paidByName: actor.name || '',
        ...(fromAccount ? { fromAccount } : {}),
        slipRead: slipProvenance(actor, slipRead, { files: uploads, reference: ref, transactionAt: txAt }),
      },
    }, entry(actor, 'paid', [`${how.toUpperCase()} ${ref}`.trim(), debit, note].filter(Boolean).join(' — ')),
    proof.length ? { files: { $each: proof } } : {}, undefined);
  if (!r) {
    // Lost the race: the screenshot belongs to no payment.
    await Promise.all(proof.map((f) => deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: resourceTypeOf(f) }).catch(() => {})));
    const now = await paymentRequestRepository.findById(id);
    if (now?.status === 'on_hold') throw fail(heldMessage(now), 409);
    throw fail(now && from.includes(now.status) && payVersionOf(now) !== payVersionOf(r0) ? PAY_CHANGED : MOVED, 409);
  }
  auditLogger.logAction(req, 'UPDATE', 'PaymentRequest', id, {
    change: 'paid', method: how, reference: ref,
    ...(priced ? { amount: priced.amount, fxRate: priced.fxRate } : {}),
    ...(fromAccount ? { fromAccount } : {}),
  });
  await followOnOrder(r, actor, 'paid');
  await followOnSubscription(r);
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
  await followOnSubscription(r);
  await tellChat(r, 'cancelled', `↩️ ${r.requestedByName} cancelled ${what(r)}.`);
  return shape(r, actor);
}

/**
 * Procurement changed the supplier of the part this request pays for, before it
 * was approved: the request is cancelled exactly as "Cancel" would (credit and
 * line restored, chat told), by whoever on procurement makes the change — the
 * change itself is the procurement decision. Only from "submitted": an approved
 * request is accounts' call and must be declined by them.
 */
export async function cancelForSupplierChange(actor, id, note, req) {
  const r0 = await loadVisible(actor, id);
  if (r0.kind !== 'supplier') throw fail('Request not found.', 404);
  if (!isAdmin(actor) && !onTeam(actor, STAFF_TEAMS.PROCUREMENT)) throw fail('Only procurement changes a supplier.', 403);
  const r = await paymentRequestRepository.transition(id, ['submitted'], { status: 'cancelled' }, entry(actor, 'cancelled', note));
  if (!r) return null;
  auditLogger.logAction(req, 'UPDATE', 'PaymentRequest', id, { change: 'cancelled', why: 'supplier_changed' });
  await followOnOrder(r, actor, 'cancelled');
  await tellChat(r, 'cancelled', `↩️ ${actor.name || 'Procurement'} changed the supplier — ${what(r)} cancelled.`);
  return r;
}

/** Rich-text details as one short line for the edit history. */
const plainLine = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
/** How the payee is paid, for the edit history (the account number masked). */
const payText = (p = {}) => {
  if (p.method === 'upi') return `UPI ${p.upiId || '(their QR)'}`;
  if (p.method === 'bank') return `Bank ${maskAccount(p.accountNumber || '') || '—'} ${p.ifsc || p.swift || ''}`.trim();
  if (p.method === 'card') return `Card ${p.cardLast4 ? `••${p.cardLast4}` : ''}`.trim();
  return 'not given';
};
const FILE_NOUN = Object.freeze({ bill: 'Bill', qr: 'QR code', proof: 'Payment screenshot' });

/**
 * Correct a request before it is approved (who and when: mayEdit): the amount,
 * what it is for, the details, who is paid (a saved supplier or typed details)
 * and the attached bills / QR (`uploaded` new ones, `removeFileIds` old ones).
 * The linked order / project / other ID are changed with linkOrder / setLinks.
 *
 * A reason is required. Each edit is kept in `edits` (old → new) and the history;
 * an on-hold or declined request goes back to accounts as submitted. The write is
 * a compare-and-set on status + rev, so an edit and an approval at the same
 * moment cannot both land (approve pins rev too). The order's and the project's
 * money are read from the requests themselves, so they follow at once; a deal
 * part moves its lock on the agreed total by the difference.
 */
export async function update(actor, id, input = {}, uploaded = {}, req) {
  const r0 = await loadVisible(actor, id);
  if (!mayEdit(actor, r0)) {
    if (!EDITABLE.includes(r0.status)) {
      throw fail(r0.status === 'approved'
        ? 'Accounts has approved this payment, so it can no longer be edited. Ask accounts to put it on hold if something is wrong.'
        : 'A paid or cancelled payment cannot be edited.', 403);
    }
    if (fromSubscription(r0)) throw fail('A subscription payment is not edited here — ask accounts to decline it, then mark it paid again with the right details.', 409);
    if (!resubmittable(r0)) throw fail('A declined deal part, supplier bill payment or payment that used supplier credit cannot be sent again — raise a new payment instead.', 409);
    throw fail('Only whoever raised it, or the admin, can edit it.', 403);
  }
  // A double-submitted edit (same form key): the answer the first one got.
  const formKey = input.formKey ? String(input.formKey).slice(0, 64) : '';
  if (formKey && (r0.edits || []).some((e) => e.formKey === formKey)) return shape(r0, actor);
  // The version the editor's form was opened on: someone else's edit in between is refused.
  if (input.rev != null && input.rev !== '' && Number(input.rev) !== (r0.rev || 0)) throw fail(MOVED, 409);
  const reason = String(input.reason || '').trim();
  if (reason.length < 3) throw fail('Say why you are changing it — accounts sees this.', 400);

  const isExpense = r0.kind === 'expense';
  const before = { currency: r0.currency || BASE_CURRENCY, foreignAmount: r0.foreignAmount ?? null, fxRate: r0.fxRate ?? null };
  // Either kind may be a foreign bill (worked out in cleanMoney). A deal part stays
  // in its deal's currency.
  // With supplier credit, the amount typed is the BILL; the credit used stays as it was.
  const creditPaise = toPaise(r0.credit?.amount || 0);
  const billBefore = !creditPaise ? before
    : before.currency === BASE_CURRENCY ? before : { ...before, foreignAmount: fromPaise(toPaise(r0.foreignAmount) + creditPaise) };
  const billAmount = creditPaise && before.currency === BASE_CURRENCY ? fromPaise(toPaise(r0.amount) + creditPaise) : r0.amount;
  // A reimbursement (now, or after this edit) is priced by claimMoney: a Fuel claim's
  // amount is ALWAYS km × its rate, recomputed here, never a typed figure.
  const nextCategory = isExpense && input.category != null ? String(input.category) : r0.category;
  const claim = isExpense && nextCategory === REIMBURSEMENT ? await claimMoney(input, r0) : null;
  const billMoney = claim ? claim.money : isExpense
    ? cleanMoney(r0.team, input, { amount: r0.amount, ...before })
    : supplierMoney(input, r0.deal || r0.supplierBill || creditPaise ? { currency: before.currency } : null, { amount: billAmount, ...billBefore });
  const money = creditPaise ? { ...netOfCredit(billMoney, creditPaise), credit: r0.credit } : billMoney;
  // An unchanged foreign bill keeps its stored rupees/rate (cleanMoney), not a recomputed net.
  if (creditPaise && money.currency !== BASE_CURRENCY && billMoney.foreignAmount === billBefore.foreignAmount) {
    Object.assign(money, { foreignAmount: before.foreignAmount, amount: r0.amount, fxRate: before.fxRate });
  }
  const { amount } = money;
  const description = input.description != null ? cleanDetails(input.description) : r0.description || '';
  let { category } = r0;
  // The team's list is checked only when the category CHANGES: an old record
  // (procurement "fuel", from the shared list) can still be corrected as it is.
  if (isExpense && input.category != null && String(input.category) !== r0.category) {
    category = checkCategory(r0.team, input.category);
  }
  if (claim) {
    claims.checkClaimNote(claim.reimbursement, description);
  } else if (isExpense && (category !== r0.category || description !== (r0.description || ''))) {
    checkNote(r0.team, category, description);
  }
  const claimWas = r0.category === REIMBURSEMENT && r0.reimbursement?.type ? r0.reimbursement : null;
  const claimNow = claim?.reimbursement || null;
  const claimChanged = JSON.stringify(claimWas && claimDiffKey(claimWas)) !== JSON.stringify(claimNow && claimDiffKey(claimNow));
  const fxChanged = money.currency !== before.currency || money.foreignAmount !== before.foreignAmount || money.fxRate !== before.fxRate;

  let payee = r0.payee;
  let supplier = r0.supplier ?? null;
  let bankNotice = r0.bankNotice ?? null;
  if (r0.kind === 'supplier' && input.supplierId) {
    const picked = await suppliers.payeeFor(input.supplierId);
    ({ payee, bankNotice } = picked);
    supplier = picked.supplier._id;
  } else if (input.payee) {
    payee = cleanPayee(input.payee, { optional: isExpense });
    if (payKeyOf(payee, 'x') !== payKeyOf(r0.payee, 'x')) { supplier = null; bankNotice = null; }
  }
  // A payment not for one order is found under its supplier only through the saved link.
  if (r0.kind === 'supplier' && !r0.order && !supplier) {
    throw fail('Pick the supplier from the list — a payment not for one order must be linked to a saved supplier.', 400);
  }
  if (r0.supplierBill && idOf(supplier) !== idOf(r0.supplier)) {
    throw fail(`${r0.number} pays a supplier bill, so the supplier cannot change. Cancel it and raise the payment from the right bill instead.`, 409);
  }
  if (creditPaise && idOf(supplier) !== idOf(r0.supplier)) {
    throw fail(`${r0.number} uses ${deals.moneyOf(creditPaise, before.currency)} of ${r0.payee?.name || 'this supplier'}'s credit, so the supplier cannot change. Cancel it and raise a new payment instead.`, 409);
  }

  // Attachments: remove bills / QR (never payment screenshots), add new ones.
  let removeIds = input.removeFileIds;
  if (typeof removeIds === 'string') { try { removeIds = JSON.parse(removeIds); } catch { removeIds = [removeIds]; } }
  removeIds = new Set((Array.isArray(removeIds) ? removeIds : []).map(String));
  const removing = (r0.files || []).filter((f) => f.kind !== 'proof' && removeIds.has(idOf(f._id)));
  const { files: newFiles, kinds: newKinds } = filesFrom(uploaded);
  const kept = (r0.files || []).filter((f) => !removing.includes(f));
  if (newKinds.includes('qr') && kept.some((f) => f.kind === 'qr')) throw fail('Remove the old QR code before attaching a new one.', 400);
  requireUpiOrQr(payee, [...kept.map((f) => f.kind), ...newKinds], { optional: isExpense });
  // The bill rule is checked on what the request will carry after this edit.
  if (claim) claims.checkClaimBill(claim.reimbursement, amount, [...kept.map((f) => f.kind), ...newKinds]);

  const changes = [];
  const change = (field, from, to) => changes.push({ field, from: String(from ?? '').slice(0, 300), to: String(to ?? '').slice(0, 300) });
  // A foreign bill without rupees yet has no rupee amount to compare: its bill line says it.
  if (amount !== r0.amount && !rupeesPending(money) && !rupeesPending(r0)) change('Amount', inr(r0.amount), inr(amount));
  if (fxChanged) change('Bill', foreignLine(before) || 'in rupees', foreignLine(money) || 'in rupees');
  if (payee.name !== r0.payee.name) change('Pay to', r0.payee.name || '(none)', payee.name || '(none)');
  if (payKeyOf(payee, 'x') !== payKeyOf(r0.payee, 'x')) change('Payment details', payText(r0.payee), payText(payee));
  if (category !== r0.category) change('What for', categoryLabel(r0.category), categoryLabel(category));
  if (description !== (r0.description || '')) change('Details', plainLine(r0.description), plainLine(description));
  if (claimChanged && claimNow) change('Reimbursement', claimWas ? `${claims.claimLabel(claimWas)} (${claimWas.on})` : '', `${claims.claimLabel(claimNow)} (${claimNow.on})`);
  for (const f of removing) change('Attachment removed', `${FILE_NOUN[f.kind]}${f.name ? ` (${f.name})` : ''}`, '');
  newFiles.forEach((f, i) => { if (f?.buffer?.length) change('Attachment added', '', `${FILE_NOUN[newKinds[i]]}${f.originalname ? ` (${String(f.originalname).slice(0, 120)})` : ''}`); });
  const backToAccounts = r0.status !== 'submitted';
  // Nothing changed on a waiting request: nothing to save. A held / declined one may
  // be sent back with only the reason (e.g. the answer to accounts' query).
  if (!changes.length && !backToAccounts) return shape(r0, actor);

  // A declined supplier payment gave its items back (followOnOrder): before it goes
  // back to accounts, they must still be payable — the same checks as raising it.
  const resubmitSupplier = r0.status === 'declined' && r0.kind === 'supplier' && r0.order;
  let order = null;
  let target = null;
  if (resubmitSupplier) {
    order = await orderRepository.findForWorkflow(idOf(r0.order));
    const view = order && workflowView(order);
    if (!view) throw fail('Its order is no longer in the team workflow — raise a new payment instead.', 409);
    target = await checkPayableLines(actor, order, view, (r0.itemIds || []).map(idOf), { partId: r0.partId ? idOf(r0.partId) : undefined, exceptId: idOf(r0._id) });
  }

  const note = [reason, changes.length ? changes.map((c) => `${c.field}${c.from || c.to ? `: ${c.from || '—'} → ${c.to || '—'}` : ''}`).join('; ') : '']
    .filter(Boolean).join(' — ') + (backToAccounts ? ' — sent back to accounts' : '');
  // A deal part's new amount must still fit the agreed total: move the lock by the difference first.
  // In hundredths of the deal's currency. (A declined deal part is never edited: resubmittable.)
  const wasUnits = toPaise(deals.unitsOf(r0));
  const nowUnits = toPaise(deals.unitsOf(money));
  const delta = r0.deal ? nowUnits - wasUnits : 0;
  let part = r0.part || '';
  if (delta > 0) {
    const was = await deals.reserve(r0.deal, delta);
    part = deals.partFor({ ...was, reservedPaise: was.reservedPaise - wasUnits }, nowUnits);
  } else if (delta < 0) {
    // Named against the other parts: what is asked for besides this one.
    const now = await deals.dealForPayment(r0.deal, r0.order);
    part = deals.partFor({ ...now, reservedPaise: now.reservedPaise - wasUnits }, nowUnits);
  }
  // A supplier bill's payment: the same, on what is left of the bill (rupees).
  const billDelta = r0.supplierBill ? toPaise(money.amount) - toPaise(r0.amount) : 0;
  if (billDelta > 0) {
    try {
      await bills.reserve(r0.supplierBill, billDelta);
    } catch (err) {
      if (delta > 0) await deals.release(r0.deal, delta, `${r0.number} edit not saved`);
      throw err;
    }
  }
  const undoLock = async () => {
    if (delta > 0) await deals.release(r0.deal, delta, `${r0.number} edit not saved`);
    if (billDelta > 0) await bills.release(r0.supplierBill, billDelta, `${r0.number} edit not saved`);
  };

  let stored = [];
  try {
    stored = newFiles.length ? await storeFiles(newFiles, newKinds, actor, { existing: kept.length }) : [];
  } catch (err) {
    await undoLock();
    throw err;
  }
  const at = new Date();
  const editRow = {
    at, by: actor._id, byName: actor.name || '', role: roleOf(actor), reason: reason.slice(0, 1000),
    fromStatus: r0.status, changes, ...(formKey ? { formKey } : {}),
  };
  const set = {
    amount, currency: money.currency, foreignAmount: money.foreignAmount, fxRate: money.fxRate,
    description, category, payee, supplier, bankNotice,
    files: [...kept, ...stored],
    rev: (r0.rev || 0) + 1,
    editedAt: at,
    ...(claimChanged ? { reimbursement: claimNow } : {}),
    ...(r0.deal ? { part } : {}),
    ...(backToAccounts ? { status: 'submitted', approvedBy: null, approvedAt: null, decisionNote: '' } : {}),
  };
  let r;
  try {
    const write = (session) => paymentRequestRepository.transitionInSession(id, [r0.status], revIs(r0.rev),
      set, entry(actor, backToAccounts ? 'resubmitted' : 'edited', note), { edits: editRow }, session);
    r = resubmitSupplier
      // The same guard as raising one: two payments for the item at the same moment cannot both be live.
      ? await paymentRequestRepository.inTransaction(async (session) => {
        await orderRepository.bumpSupplierPayGuard(order._id, session);
        const live = await paymentRequestRepository.findOpenForOrder(order._id, session);
        const clash = live.find((x) => idOf(x._id) !== idOf(r0._id) && clashes(x, (r0.itemIds || []).map(idOf), target));
        if (clash) throw fail(`${clash.number} for this item is already ${STATUS_LABELS[clash.status].toLowerCase()}.`, 409);
        return write(session);
      })
      : await write(undefined);
  } catch (err) {
    r = null;
    await undoLock();
    await Promise.all(stored.map((f) => deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: resourceTypeOf(f) }).catch(() => {})));
    throw err;
  }
  if (!r) {
    // Lost the race (approved, held or edited by someone else first): put everything back.
    await undoLock();
    await Promise.all(stored.map((f) => deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: resourceTypeOf(f) }).catch(() => {})));
    const now = await paymentRequestRepository.findById(id);
    throw fail(now?.status === 'approved' ? 'Accounts approved this payment just now, so your changes were not saved.' : MOVED, 409);
  }
  // A smaller amount gives its share back only once the edit has landed.
  if (delta < 0) await deals.release(r0.deal, -delta, `${r0.number} edited`);
  if (billDelta < 0) await bills.release(r0.supplierBill, -billDelta, `${r0.number} edited`);
  // Only now, with no request pointing at them any more, delete the removed files.
  await Promise.all(removing.map((f) => deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: resourceTypeOf(f) }).catch(() => {})));
  if (resubmitSupplier) {
    // Its items read "Payment Pending" again, as when it was first raised. Logged on failure; the shipping guard still holds.
    const wf = await import('./teamWorkflowService.js');
    for (const itemId of (r.itemIds || []).map(idOf)) {
      try {
        await wf.markPaymentPending(actor, idOf(r.order), itemId, { supplierName: r.payee?.name, ref: r.number, partId: r.partId }, req);
      } catch (err) {
        console.error(`[PaymentRequest] ${r.number}: could not mark ${itemId} payment pending on resubmit:`, err.message);
      }
    }
  }
  auditLogger.logAction(req, 'UPDATE', 'PaymentRequest', id, { change: backToAccounts ? 'resubmitted' : 'edited', fields: changes.map((c) => c.field), fromStatus: r0.status });
  const said = changes.length ? changes.map((c) => c.field.toLowerCase()).join(', ') : 'no changes';
  await tellChat(r, backToAccounts ? 'resubmitted' : 'edited', backToAccounts
    ? `🔁 ${actor.name || 'Someone'} edited ${what(r)} (${said}) and sent it back — it was ${STATUS_LABELS[r0.status].toLowerCase()}. Reason: “${reason.slice(0, 200)}”. Accounts: please approve or decline.`
    : `✏️ ${actor.name || 'Someone'} edited ${what(r)} (${said}). Reason: “${reason.slice(0, 200)}”.`,
  { mentionRequester: idOf(r.requestedBy) !== idOf(actor._id) });
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
export async function editPayment(actor, id, { method, reference, note, removeFileIds, transactionAt, rupees, accountLabel, slipRead } = {}, proofFiles = [], req) {
  if (!mayPay(actor)) throw fail('Only the admin can edit a payment record.', 403);
  const r0 = await loadVisible(actor, id);
  if (r0.status !== 'paid') throw fail('Only a paid payment\'s details can be edited here.', 409);

  const how = method ? paidMethodOf(method) : r0.payment?.method;
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
  const abroad = paidFromForeign(r0);
  if (filled(rupees)) {
    if (abroad) throw fail(`This was paid from ${abroad.label || `a ${abroad.currency} account`} — no rupees were debited, so there are none to change.`, 400);
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
  // A new slip read on this edit replaces the record of which fields came from a slip;
  // otherwise a field saved as read from the slip and changed now is a person's value.
  const slipSet = {};
  const reread = slipProvenance(actor, slipRead, { files: uploads, reference: ref, transactionAt: txAt });
  if (reread) slipSet['payment.slipRead'] = reread;
  else {
    if (ref !== (r0.payment?.reference || '')) markEdited(r0.payment?.slipRead, slipSet, 'reference', 'payment.slipRead');
    if (txAt && wasAt && new Date(txAt).getTime() !== new Date(wasAt).getTime()) markEdited(r0.payment?.slipRead, slipSet, 'date', 'payment.slipRead');
  }
  const label = abroad && accountLabel != null ? String(accountLabel).replace(/\s+/g, ' ').trim().slice(0, 80) : null;
  if (label != null && label !== (abroad.label || '')) changes.push(`paid from ${abroad.label || '—'} → ${label || '—'}`);
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
        const next = await paymentRequestRepository.editPaidInSession(tid, { 'payment.method': how, 'payment.reference': ref, ...(txAt ? { 'payment.transactionAt': txAt } : {}), ...slipSet, ...(label != null ? { 'payment.fromAccount.label': label } : {}), ...(priced || {}) }, log, stored, session);
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
const SEARCH_FIELDS = Object.freeze([
  'number', 'payee.name', 'payee.upiId', 'payee.cardLast4', 'payee.cardLabel', 'payee.cardName', 'orderNumber', 'requestedByName', 'description', 'category',
  'payment.reference', 'itemNames', 'customer.name', 'customer.phone', 'customer.city',
  'projectCode', 'projectName', 'reference',
]);
const SUMMARY_CAP = 1000;
const REIMBURSEMENT_SUB = new Set(REIMBURSEMENT_TYPES.map((t) => `${REIMBURSEMENT}:${t.value}`));

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
    // "Reimbursement – Fuel": the sub-type the filter offers (filterCategories).
    REIMBURSEMENT_SUB.has(f.category) ? { category: REIMBURSEMENT, 'reimbursement.type': f.category.slice(REIMBURSEMENT.length + 1) } : null,
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
  return { ...page, requests: await withDeals(await withHoldHistory(items), (r) => shape(r, actor)) };
}

/**
 * What the expense form offers this person: their team's options and currencies.
 * An admin asks for a team (`team`), as when raising on its behalf.
 */
export async function expenseOptions(actor, { team } = {}) {
  const which = isAdmin(actor) ? String(team || '') : (isActiveStaff(actor) ? actor.staff.team : '');
  if (!isAdmin(actor) && !isActiveStaff(actor)) throw fail('Not authorized.', 403);
  if (!EXPENSE_TEAMS.includes(which)) throw fail('Choose the team the expense is for.', 400);
  const [reimbursement, last] = await Promise.all([
    claims.claimOptions(),
    paymentRequestRepository.lastOwnPayee(actor._id, REIMBURSEMENT),
  ]);
  return {
    ...expenseOptionsFor(which),
    reimbursement: {
      ...reimbursement,
      // Pre-fills "paid to" with the UPI / bank of this person's last reimbursement (they can change it).
      lastPayee: last?.payee?.method ? cleanPayee(last.payee, { optional: true }) : null,
    },
  };
}

/** The per-km fuel rate and who last changed it — for anyone who may raise a reimbursement. */
export async function reimbursementSettings(actor) {
  if (!isAdmin(actor) && !isActiveStaff(actor)) throw fail('Not authorized.', 403);
  return claims.readSettings();
}

/** People / tasks on one month's report: far above our staff, and a bound on the read. */
export const REPORT_ROWS_MAX = 200;
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/**
 * One month's reimbursements, by the day they were spent (IST): what each person
 * claimed and was paid (by kind, and fuel km), and what each linked task cost.
 * Declined and cancelled claims are left out. Admin and accounts only.
 */
export async function reimbursementReport(actor, { month } = {}) {
  if (!seesAll(actor)) throw fail('Only accounts and the admin see the reimbursement report.', 403);
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m || +m[2] < 1 || +m[2] > 12) throw fail('Pick a month (YYYY-MM).', 400);
  const from = `${m[1]}-${m[2]}-01`;
  const next = new Date(Date.UTC(+m[1], +m[2], 1)).toISOString().slice(0, 7);
  const [out] = await paymentRequestRepository.reimbursementReport(from, `${next}-01`, REPORT_ROWS_MAX);
  const t = out?.total?.[0] || {};
  return {
    month: `${m[1]}-${m[2]}`,
    total: { count: t.count || 0, amount: r2(t.amount), paid: r2(t.paid), waiting: r2((t.amount || 0) - (t.paid || 0)), km: r2(t.km) },
    people: (out?.people || []).map((p) => ({
      id: idOf(p._id), name: p.name || '', team: p.team || '', teamLabel: STAFF_TEAM_LABELS[p.team] || p.team || '',
      count: p.count, amount: r2(p.amount), paid: r2(p.paid), waiting: r2(p.amount - p.paid), km: r2(p.km),
      byType: { fuel: r2(p.fuel), food: r2(p.food), transport: r2(p.transport), other: r2(p.other) },
    })),
    tasks: (out?.tasks || []).map((x) => ({
      id: idOf(x._id), code: taskCode(x.number), title: x.title || '',
      count: x.count, amount: r2(x.amount), paid: r2(x.paid), waiting: r2(x.amount - x.paid), km: r2(x.km),
    })),
    capped: (out?.people || []).length >= REPORT_ROWS_MAX || (out?.tasks || []).length >= REPORT_ROWS_MAX,
  };
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
  // Paid, and the customer cancelled the items since — or procurement changed the
  // supplier of the part it paid for: the supplier owes us a refund.
  const why = r.kind === 'supplier' && r.status === 'paid' ? await paidRefundWhy(r) : null;
  if (why) {
    const claim = (await credit.claimsFor([r._id], actor)).get(idOf(r._id)) || null;
    out.supplierRefund = { claim, canClaim: !claim && credit.mayPropose(actor), savedSupplier: Boolean(r.supplier), why };
  }
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

/**
 * Which project and other ID a request belongs to — set, change or clear each
 * one present in `input` (`project`: "PRJ-0007" or '' to remove; `reference`:
 * text or ''). Any kind, any status: no money changes. A deleted project can't
 * be newly linked, but an existing link to one stays until changed.
 * Compare-and-set on the version read; logged in the history and the audit log.
 */
export async function setLinks(actor, id, input = {}, req) {
  const r0 = await loadVisible(actor, id);
  if (!mayLinkOrder(actor, r0)) throw fail('Only whoever raised it, their team head or accounts can change what it is linked to.', 403);
  const set = {};
  const notes = [];
  if ('project' in input) {
    const p = await projectForLink(actor, input.project, { seesAll: seesAll(actor) });
    if (String(r0.project || '') !== String(p?._id || '')) {
      const was = r0.projectCode || '';
      const now = p ? projectCode(p.number) : '';
      Object.assign(set, p ? { project: p._id, projectCode: now, projectName: p.name || '' } : { project: null, projectCode: '', projectName: '' });
      notes.push(!now ? `project ${was} removed` : was ? `project ${was} → ${now}` : `linked to project ${now}`);
    }
  }
  if ('task' in input) {
    const t = await taskForLink(actor, input.task, { seesAll: seesAll(actor) });
    if (String(r0.task || '') !== String(t?._id || '')) {
      const was = taskCode(r0.taskNumber);
      const now = t ? taskCode(t.number) : '';
      Object.assign(set, taskFields(t));
      notes.push(!now ? `task ${was} removed` : was ? `task ${was} → ${now}` : `linked to task ${now}`);
    }
  }
  if ('reference' in input) {
    const ref = cleanReference(input.reference);
    if (ref !== (r0.reference || '')) {
      set.reference = ref;
      notes.push(!ref ? `other ID ${r0.reference} removed` : r0.reference ? `other ID ${r0.reference} → ${ref}` : `other ID ${ref}`);
    }
  }
  if (!notes.length) return shape(r0, actor);
  const r = await paymentRequestRepository.transitionInSession(id, [r0.status], { updatedAt: r0.updatedAt }, set,
    entry(actor, 'edited', notes.join('; ')), {}, undefined);
  if (!r) throw fail(MOVED, 409);
  auditLogger.logAction(req, 'UPDATE', 'PaymentRequest', id, { change: 'links', fields: Object.keys(set) });
  return shape(r, actor);
}

/** Supplier requests for an order, for the procurement order panel. */
export async function forOrder(actor, orderId) {
  if (!seesAll(actor) && !isActiveStaff(actor)) throw fail('Not authorized.', 403);
  if (!/^[a-f0-9]{24}$/i.test(String(orderId))) return [];
  const rows = await withHoldHistory(await paymentRequestRepository.findForOrder(orderId));
  // A paid supplier payment for items the customer cancelled: the supplier owes us a
  // refund — procurement raises it from here (services/supplierLedgerService.js).
  const paidSupplier = rows.filter((r) => r.kind === 'supplier' && r.status === 'paid');
  const [order, claims] = paidSupplier.length
    ? await Promise.all([orderRepository.findForWorkflow(orderId), credit.claimsFor(paidSupplier.map((r) => r._id), actor)])
    : [null, new Map()];
  const refundOf = (r) => {
    if (r.kind !== 'supplier' || r.status !== 'paid') return null;
    const why = itemsCancelled(order, r.itemIds) ? 'cancelled' : requestPartReplaced(order, r) ? 'supplier_changed' : null;
    if (!why) return null;
    const claim = claims.get(idOf(r._id)) || null;
    return { claim, canClaim: !claim && credit.mayPropose(actor), savedSupplier: Boolean(r.supplier), why };
  };
  return rows.map((r) => ({
    id: idOf(r._id), number: r.number, status: r.status, statusLabel: STATUS_LABELS[r.status],
    // Why it was declined, or held (and by whom) — the same as every other view shows.
    decisionNote: ['declined', 'on_hold'].includes(r.status) ? r.decisionNote || '' : '',
    hold: holdOf(r),
    kind: r.kind, categoryLabel: r.kind === 'expense' ? categoryLabel(r.category) : 'Supplier', team: r.team,
    dealId: r.deal ? idOf(r.deal) : null, part: r.part || '', partLabel: deals.PART_LABELS[r.part] || '',
    amount: r.amount, currency: r.currency || BASE_CURRENCY, foreignAmount: r.foreignAmount ?? null, rupeesPending: rupeesPending(r),
    paidFrom: paidFromForeign(r) ? { currency: r.payment.fromAccount.currency, amount: r.payment.fromAccount.amount, label: r.payment.fromAccount.label || '' } : null,
    itemIds: (r.itemIds || []).map(idOf), itemNames: r.itemNames || [],
    // The supplier part it pays for on a split item (null: the item's first part).
    partId: r.partId ? idOf(r.partId) : null, partWhat: r.partWhat || '',
    payee: r.payee?.name || '', paidAt: r.payment?.paidAt || null, createdAt: r.createdAt,
    requestedByName: r.requestedByName || '',
    // Shown as an Edit button on the product line (the edit itself re-checks).
    canEdit: mayEdit(actor, r),
    credit: r.credit?.amount ? { amount: r.credit.amount } : null,
    // Paid, and the items were cancelled since: null, or the refund claim (if any).
    supplierRefund: refundOf(r),
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

const destinationLabel = (p = {}) => {
  if (p.method === 'upi') return p.upiId ? `UPI ${p.upiId}` : 'UPI by QR (see the request)';
  if (p.method === 'card') return `Card ${cardLabelOf(p)}`.trim();
  if (p.method !== 'bank') return 'Payment details not given yet';
  return `${p.bankName || 'Bank'} ${maskAccount(p.accountNumber)} · ${bankCodeLabel(p)}`;
};

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
      count: 0, total: 0, onHold: 0, onHoldTotal: 0, bankNotice: false, oldestAt: r.createdAt,
    };
    g.name = r.payee.name; // newest name wins (rows are oldest first)
    g.count += 1;
    // `total` is what is ready to pay. Held money is counted apart: a hold means
    // "don't pay this yet", so it must never sit inside the figure to send.
    if (r.status === 'on_hold') {
      g.onHold += 1;
      g.onHoldTotal = round2(g.onHoldTotal + r.amount);
    } else {
      g.total = round2(g.total + r.amount);
    }
    if (r.bankNotice?.at) g.bankNotice = true;
    groups.set(id, g);
    const p = r.payee || {};
    text.set(id, `${text.get(id) || ''} ${[p.name, p.upiId, p.bankName, p.ifsc, p.swift, g.destination, r.number, r.orderNumber, r.customer?.name].filter(Boolean).join(' ')}`.toLowerCase());
    amounts.set(id, [...(amounts.get(id) || []), r.amount]);
  }
  const words = searchWords(f.q);
  const matches = (g) => (!['bank', 'upi'].includes(f.method) || g.method === f.method)
    && words.every((w) => text.get(g.id).includes(w) || (amountOf(w) !== null && (g.total === amountOf(w) || g.onHoldTotal === amountOf(w) || amounts.get(g.id).includes(amountOf(w)))));
  const sortName = GROUP_SORTS[f.sort] ? f.sort : 'oldest';
  const shown = [...groups.values()].filter(matches).sort(GROUP_SORTS[sortName]);
  return {
    groups: shown,
    sort: sortName,
    summary: { count: shown.length, total: round2(shown.reduce((n, g) => n + g.total, 0)), onHoldTotal: round2(shown.reduce((n, g) => n + g.onHoldTotal, 0)), capped: false },
    truncated: rows.length >= TO_PAY_CAP,
  };
}

/** One destination's approved supplier payments, oldest first. */
export async function supplierPayGroup(actor, groupId) {
  if (!seesAll(actor)) throw fail('Not authorized.', 403);
  const all = (await paymentRequestRepository.findSupplierToPay(TO_PAY_CAP)).filter((r) => groupIdOf(r) === String(groupId));
  if (!all.length) throw fail('Nothing left to pay for this supplier.', 404);
  const rows = await withHoldHistory(all);
  const sum = (list) => round2(list.reduce((n, r) => n + r.amount, 0));
  return {
    id: String(groupId),
    name: rows[rows.length - 1].payee.name,
    destination: destinationLabel(rows[0].payee),
    // Ready to pay, and held — apart, as on the list (supplierPayGroups).
    total: sum(rows.filter((r) => r.status !== 'on_hold')),
    onHoldTotal: sum(rows.filter((r) => r.status === 'on_hold')),
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
export async function payBatch(actor, { ids, expectedTotal, method, reference, note, transactionAt, slipRead } = {}, proofFiles = [], req) {
  if (!mayPay(actor)) throw fail('Only the admin pays payment requests — accounts approves them.', 403);
  let list = ids;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = [list]; } }
  const wanted = [...new Set((Array.isArray(list) ? list : []).map(String))];
  if (!wanted.length) throw fail('Tick the payments you are paying.', 400);
  if (wanted.length > MAX_BATCH) throw fail(`Pay at most ${MAX_BATCH} at a time.`, 400);
  if (wanted.some((id) => !/^[a-f0-9]{24}$/i.test(id))) throw fail('Request not found.', 404);
  const how = paidMethodOf(method);
  if (!how) throw fail('Choose how it was paid.', 400);
  const ref = String(reference || '').trim(); // optional, as for a single payment
  const txAt = cleanTransactionAt(transactionAt);

  const rows = await paymentRequestRepository.findByIds(wanted);
  if (rows.length !== wanted.length) throw fail('Request not found.', 404);
  // A held payment is listed with the supplier but never paid — release it first.
  const held = rows.filter((r) => r.kind === 'supplier' && r.status === 'on_hold');
  if (held.length) {
    throw fail(`${held.map((r) => r.number).join(', ')} ${held.length === 1 ? 'is' : 'are'} on hold — release the hold before paying, or untick ${held.length === 1 ? 'it' : 'them'}.`, 409);
  }
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
  const payment = {
    method: how, reference: ref.slice(0, 120), paidAt: now, transactionAt: txAt, paidBy: actor._id, paidByName: actor.name || '', batch,
    slipRead: slipProvenance(actor, slipRead, { files: uploads, reference: ref, transactionAt: txAt }),
  };
  const together = `one transfer for ${rows.length} payment${rows.length === 1 ? '' : 's'}, ${inr(total)}`;
  const log = entry(actor, 'paid', [`${how.toUpperCase()} ${ref}`.trim(), together, note].filter(Boolean).join(' — '));

  let paid;
  try {
    paid = await paymentRequestRepository.inTransaction(async (session) => {
      const out = [];
      for (const r of rows) {
        const next = await paymentRequestRepository.transitionInSession(r._id, ['approved'], { kind: 'supplier' },
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
