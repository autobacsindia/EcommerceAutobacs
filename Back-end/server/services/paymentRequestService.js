/**
 * Payment requests — the company paying a supplier for an order's item, or a
 * team's expense (fuel, travel, food, a purchase). See models/PaymentRequest.js
 * for the states.
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
import { detectKind, KIND } from './storage/contentSniff.js';
import { postSystemMessage } from './chatService.js';
import { orderNumber } from './invoiceService.js';
import { STAFF_TEAMS, STAFF_TEAM_LABELS, STAFF_TEAM_VALUES } from '../config/staff.js';
import { workflowView, STAGE } from '../utils/teamWorkflow.js';
import { variantDisplayName } from '../utils/orderLines.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v == null ? '' : String(v._id ?? v));

export const PAYMENT_FILES_FOLDER = 'payment-requests'; // a PRIVATE prefix (storage/assetScope.js)
export const MAX_PAYMENT_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_AMOUNT = 10000000; // ₹1 crore: a typo guard, not a business limit
export const EXPENSE_CATEGORIES = Object.freeze(['fuel', 'travel', 'food', 'purchase', 'other']);
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

const UPI = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT = /^\d{6,18}$/;

/** The payee's details, checked for the shape a payment actually needs. */
export function cleanPayee(p = {}) {
  const name = String(p.name || '').trim().slice(0, 120);
  if (name.length < 2) throw fail('Enter who is being paid.', 400);
  const method = p.method === 'bank' ? 'bank' : p.method === 'upi' ? 'upi' : null;
  if (!method) throw fail('Choose UPI or bank transfer.', 400);
  const payee = { name, method, phone: String(p.phone || '').trim().slice(0, 20) };
  if (method === 'upi') {
    const upiId = String(p.upiId || '').trim();
    if (!UPI.test(upiId)) throw fail('Enter a valid UPI ID (e.g. name@okaxis).', 400);
    payee.upiId = upiId;
  } else {
    const accountNumber = String(p.accountNumber || '').replace(/\s+/g, '');
    const ifsc = String(p.ifsc || '').trim().toUpperCase();
    const accountName = String(p.accountName || '').trim().slice(0, 120);
    if (!ACCOUNT.test(accountNumber)) throw fail('Enter a valid bank account number (6–18 digits).', 400);
    if (!IFSC.test(ifsc)) throw fail('Enter a valid IFSC code (e.g. HDFC0001234).', 400);
    if (accountName.length < 2) throw fail('Enter the account holder\'s name.', 400);
    Object.assign(payee, { accountNumber, ifsc, accountName, bankName: String(p.bankName || '').trim().slice(0, 120) });
  }
  return payee;
}

/** "XXXXXX4321" — for lists and chat, where the full number is not needed. */
export const maskAccount = (n) => (n ? `${'X'.repeat(Math.max(0, String(n).length - 4))}${String(n).slice(-4)}` : '');

/** Store uploaded files privately after checking the bytes are a photo or a PDF. */
async function storeFiles(files, kinds, actor) {
  const stored = [];
  try {
    for (const { file, kind } of files.map((file, i) => ({ file, kind: kinds[i] }))) {
      if (!file?.buffer?.length) continue;
      if (file.buffer.length > MAX_PAYMENT_FILE_BYTES) throw fail('A file is too large (8 MB maximum).', 400);
      const sniffed = detectKind(file.buffer);
      if (sniffed !== KIND.IMAGE && sniffed !== KIND.PDF) throw fail('Upload a photo (JPG, PNG, WebP) or a PDF.', 400);
      const ext = sniffed === KIND.PDF ? 'pdf' : ({ 'image/png': 'png', 'image/webp': 'webp' }[file.mimetype] || 'jpg');
      const contentType = sniffed === KIND.PDF ? 'application/pdf' : (file.mimetype || 'image/jpeg');
      const ref = await putPrivateAsset({
        buffer: file.buffer,
        folder: PAYMENT_FILES_FOLDER,
        basename: `${kind}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`,
        contentType,
        cloudinaryPrivate: true,
      });
      stored.push({
        kind, publicId: ref.publicId, provider: ref.provider, contentType, bytes: ref.bytes,
        name: String(file.originalname || '').slice(0, 200), uploadedBy: actor._id, uploadedAt: new Date(),
      });
    }
  } catch (err) {
    // Nothing half-saved: remove what was stored before the failure.
    await Promise.all(stored.map((f) => deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: f.contentType === 'application/pdf' ? 'raw' : 'image' }).catch(() => {})));
    throw err;
  }
  return stored;
}

/** `{ bill: [file], qr: [file] }` (multer fields) → ordered list with kinds. */
const filesFrom = (uploaded = {}) => {
  const out = [];
  for (const f of uploaded.bill || []) out.push(['bill', f]);
  for (const f of uploaded.qr || []) out.push(['qr', f]);
  return { files: out.map(([, f]) => f), kinds: out.map(([k]) => k) };
};

const nextNumber = async () => `PR-${String(await counterRepository.next('payment_request')).padStart(4, '0')}`;

