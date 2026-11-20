/**
 * Supplier parts — one order line bought from more than one supplier.
 *
 * Example: "Jerry Can 20L — with locking mount" is ONE product on the website but
 * two things to buy: the can (supplier A) and the mount (supplier B). Each part has
 * its own supplier, an optional "what is bought", its own supplier payment (PR) and
 * its own status. When a supplier refunds or cannot deliver, procurement CHANGES the
 * part's supplier: the old part is kept as "replaced" (never deleted) with who, when
 * and why, and a new active part takes its place.
 *
 * Stored on `Order.workflow.lines[].parts`. A line that was never split has no
 * `parts` and works exactly as before; it reads as ONE implicit part (id `main`)
 * made from its own `supplierName` / payment fields. The first time procurement
 * splits it or changes its supplier, that implicit part is written out as the first
 * real part (`materialize`). No data migration is needed.
 *
 * Linking payments: a supplier payment request (PR) raised for a part carries its
 * `partId`. A PR without one (every PR raised before parts existed) belongs to the
 * line's FIRST part — the supplier the line had before it was split.
 *
 * Pure functions: no I/O. Every write is the whole new `parts` array, saved with a
 * compare-and-set on `partsRev`, so two people at once cannot both land.
 */

export const IMPLICIT_PART_ID = 'main';
const UNKNOWN_DATE = new Date(0);
const known = (d) => (d && new Date(d).getTime() > 0 ? d : null);

export const PART_STATUS = Object.freeze({
  ACTIVE: 'active',
  REPLACED: 'replaced', // the supplier was changed — kept as history
  REMOVED: 'removed',   // added by mistake, never paid — kept as history
});

