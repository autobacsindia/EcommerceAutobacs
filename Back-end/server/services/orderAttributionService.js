/**
 * Crediting a website order to the salesman who closed it.
 *
 * A GTM lead talks a customer through the sale, and the customer then pays on the
 * website themselves. The order arrives as a plain website order (no `salesUser`),
 * so it is missing from that salesman's orders and reports. Admin and marketing
 * fix that here.
 *
 * What this may change: `salesUser` and nothing else. Never price, payment or
 * status. Hence the limits:
 *   - any PAID order — a website order credited to a salesman, a salesman's order
 *     moved to another salesman, or either set back to "Website order" (the admin
 *     orders list's "Sold by" dropdown).
 *   - paid orders only. An unpaid order still has live payment machinery keyed on
 *     `salesUser` (payment-link reconciliation in paymentReconciliationService),
 *     and the money truth for a paid order is already settled by the webhook.
 *   - compare-and-set on the seller the person SAW, so two people at once (or a
 *     stale screen) cannot silently overwrite each other.
 *   - proof is required for every change: at least one file, or a written note
 *     of MIN_PROOF_NOTE characters. Checked here, so no screen or direct API call
 *     can skip it.
 *   - one submission (`changeId`) makes one change: a double-click or a retry
 *     after a dropped connection gets the same result, not a second record.
 * Every change is kept on the order (`salesAttribution`), permanently, and in the audit log.
 */

import crypto from 'crypto';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import orderRepository from '../repositories/orderRepository.js';
import userRepository from '../repositories/userRepository.js';
import { STAFF_TEAMS, canSell } from '../config/staff.js';
import { orderNumber } from './invoiceService.js';
import { pinnedIds, inPinOrder } from './orderPinService.js';
import { and } from '../utils/listQuery.js';
import { checkAttachments } from './storage/attachmentCheck.js';
import { storeAll } from './storage/storeAll.js';
import { putPrivateAsset, deletePrivateAsset, readPrivateAsset, resourceTypeFor } from './storage/privateUploads.js';
import { listDateOf } from '../utils/orderListDate.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

const PAGE_SIZE = 25;
/**
 * Changes one order can hold. Never trimmed — it is a permanent record — so past
 * this the change is refused. Keeps the order safely under MongoDB's 16 MB limit;
 * a real order is changed a handful of times.
 */
export const MAX_CHANGES = 500;
/** A written note counts as proof from this length ("ok" is not proof). */
export const MIN_PROOF_NOTE = 20;
const MAX_NOTE = 1000;
const PROOF_FOLDER = 'order-credit-proof'; // a PRIVATE prefix (storage/assetScope.js)

const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);
const isAdmin = (u) => u?.role === 'admin';
const isMarketing = (u) => u?.role === 'staff' && u.staff?.active === true && u.staff.team === STAFF_TEAMS.MARKETING;

const isAccounts = (u) => u?.role === 'staff' && u.staff?.active === true && u.staff.team === STAFF_TEAMS.ACCOUNTS;

/** Admin and marketing credit website orders. */
export const mayAttribute = (u) => isAdmin(u) || isMarketing(u);

/**
 * Who may READ the credit history and open its proof: those who change it, plus
 * accounts (who reconcile the sale). Reading only — every write still goes
 * through `assertMay`, so accounts can never change the seller.
 */
export const mayViewAttribution = (u) => mayAttribute(u) || isAccounts(u);

function assertMay(actor) {
  if (!mayAttribute(actor)) throw fail('Only admin and marketing can credit a website order to a salesman.', 403);
}