// ── Chat ─────────────────────────────────────────────────────────────────────

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
  : `${r.category} expense ${r.number} — ${inr(r.amount)} to ${r.payee.name}`);

// ── Shapes ───────────────────────────────────────────────────────────────────

/** What the panel shows, and what this person may do with it now. */
export function shape(r, viewer) {
  const full = seesAll(viewer) || idOf(r.requestedBy) === idOf(viewer?._id);
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
    amount: r.amount,
    category: r.category,
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
    },
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
  const category = String(input.category || '');
  if (!EXPENSE_CATEGORIES.includes(category)) throw fail('Choose what the expense is for.', 400);
  const description = String(input.description || '').trim().slice(0, 2000);
  if (description.length < 3) throw fail('Describe what this payment is for.', 400);
  const amount = cleanAmount(input.amount);
  const payee = cleanPayee(input.payee);

  const { files, kinds } = filesFrom(uploaded);
  const stored = await storeFiles(files, kinds, actor);
  const doc = await paymentRequestRepository.create({
    number: await nextNumber(),
    kind: 'expense',
    status: 'submitted',
    team,
    requestedBy: actor._id,
    requestedByName: actor.name || '',
    amount, category, description, payee,
    files: stored,
    history: [entry(actor, 'submitted')],
  });
  auditLogger.logAction(req, 'CREATE', 'PaymentRequest', doc._id, { kind: 'expense', amount, team });
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
  if (wanted.some((id) => !payable.has(id))) {
    throw fail('A supplier can only be paid for items marked in stock or ordered from the supplier, and not yet shipped.', 409);
  }
  const open = await paymentRequestRepository.findOpenForOrder(order._id);
  const busy = open.find((r) => (r.itemIds || []).some((id) => wanted.includes(idOf(id))));
  if (busy) throw fail(`${busy.number} for this item is already ${STATUS_LABELS[busy.status].toLowerCase()}.`, 409);

  const amount = cleanAmount(input.amount);
  const payee = cleanPayee(input.payee);
  const description = String(input.description || '').trim().slice(0, 2000);
  const { files, kinds } = filesFrom(uploaded);
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
    files: stored,
    history: [entry(actor, 'submitted')],
  });
  auditLogger.logAction(req, 'CREATE', 'PaymentRequest', doc._id, { kind: 'supplier', amount, orderId: idOf(order._id) });
  await tellChat(doc, 'submitted', `🧾 New ${what(doc)} — ${doc.itemNames.join(', ')}. Raised by ${doc.requestedByName}. Accounts: please approve or decline.`);
  return shape(doc, actor);
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
export async function markPaid(actor, id, { method, reference, note } = {}, proofFile, req) {
  if (!mayPay(actor)) throw fail('Only the admin pays payment requests — accounts approves them.', 403);
  const how = ['razorpay', 'bank', 'upi', 'other'].includes(method) ? method : null;
  if (!how) throw fail('Choose how it was paid.', 400);
  const ref = String(reference || '').trim();
  if (ref.length < 4) throw fail('Enter the payment reference (Razorpay payout ID or bank UTR).', 400);
  const r0 = await loadVisible(actor, id);
  // The admin paying a request still waiting for approval approves it in the same step.
  const from = ['submitted', 'approved', 'on_hold'];
  const proof = proofFile ? await storeFiles([proofFile], ['proof'], actor) : [];
  const now = new Date();
  const r = await paymentRequestRepository.transition(id, from, {
    ...(r0.status === 'submitted' ? { approvedBy: actor._id, approvedAt: now } : {}),
    status: 'paid',
    payment: { method: how, reference: ref.slice(0, 120), paidAt: now, paidBy: actor._id, paidByName: actor.name || '' },
  }, entry(actor, 'paid', [`${how.toUpperCase()} ${ref}`, note].filter(Boolean).join(' — ')), proof.length ? { files: { $each: proof } } : {});
  if (!r) {
    // Lost the race: the screenshot belongs to no payment.
    await Promise.all(proof.map((f) => deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: 'image' }).catch(() => {})));
    throw fail(MOVED, 409);
  }
  auditLogger.logAction(req, 'UPDATE', 'PaymentRequest', id, { change: 'paid', method: how, reference: ref });
  const next = r.kind === 'supplier' ? ' Procurement: get the shipping details from the supplier and upload them.' : '';
  await tellChat(r, 'paid', `💸 Paid ${what(r)} — ${how.toUpperCase()} ref ${ref}.${next}`, { mentionRequester: true });
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
  await tellChat(r, 'cancelled', `↩️ ${r.requestedByName} cancelled ${what(r)}.`);
  return shape(r, actor);
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
  const open = await paymentRequestRepository.findOpenForOrder(orderId);
  const ids = itemIds.map(String);
  const pending = open.find((r) => (r.itemIds || []).some((id) => ids.includes(idOf(id))));
  if (pending) {
    throw fail(`Supplier payment ${pending.number} is ${STATUS_LABELS[pending.status].toLowerCase()} — ship once it is paid.`, 409);
  }
}