/** Accounts' review of a supplier change. Absent on changes made before reviews existed. */
export const REVIEW = Object.freeze({ PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' });

/** Why a supplier was changed: a common reason, plus the person's own words. */
export const CHANGE_REASONS = Object.freeze({
  supplier_refunded: 'Supplier refunded',
  out_of_stock: 'Supplier out of stock',
  late: "Supplier can't deliver on time",
  price_changed: 'Supplier changed the price',
  quality: 'Quality problem',
  other: 'Other',
});

/** Guards against an endlessly growing line (each part is a few hundred bytes). */
export const MAX_ACTIVE_PARTS = 6;
export const MAX_PARTS = 20;
export const NAME_MAX = 120;
export const WHAT_MAX = 120;
export const NOTE_MAX = 300;

const idOf = (v) => (v == null ? '' : String(v._id ?? v));
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const clean = (v, max) => String(v ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const sameName = (a, b) => clean(a, NAME_MAX).toLowerCase() === clean(b, NAME_MAX).toLowerCase();

export class PartError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

/** Has this line been split into stored parts? */
export const isSplit = (wfLine) => Array.isArray(wfLine?.parts) && wfLine.parts.length > 0;

/**
 * The line's parts as the screen shows them. A never-split line gives at most one
 * implicit part (only when it has a supplier at all); `stock` decides whether it is
 * ordered (paid) yet.
 */
export function partsOf(wfLine) {
  if (!wfLine) return [];
  if (isSplit(wfLine)) return wfLine.parts;
  const name = clean(wfLine.supplierName, NAME_MAX);
  if (!name && !wfLine.supplierPaymentAt) return [];
  if (wfLine.stock === 'own_stock') return [];
  return [{
    _id: IMPLICIT_PART_ID,
    what: '',
    supplierName: name,
    status: PART_STATUS.ACTIVE,
    paymentAt: wfLine.supplierPaymentAt || null,
    paymentRef: wfLine.supplierPaymentAt ? wfLine.supplierPaymentRef || '' : '',
    // An old "ordered" mark may carry no date: still ordered (epoch = "date unknown").
    orderedAt: !wfLine.supplierPaymentAt && wfLine.stock === 'ordered' ? wfLine.stockAt || UNKNOWN_DATE : null,
  }];
}

export const activeParts = (parts) => (parts || []).filter((p) => p.status === PART_STATUS.ACTIVE);

/**
 * Where a split line's supplier parts stand:
 *   paymentPending — some active part has a PR waiting
 *   allOrdered     — every active part is paid ("Ordered From Supplier")
 *   waiting        — active parts not yet paid (what holds the dispatch back)
 */
export function partsState(parts) {
  const active = activeParts(parts);
  const waiting = active.filter((p) => !p.orderedAt);
  return {
    active,
    waiting,
    paymentPending: active.some((p) => p.paymentAt),
    anyOrdered: active.some((p) => p.orderedAt),
    allOrdered: active.length > 0 && waiting.length === 0,
  };
}

/**
 * The implicit part written out as a real one (the first time a line is split or
 * its supplier changed). An unsplit line with no supplier yet gives [].
 */
export function materialize(wfLine, { newId, now = new Date() }) {
  if (isSplit(wfLine)) return wfLine.parts.map((p) => ({ ...p }));
  return partsOf(wfLine).map((p) => ({
    ...p,
    _id: newId(),
    createdAt: wfLine.stockAt || now,
    createdByName: '',
  }));
}

const findPart = (parts, partId) => {
  const id = String(partId || '');
  if (id === IMPLICIT_PART_ID) return parts[0] || null;
  return parts.find((p) => idOf(p._id) === id) || null;
};

/** The part a PR belongs to: its `partId`, else the line's first part (raised before the split). */
export function partForRequest(parts, request) {
  if (!parts?.length) return null;
  if (request?.partId) return parts.find((p) => idOf(p._id) === idOf(request.partId)) || null;
  return parts[0];
}

export function cleanSupplierName(v) {
  const name = clean(v, NAME_MAX);
  if (!name) throw new PartError('Enter the supplier.', 400);
  return name;
}

export function cleanReason(code, note) {
  const reasonCode = String(code || '');
  if (!CHANGE_REASONS[reasonCode]) throw new PartError('Choose why the supplier is changing.', 400);
  const reasonNote = clean(note, NOTE_MAX);
  if (reasonCode === 'other' && reasonNote.length < 3) throw new PartError('Say why the supplier is changing.', 400);
  return { reasonCode, reasonNote };
}

/** "Supplier refunded — out of stock" */
export const reasonText = ({ reasonCode, reasonNote }) =>
  [reasonCode && reasonCode !== 'other' ? CHANGE_REASONS[reasonCode] : '', reasonNote].filter(Boolean).join(' — ');

const who = (actor) => ({ by: actor?._id, byName: actor?.name || '' });

/** Add another supplier part ("the mount from supplier B"). */
export function addPart(parts, { supplierName, what }, actor, { newId, now = new Date() }) {
  if (parts.length >= MAX_PARTS) throw new PartError(`An item can have at most ${MAX_PARTS} supplier entries.`);
  if (activeParts(parts).length >= MAX_ACTIVE_PARTS) throw new PartError(`An item can be split into at most ${MAX_ACTIVE_PARTS} parts.`);
  const part = {
    _id: newId(),
    what: clean(what, WHAT_MAX),
    supplierName: cleanSupplierName(supplierName),
    status: PART_STATUS.ACTIVE,
    createdAt: now,
    createdBy: who(actor).by,
    createdByName: who(actor).byName,
  };
  return { parts: [...parts, part], part };
}

/**
 * Change a part's supplier. The old part is kept, marked replaced, with who / when /
 * why and which part replaced it; the new part starts with no payment. The caller
 * must already have closed (cancelled) a payment still waiting on the old part.
 */
export function replacePart(parts, partId, { supplierName, what, reasonCode, reasonNote }, actor, { newId, now = new Date() }) {
  const old = findPart(parts, partId);
  if (!old || old.status !== PART_STATUS.ACTIVE) throw new PartError('That supplier entry has already been changed. Refresh and try again.');
  if (old.paymentAt) {
    throw new PartError(`Supplier payment ${old.paymentRef || 'on this part'} is still open — it must be cancelled or declined first.`);
  }
  if (parts.length >= MAX_PARTS) throw new PartError(`An item can have at most ${MAX_PARTS} supplier entries.`);
  const name = cleanSupplierName(supplierName);
  if (sameName(name, old.supplierName)) throw new PartError(`That is the same supplier (${old.supplierName}). Enter the new one.`, 400);
  const reason = cleanReason(reasonCode, reasonNote);
  const fresh = {
    _id: newId(),
    what: what == null ? old.what || '' : clean(what, WHAT_MAX),
    supplierName: name,
    status: PART_STATUS.ACTIVE,
    createdAt: now,
    createdBy: who(actor).by,
    createdByName: who(actor).byName,
    replaces: old._id,
  };
  const next = parts.map((p) => (p === old ? {
    ...p,
    status: PART_STATUS.REPLACED,
    replacedAt: now,
    replacedBy: who(actor).by,
    replacedByName: who(actor).byName,
    replacedWith: fresh._id,
    ...reason,
    // Accounts reviews every supplier change (owner, 2026-11-20). The change itself
    // takes effect now — procurement keeps buying; the money it causes (the new PR,
    // the old supplier's refund) waits for accounts on its own.
    reviewStatus: REVIEW.PENDING,
  } : p));
  return { parts: [...next, fresh], old, part: fresh, reason };
}

/** Remove a part added by mistake — only one that never had a payment. Kept, marked removed. */
export function removePart(parts, partId, { note, hasPayments }, actor, { now = new Date() } = {}) {
  const part = findPart(parts, partId);
  if (!part || part.status !== PART_STATUS.ACTIVE) throw new PartError('That supplier entry has already been changed. Refresh and try again.');
  if (part.paymentAt || part.orderedAt || hasPayments) {
    throw new PartError('This part has a supplier payment — use "Change supplier" instead, so the money trail stays.');
  }
  if (activeParts(parts).length <= 1) throw new PartError('An item needs at least one supplier part. Use "Change supplier" instead.');
  return {
    part,
    parts: parts.map((p) => (p === part ? {
      ...p, status: PART_STATUS.REMOVED, replacedAt: now, replacedBy: who(actor).by, replacedByName: who(actor).byName, reasonNote: clean(note, NOTE_MAX),
    } : p)),
  };
}

/** Correct what a part is (always) and its supplier (only before any payment). */
export function editPart(parts, partId, { what, supplierName }, { hasPayments }) {
  const part = findPart(parts, partId);
  if (!part || part.status !== PART_STATUS.ACTIVE) throw new PartError('That supplier entry has already been changed. Refresh and try again.');
  const changes = {};
  if (what != null && clean(what, WHAT_MAX) !== (part.what || '')) changes.what = clean(what, WHAT_MAX);
  if (supplierName != null && !sameName(supplierName, part.supplierName)) {
    if (part.paymentAt || part.orderedAt || hasPayments) {
      throw new PartError('This part has a supplier payment — use "Change supplier" (with a reason) instead.');
    }
    changes.supplierName = cleanSupplierName(supplierName);
  }
  return { part, changes, parts: parts.map((p) => (p === part ? { ...p, ...changes } : p)) };
}

// ── Payment events (from the payment-request flow) ────────────────────────────

/** The part a payment event is about: by its id, else the one whose open PR is `ref`, else the first. */
function partForEvent(parts, { partId, ref }) {
  if (partId) return findPart(parts, partId);
  if (ref) {
    const byRef = parts.find((p) => p.paymentRef && p.paymentRef === ref);
    if (byRef) return byRef;
  }
  return parts[0] || null;
}

/** A PR was raised for a part: it reads "Payment Pending". */
export function partPaymentRaised(parts, { partId, ref, supplierName }, now = new Date()) {
  const part = partForEvent(parts, { partId });
  if (!part || part.status !== PART_STATUS.ACTIVE) return null;
  const name = clean(supplierName, NAME_MAX);
  return parts.map((p) => (p === part ? {
    ...p, paymentAt: now, paymentRef: String(ref || '').slice(0, 20), ...(!p.supplierName && name ? { supplierName: name } : {}),
  } : p));
}

/** The PR was paid: the part is ordered from its supplier. */
export function partPaymentPaid(parts, { partId, ref }, now = new Date()) {
  const part = partForEvent(parts, { partId, ref });
  if (!part || !part.paymentAt) return null;
  return parts.map((p) => (p === part ? { ...p, paymentAt: null, paymentRef: '', orderedAt: now, orderedRef: part.paymentRef || ref || '' } : p));
}

/** The PR was cancelled / declined: the part waits for a payment again. */
export function partPaymentCleared(parts, { partId, ref }) {
  const part = partForEvent(parts, { partId, ref });
  if (!part || !part.paymentAt) return null;
  return parts.map((p) => (p === part ? { ...p, paymentAt: null, paymentRef: '' } : p));
}

/** The supplier name the line shows elsewhere (returns, chat): its first active part's. */
export const lineSupplierName = (parts) => activeParts(parts)[0]?.supplierName || '';

/** What is still holding a split line's dispatch back, in words. */
export function waitingText(parts) {
  return partsState(parts).waiting
    .map((p) => `${p.what || 'part'} from ${p.supplierName}${p.paymentAt ? ` (${p.paymentRef || 'payment'} not paid yet)` : ' (not paid yet)'}`)
    .join('; ');
}

/**
 * Was this paid PR's part replaced (the supplier was changed)? Then the supplier owes
 * the money back, exactly as when the customer cancels — through the same claim.
 */
export function requestPartReplaced(order, request) {
  const ids = (request?.itemIds || []).map(idOf);
  return ids.some((itemId) => {
    const line = (order?.workflow?.lines || []).find((l) => idOf(l.itemId) === itemId);
    if (!isSplit(line)) return false;
    const part = partForRequest(line.parts, request);
    return !!part && part.status !== PART_STATUS.ACTIVE;
  });
}

/** The parts as the panel shows them (newest change last). */
export function partsView(wfLine) {
  return partsOf(wfLine).map((p) => ({
    id: idOf(p._id),
    what: p.what || '',
    supplierName: p.supplierName || '',
    status: p.status,
    state: p.status !== PART_STATUS.ACTIVE ? p.status : p.paymentAt ? 'payment_pending' : p.orderedAt ? 'ordered' : 'to_order',
    paymentRef: p.paymentRef || '',
    orderedAt: known(p.orderedAt),
    createdAt: known(p.createdAt),
    createdByName: p.createdByName || '',
    replacedAt: p.replacedAt || null,
    replacedByName: p.replacedByName || '',
    replacedWith: p.replacedWith ? idOf(p.replacedWith) : null,
    replaces: p.replaces ? idOf(p.replaces) : null,
    reasonCode: p.reasonCode || '',
    reason: p.status === PART_STATUS.REPLACED ? reasonText(p) : p.reasonNote || '',
    review: p.reviewStatus ? {
      status: p.reviewStatus,
      byName: p.reviewedByName || '',
      at: p.reviewedAt || null,
      note: p.reviewNote || '',
    } : null,
  }));
}

/**
 * Accounts approves or rejects a supplier change (the replaced part carries it).
 * Rejecting needs a reason — procurement and the admin read it. Nobody reviews
 * their own change except the admin. Decided once: a second decision is refused.
 */
export function reviewPart(parts, partId, { decision, note }, actor, { now = new Date(), isAdmin = false } = {}) {
  const part = findPart(parts, partId);
  if (!part || part.status !== PART_STATUS.REPLACED || !part.reviewStatus) throw new PartError('That supplier change was not found.', 404);
  if (part.reviewStatus !== REVIEW.PENDING) throw new PartError('This supplier change has already been reviewed. Refresh to see it.');
  if (!isAdmin && idOf(part.replacedBy) && idOf(part.replacedBy) === idOf(actor?._id)) {
    throw new PartError('Someone else has to review a supplier change you made.', 403);
  }
  if (decision !== 'approve' && decision !== 'reject') throw new PartError('Approve or reject it.', 400);
  const reviewNote = clean(note, NOTE_MAX);
  if (decision === 'reject' && reviewNote.length < 3) throw new PartError('Say why it is rejected — procurement sees this.', 400);
  const next = parts.map((p) => (p === part ? {
    ...p,
    reviewStatus: decision === 'approve' ? REVIEW.APPROVED : REVIEW.REJECTED,
    reviewedAt: now,
    reviewedBy: who(actor).by,
    reviewedByName: who(actor).byName,
    reviewNote,
  } : p));
  return { parts: next, part };
}

/** Does any line of this order still have a supplier change waiting for accounts? */
export const hasPendingReview = (order) => (order?.workflow?.lines || [])
  .some((l) => (l.parts || []).some((p) => p.reviewStatus === REVIEW.PENDING));