// ── Cursor (keyset on listDate desc, _id desc — the paid date, utils/orderListDate.js)
// The `L` tag retires cursors made when this list paged on createdAt.
// An order written before listDate existed has none until
// scripts/backfill-order-list-date.js has run. Those rows are one class MongoDB
// sorts together, below every real date, so they are the tail of this list and
// get the `N` tag — paged through by _id. Encoding must never throw:
// `new Date(undefined).toISOString()` is a RangeError that 500s the whole list.
const encodeCursor = (o) => {
  if (!o?._id) return null;
  const at = o.listDate == null ? null : listDateOf({ listDate: o.listDate });
  return Buffer.from(at ? `L|${at.toISOString()}|${o._id}` : `N||${o._id}`).toString('base64url');
};
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const [tag, iso, id] = Buffer.from(String(cursor), 'base64url').toString().split('|');
    if (!['L', 'N'].includes(tag) || !/^[a-f0-9]{24}$/i.test(id || '')) return null;
    if (tag === 'N') return { listDate: null, id };
    const listDate = new Date(iso);
    if (Number.isNaN(listDate.getTime())) return null;
    return { listDate, id };
  } catch {
    return null;
  }
}

/** The keyset clause for the page after `c`, or null on page 1. */
const afterCursor = (c) => {
  if (!c) return null;
  // Past the dated rows and into the undated tail: the rest of that tail.
  if (c.listDate === null) return { listDate: null, _id: { $lt: c.id } };
  return {
    $or: [
      { listDate: { $lt: c.listDate } },
      { listDate: c.listDate, _id: { $lt: c.id } },
    ],
  };
};

/** Who a website order can be credited to: the GTM head and GTM leads — the people who sell. */
export async function listSellers(actor) {
  assertMay(actor);
  const team = await userRepository.findActiveStaff(STAFF_TEAMS.SALES);
  return team.filter(canSell).map((u) => ({ id: idOf(u._id), name: u.name || '', isHead: u.staff?.isHead === true }));
}

/**
 * Only what is needed to recognise the order — no phone, email or address lines
 * (marketing has no other reason to hold them).
 */
const shapeRow = (o) => ({
  id: idOf(o._id),
  orderNumber: orderNumber(o),
  createdAt: o.createdAt,
  paidAt: o.paidAt || null,
  totalAmount: o.totalAmount,
  status: o.status,
  customer: o.shippingAddress?.fullName || o.user?.name || '',
  city: [o.shippingAddress?.city, o.shippingAddress?.state].filter(Boolean).join(', '),
  items: (o.items || []).map((i) => `${i.name}${i.quantity > 1 ? ` × ${i.quantity}` : ''}`),
  seller: o.salesUser ? { id: idOf(o.salesUser), name: o.salesUser.name || '' } : null,
  history: (o.salesAttribution || []).slice().reverse().map(changeView),
});

/** One recorded change, display-safe: names, date, note, proof file names — never the storage location. */
function changeView(h) {
  return {
    at: h.at, by: h.byName || '', from: h.fromName || null, to: h.toName || null, note: h.note || '',
    // Entries written before proof was required have no changeId.
    proofRequired: !!h.changeId,
    files: (h.proofFiles || []).map((f) => ({ id: idOf(f._id), name: f.name || 'File', contentType: f.contentType || '', bytes: f.bytes || 0 })),
  };
}

/**
 * The read-only "Sale history" for the accounts order panel: how the order
 * started, then each change, oldest first. `null` when the seller was never
 * changed, so the panel shows nothing extra. The caller decides who sees it.
 */
export function saleHistoryOf(o) {
  const changes = o?.salesAttribution || [];
  if (!changes.length) return null;
  const firstSeller = changes[0].fromName || '';
  return {
    startedAs: o.source === 'web' ? 'Website order' : `Sales order${firstSeller ? ` — ${firstSeller}` : ''}`,
    changes: changes.map(changeView),
  };
}

/**
 * Paid website orders, newest paid first, credited or not (so a wrong credit can
 * be fixed). Rides the `team_workflow_paid_list_date` partial index: every paid
 * order enters the team workflow the moment its payment confirms (orderStatusService).
 * The viewer's pinned orders (services/orderPinService.js) come first on page 1.
 */
