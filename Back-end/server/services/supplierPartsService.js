/**
 * Supplier parts on an order line — procurement buys one product from several
 * suppliers, or changes a supplier (with a reason) when one refunds or cannot
 * deliver. The rules and shapes live in utils/supplierParts.js; this file loads,
 * checks who may act, closes a waiting payment through the payment-request flow,
 * and writes (compare-and-set on the line's `partsRev`).
 *
 * Internal procurement data only: no customer money, order total or customer-facing
 * screen changes here. Supplier money moves only through payment requests (PR-xxxx):
 *   - a part's payment still waiting for approval is CANCELLED the normal way when
 *     its supplier is changed;
 *   - an APPROVED one is accounts' call — the change is refused until they decline it;
 *   - a PAID one stays paid, and "Supplier must refund" opens on it
 *     (supplierLedgerService.claimRefund), so the money trail stays complete.
 */

import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import paymentRequestRepository from '../repositories/paymentRequestRepository.js';
import supplierDealRepository from '../repositories/supplierDealRepository.js';
import { STAGE_LABELS, STOCK } from '../utils/teamWorkflow.js';
import {
  PartError, materialize, addPart, replacePart, removePart, editPart, partForRequest,
  reasonText, cleanReason, cleanSupplierName, IMPLICIT_PART_ID, PART_STATUS,
} from '../utils/supplierParts.js';
import {
  loadWorkflowLine, refreshWorkflowOpen, workflowEvent, workflowCan, WORKFLOW_RACE, writeLineParts, getOrder, PART_STAGES,
} from './teamWorkflowService.js';
import { cancelForSupplierChange } from './paymentRequestService.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v == null ? '' : String(v._id ?? v));
const newId = () => new mongoose.Types.ObjectId();
const OPEN = new Set(['submitted', 'approved', 'on_hold']);
const LIVE = (r) => r.status !== 'declined' && r.status !== 'cancelled';

/** Run a pure parts rule; its refusals become ordinary 4xx answers. */
function rule(fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof PartError) throw fail(err.message, err.status);
    throw err;
  }
}

/**
 * Everything a parts change starts from: who may act, the line (in a stage where
 * its suppliers can still change), no supplier deal on it, its supplier payments,
 * and its parts (the implicit one written out on a line never split before).
 */
async function prepare(actor, orderId, itemId) {
  if (!workflowCan.procurement(actor)) throw fail('Only the procurement team can change suppliers.', 403);
  const { order, line } = await loadWorkflowLine(orderId, itemId);
  if (!PART_STAGES.has(line.stage)) {
    throw fail(`This item is "${STAGE_LABELS[line.stage]}" — its suppliers can no longer be changed.`, 409);
  }
  const [deal] = await supplierDealRepository.findOpenForOrder(order._id, [new mongoose.Types.ObjectId(String(itemId))], 1);
  if (deal) throw fail('This item is made to order and paid in parts through its supplier deal — change it there.', 409);
  const requests = (await paymentRequestRepository.findForOrder(order._id))
    .filter((r) => r.kind === 'supplier' && (r.itemIds || []).some((id) => idOf(id) === String(itemId)));
  const parts = materialize(line, { newId });
  return { order, line, requests, parts };
}

/** The payments (raised, not withdrawn) that belong to this part. */
const paymentsOf = (parts, part, requests) =>
  requests.filter((r) => LIVE(r) && idOf(partForRequest(parts, r)?._id) === idOf(part._id));

const partById = (parts, partId) => (String(partId) === IMPLICIT_PART_ID ? parts[0] : parts.find((p) => idOf(p._id) === String(partId)));

/**
 * The whole new parts array, written once. A line never split before becomes split
 * here: its line-level supplier payment moves onto its first part, and its stock
 * reads "in stock" (being sourced) — from now on its parts decide the stage.
 */
async function save(actor, orderId, itemId, line, parts, action, note) {
  const fromLegacy = !line.split;
  const legacyStock = [STOCK.PENDING, STOCK.ORDERED, null, undefined].includes(line.stock);
  // Splitting a line: also hold its own payment mark as read, so a payment raised
  // on the unsplit line at this very moment is not lost (the loser refreshes).
  const expect = fromLegacy ? { supplierPaymentAt: line.supplierPaymentAt || null, stock: line.stock ?? null } : {};
  const updated = await writeLineParts(orderId, itemId, line, parts, {
    expect,
    set: legacyStock ? { stock: STOCK.IN_STOCK, stockBy: actor._id, stockAt: line.stockAt || new Date() } : {},
    unset: fromLegacy ? ['supplierPaymentAt', 'supplierPaymentRef', 'paymentInitiatedBy', 'paymentInitiatedAt'] : [],
  }, workflowEvent(actor, action, { itemId: line.itemId, note: String(note || '').slice(0, 500) }));
  if (!updated) throw fail(WORKFLOW_RACE, 409);
  await refreshWorkflowOpen(orderId);
}

const label = (p) => `${p.what ? `${p.what} · ` : ''}${p.supplierName || 'no supplier'}`;

/** Procurement: buy (another) part of this item from a supplier — "the mount from supplier B". */
export async function addSupplierPart(actor, orderId, itemId, input = {}, req) {
  const { line, parts } = await prepare(actor, orderId, itemId);
  const { parts: next, part } = rule(() => addPart(parts, input, actor, { newId }));
  await save(actor, orderId, itemId, line, next, 'part_added', label(part));
  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, { change: 'supplier_part_added', itemId: String(itemId), partId: idOf(part._id), supplier: part.supplierName });
  return getOrder(actor, orderId);
}