export async function listWebsiteOrders(actor, { cursor } = {}) {
  assertMay(actor);
  const base = { paymentStatus: 'paid', 'workflow.enteredAt': { $type: 'date' }, source: 'web' };
  const pins = await pinnedIds(actor);
  const c = decodeCursor(cursor);
  const query = and(
    base,
    pins.length ? { _id: { $nin: pins } } : null,
    afterCursor(c),
  );
  const [rows, pinnedRows] = await Promise.all([
    orderRepository.find(query, {
      limit: PAGE_SIZE + 1,
      sort: { listDate: -1, _id: -1 },
      select: ROW_SELECT,
      populate: ROW_POPULATE,
    }),
    c || !pins.length ? [] : orderRepository.find(and(base, { _id: { $in: pins } }), {
      limit: pins.length, select: ROW_SELECT, populate: ROW_POPULATE,
    }),
  ]);
  const hasMore = rows.length > PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return {
    orders: [
      ...inPinOrder(pinnedRows, pins).map((o) => ({ ...shapeRow(o), pinned: true })),
      ...items.map(shapeRow),
    ],
    nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null,
  };
}

const ROW_SELECT = 'orderNumber wpId createdAt paidAt listDate totalAmount status paymentStatus source items.name items.quantity '
  + 'shippingAddress.fullName shippingAddress.city shippingAddress.state user salesUser salesAttribution';
const ROW_POPULATE = [{ path: 'user', select: 'name' }, { path: 'salesUser', select: 'name' }];

/**
 * One order, for the box on the order page. `null` when it is not a paid website
 * order — the box then simply does not show (no error for the many orders that
 * are not eligible).
 */
export async function getWebsiteOrder(actor, orderId) {
  assertMay(actor);
  const [o] = await orderRepository.find({ _id: orderId }, { limit: 1, select: ROW_SELECT, populate: ROW_POPULATE });
  if (!o || o.paymentStatus !== 'paid') return null;
  // A salesman's own order can be moved from the Orders list; once it has been, its record shows here too.
  if (o.source !== 'web' && !o.salesAttribution?.length) return null;
  return shapeRow(o);
}

const removeProof = (stored) => Promise.all(stored.map((f) =>
  deletePrivateAsset({ publicId: f.publicId, provider: f.provider, resourceType: resourceTypeFor(f.contentType) }).catch(() => {})));

const storeProof = (checked) => storeAll(checked, async ({ file, contentType, ext, name }) => {
  const ref = await putPrivateAsset({
    buffer: file.buffer,
    folder: PROOF_FOLDER,
    basename: `proof-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`,
    contentType,
    cloudinaryPrivate: true,
  });
  return { publicId: ref.publicId, provider: ref.provider, url: ref.url || '', contentType, bytes: ref.bytes, name };
}, (f) => removeProof([f]));

/** The entry this submission already wrote on `order`, if any. */
const entryFor = (order, changeId, actor) => (order?.salesAttribution || [])
  .find((h) => h.changeId === changeId && idOf(h.by) === idOf(actor._id));

const loadRow = (orderId) => orderRepository.model.findById(orderId).populate(ROW_POPULATE).lean();

/**
 * Credit (or un-credit, `salesUserId: null`) a paid website order.
 * @param {{ salesUserId: string|null, expectedSalesUserId: string|null, changeId: string, note?: string }} input
 *   `expectedSalesUserId` — the seller the person saw on screen (null = "no one").
 *   `changeId` — made once per submission by the screen, so a retry is recognised.
 * @param {object[]} files multer files (field `proof`) — the proof, with or instead of the note
 */
export async function setSeller(actor, orderId, { salesUserId = null, expectedSalesUserId = null, note, changeId } = {}, files = [], req) {
  assertMay(actor);
  const to = salesUserId ? String(salesUserId) : null;
  const expected = expectedSalesUserId ? String(expectedSalesUserId) : null;
  if (to === expected) throw fail('That salesman is already credited with this order.', 400);
  if (!changeId) throw fail('Refresh the page and try again.', 400);

  const text = String(note || '').trim().slice(0, MAX_NOTE);
  const checked = checkAttachments(files, { allowDocuments: true });
  if (!checked.length && text.replace(/\s+/g, ' ').length < MIN_PROOF_NOTE) {
    throw fail(`Add proof: attach a file, or write at least ${MIN_PROOF_NOTE} characters explaining the change.`, 400);
  }

  const order = await orderRepository.findById(orderId, [{ path: 'salesUser', select: 'name' }]);
  if (!order) throw fail('Order not found.', 404);
  // A retry of a change that already went through: same answer, nothing new.
  if (entryFor(order, changeId, actor)) return shapeRow(await loadRow(order._id));

  let seller = null;
  if (to) {
    seller = (await listSellers(actor)).find((s) => s.id === to);
    if (!seller) throw fail('Choose an active GTM head or GTM lead.', 400);
  }
  if (order.paymentStatus !== 'paid') throw fail('Only a paid order\'s salesman can be changed — an unpaid one still has payment links tied to its salesman.', 409);
  // Checked again in the write below; this one saves storing files that would only be removed.
  if (idOf(order.salesUser) !== expected) throw fail('Someone else just changed this order. Refresh and try again.', 409);
  if ((order.salesAttribution || []).length >= MAX_CHANGES) {
    throw fail('This order has reached the limit of recorded changes. Please contact the admin.', 409);
  }

  const proofFiles = await storeProof(checked);
  const entry = {
    at: new Date(),
    by: actor._id,
    byName: actor.name || '',
    from: expected,
    fromName: order.salesUser && idOf(order.salesUser) === expected ? order.salesUser.name || '' : '',
    to,
    toName: seller?.name || '',
    note: text,
    changeId,
    ...(proofFiles.length && { proofFiles }),
  };
  let updated;
  try {
    // One atomic write: the seller, the record and the retry guard land together or not at all.
    updated = await orderRepository.model.findOneAndUpdate(
      {
        _id: order._id,
        paymentStatus: 'paid',
        salesUser: expected,
        'salesAttribution.changeId': { $ne: changeId },
        [`salesAttribution.${MAX_CHANGES - 1}`]: { $exists: false },
      },
      { $set: { salesUser: to }, $push: { salesAttribution: entry } },
      { new: true },
    ).populate(ROW_POPULATE).lean();
  } catch (err) {
    await removeProof(proofFiles);
    throw err;
  }
  if (!updated) {
    await removeProof(proofFiles);
    // Lost to our own double-click (it went through) or to another person (it did not).
    const now = await loadRow(order._id);
    if (entryFor(now, changeId, actor)) return shapeRow(now);
    throw fail('Someone else just changed this order. Refresh and try again.', 409);
  }

  auditLogger.logAction(req, 'UPDATE', 'Order', idOf(order._id), {
    change: 'sales_attribution', from: expected, to, note: text || undefined, files: proofFiles.length, changeId,
  });
  return shapeRow(updated);
}

/** One proof file, streamed through us (never a public link) to those who may see the credit history. */
export async function getProofFile(actor, orderId, fileId) {
  if (!mayViewAttribution(actor)) throw fail('Only admin, marketing and accounts can open this file.', 403);
  const order = await loadRow(orderId);
  const f = (order?.salesAttribution || []).flatMap((h) => h.proofFiles || []).find((x) => idOf(x._id) === String(fileId));
  if (!f) throw fail('File not found.', 404);
  const buffer = await readPrivateAsset(f, async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`File fetch failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  });
  return { buffer, contentType: f.contentType, name: f.name || 'proof' };
}

export default { mayAttribute, mayViewAttribution, saleHistoryOf, listSellers, listWebsiteOrders, getWebsiteOrder, setSeller, getProofFile };