/** Procurement: correct what a part is, or its supplier before any payment. */
export async function editSupplierPart(actor, orderId, itemId, partId, input = {}, req) {
  const { line, parts, requests } = await prepare(actor, orderId, itemId);
  const part = partById(parts, partId);
  if (!part) throw fail('That supplier part is not on this item. Refresh and try again.', 404);
  const { parts: next, changes } = rule(() => editPart(parts, partId, input, { hasPayments: paymentsOf(parts, part, requests).length > 0 }));
  if (!Object.keys(changes).length) return getOrder(actor, orderId);
  const note = [
    'what' in changes ? `What: ${part.what || '—'} → ${changes.what || '—'}` : '',
    'supplierName' in changes ? `Supplier: ${part.supplierName || '—'} → ${changes.supplierName}` : '',
  ].filter(Boolean).join(' · ');
  await save(actor, orderId, itemId, line, next, 'part_edited', note);
  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, { change: 'supplier_part_edited', itemId: String(itemId), partId: idOf(part._id), fields: Object.keys(changes) });
  return getOrder(actor, orderId);
}

/** Procurement: take out a part added by mistake (never paid). It stays in the history as removed. */
export async function removeSupplierPart(actor, orderId, itemId, partId, { note } = {}, req) {
  const { line, parts, requests } = await prepare(actor, orderId, itemId);
  const part = partById(parts, partId);
  if (!part) throw fail('That supplier part is not on this item. Refresh and try again.', 404);
  const { parts: next } = rule(() => removePart(parts, partId, { note, hasPayments: paymentsOf(parts, part, requests).length > 0 }, actor));
  await save(actor, orderId, itemId, line, next, 'part_removed', [label(part), String(note || '').trim()].filter(Boolean).join(' — '));
  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, { change: 'supplier_part_removed', itemId: String(itemId), partId: idOf(part._id) });
  return getOrder(actor, orderId);
}

/**
 * Procurement: change a part's supplier, with a reason ("Supplier refunded — out of
 * stock"). The old supplier stays as history; a payment still waiting on it is
 * cancelled; an approved one blocks the change; a paid one stays and its refund
 * claim opens.
 */
export async function changeSupplier(actor, orderId, itemId, partId, input = {}, req) {
  // Validate what was typed before touching any payment.
  rule(() => { cleanSupplierName(input.supplierName); cleanReason(input.reasonCode, input.reasonNote); });
  let { line, parts, requests } = await prepare(actor, orderId, itemId);
  let old = partById(parts, partId);
  if (!old) throw fail('This item has no supplier yet — add one with "Split across suppliers" or raise its supplier payment.', 404);
  if (old.status !== PART_STATUS.ACTIVE) throw fail('That supplier has already been changed. Refresh and try again.', 409);
  const reason = reasonText(cleanReason(input.reasonCode, input.reasonNote));

  // A payment still open on the old supplier must close first — through the payment flow.
  const open = paymentsOf(parts, old, requests).filter((r) => OPEN.has(r.status));
  const approved = open.find((r) => r.status !== 'submitted');
  if (approved) {
    const how = approved.status === 'on_hold' ? 'decline it' : 'put it on hold and decline it';
    throw fail(`${approved.number} to ${approved.payee?.name || old.supplierName} is already approved by accounts and not paid — ask accounts to ${how} first, then change the supplier.`, 409);
  }
  for (const r of open) {
    const cancelled = await cancelForSupplierChange(actor, idOf(r._id), `Supplier changed: ${reason}`, req);
    if (!cancelled) throw fail(`${r.number} has just been updated by someone else. Refresh and try again.`, 409);
  }
  if (open.length) {
    // The cancellation moved the line (cleared its payment); start again from what is saved now.
    ({ line, parts, requests } = await prepare(actor, orderId, itemId));
    old = partById(parts, partId);
    if (!old || old.status !== PART_STATUS.ACTIVE) throw fail(WORKFLOW_RACE, 409);
  }
  // No payment is open on it any more (just checked against the records): a stale
  // "payment pending" mark on the part must not block the change.
  if (old.paymentAt) parts = parts.map((p) => (p === old ? { ...p, paymentAt: null, paymentRef: '' } : p));
  const resolvedId = idOf(old._id);

  const { parts: next, old: was, part } = rule(() => replacePart(parts, resolvedId, input, actor, { newId }));
  const paid = paymentsOf(parts, was, requests).filter((r) => r.status === 'paid');
  const note = [
    `${was.supplierName || 'No supplier'} → ${part.supplierName}${part.what ? ` (${part.what})` : ''}`,
    reason,
    ...open.map((r) => `${r.number} cancelled`),
    ...paid.map((r) => `${r.number} paid — refund due from ${was.supplierName || 'the supplier'}`),
  ].join(' · ');
  await save(actor, orderId, itemId, line, next, 'supplier_changed', note);
  auditLogger.logAction(req, 'UPDATE', 'Order', orderId, {
    change: 'supplier_changed', itemId: String(itemId), partId: resolvedId, newPartId: idOf(part._id),
    from: was.supplierName || '', to: part.supplierName, reasonCode: input.reasonCode,
    cancelled: open.map((r) => r.number), paid: paid.map((r) => r.number),
  });
  return getOrder(actor, orderId);
}

