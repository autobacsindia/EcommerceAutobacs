/**
 * The admin's lookup: type a project ID ("PRJ-0007"), an order number
 * ("#AB12CD34", a WooCommerce "#12345") or any other ID put on a payment
 * ("INV-2231"), and see everything linked to it:
 *
 *   project  → the project, its open and done tasks, its payments (with totals),
 *              and the orders its tasks and payments point at, with their status timeline
 *   order    → the order and its timeline, its tasks, its payments, and the projects
 *              those tasks and payments belong to
 *   other ID → the payments carrying it
 *
 * Admin only (the route enforces it, and so does this): it reads across every team.
 * Read-only. Every list is keyset-paged and bounded; a `section` + `cursor` asks
 * for the next page of one list only.
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import staffProjectRepository from '../repositories/staffProjectRepository.js';
import staffTaskRepository from '../repositories/staffTaskRepository.js';
import paymentRequestRepository from '../repositories/paymentRequestRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import { getProject, projectCode, projectNumberIn } from './staffProjectService.js';
import { orderNumber } from './invoiceService.js';

export const LOOKUP_PAGE_SIZE = 20;
/** How many linked orders / projects one lookup lists (each has its own page). */
export const LINKED_MAX = 50;
/** Rows read to find the linked orders / projects: far above any real project. */
const LINK_SCAN_CAP = 2000;
/** More order matches than this for a short number: ask for more of it. */
const ORDER_CANDIDATES_MAX = 8;

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v?._id ?? v)?.toString();
const isAdmin = (u) => u?.role === 'admin';

// ── Cursors ─────────────────────────────────────────────────────────────────

const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function dec(cursor) {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
  } catch {
    throw fail('Invalid page cursor.', 400);
  }
}
const oid = (s) => {
  if (!mongoose.isValidObjectId(s)) throw fail('Invalid page cursor.', 400);
  return new mongoose.Types.ObjectId(s);
};

// ── Shapes ──────────────────────────────────────────────────────────────────

const taskRow = (t) => ({
  id: idOf(t._id),
  code: `T-${t.number}`,
  title: t.title,
  status: t.status,
  bucket: t.bucket,
  dueOn: t.dueOn || null,
  assignees: (t.assignees || []).map((a) => a.name || '').filter(Boolean),
  order: t.order ? { id: idOf(t.order.target), number: t.order.code } : null,
});

export const paymentRow = (r) => ({
  id: idOf(r._id),
  number: r.number,
  kind: r.kind,
  status: r.status,
  team: r.team,
  category: r.category,
  amount: r.amount,
  currency: r.currency || 'INR',
  foreignAmount: r.foreignAmount ?? null,
  payee: r.payee?.name || '',
  requestedBy: r.requestedByName || '',
  order: r.order ? { id: idOf(r.order), number: r.orderNumber || '' } : null,
  project: r.project ? { id: idOf(r.project), code: r.projectCode || '', name: r.projectName || '' } : null,
  reference: r.reference || '',
  paidAt: r.payment?.transactionAt || r.payment?.paidAt || null,
  createdAt: r.createdAt,
});

const orderRow = (o) => ({
  id: idOf(o._id),
  number: orderNumber(o),
  customer: o.shippingAddress?.fullName || '',
  city: o.shippingAddress?.city || '',
  total: o.totalAmount ?? null,
  status: o.status,
  paymentStatus: o.paymentStatus,
  createdAt: o.createdAt,
  // Oldest first: how it got where it is.
  timeline: (o.statusHistory || [])
    .map((h) => ({ status: h.status, at: h.timestamp || null }))
    .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0)),
});

const projectRow = (p) => ({ id: idOf(p._id), code: projectCode(p.number), name: p.name, archived: !!p.archivedAt });

// ── Pages ───────────────────────────────────────────────────────────────────

async function taskPage(projectId, bucket, cursor) {
  const c = dec(cursor);
  const after = c ? { rank: String(c.r), id: oid(c.i) } : null;
  const rows = await staffTaskRepository.pageForProject(projectId, bucket, { after, limit: LOOKUP_PAGE_SIZE + 1 });
  const more = rows.length > LOOKUP_PAGE_SIZE;
  const page = more ? rows.slice(0, LOOKUP_PAGE_SIZE) : rows;
  const last = page[page.length - 1];
  return { items: page.map(taskRow), nextCursor: more ? enc({ r: last.rank, i: idOf(last._id) }) : null };
}

async function orderTaskPage(orderId, cursor) {
  const c = dec(cursor);
  const rows = await staffTaskRepository.pageForOrder(orderId, { after: c ? oid(c.i) : null, limit: LOOKUP_PAGE_SIZE + 1 });
  const more = rows.length > LOOKUP_PAGE_SIZE;
  const page = more ? rows.slice(0, LOOKUP_PAGE_SIZE) : rows;
  return { items: page.map(taskRow), nextCursor: more ? enc({ i: idOf(page[page.length - 1]._id) }) : null };
}

/**
 * One page of the payments linked to a project / order / ID, newest first.
 * `shape` turns a row into what the screen gets; `purposeChars` also reads what
 * each payment was for, cut to that length in the database (the project's Money box).
 */
export async function paymentPage(by, cursor, { shape = paymentRow, purposeChars = 0 } = {}) {
  const c = dec(cursor);
  let after = null;
  if (c) {
    const at = new Date(c.c);
    if (Number.isNaN(at.getTime())) throw fail('Invalid page cursor.', 400);
    after = { createdAt: at, id: oid(c.i) };
  }
  const rows = await paymentRequestRepository.pageLinked(by, { after, limit: LOOKUP_PAGE_SIZE + 1, purposeChars });
  const more = rows.length > LOOKUP_PAGE_SIZE;
  const page = more ? rows.slice(0, LOOKUP_PAGE_SIZE) : rows;
  const last = page[page.length - 1];
  return { items: page.map(shape), nextCursor: more ? enc({ c: last.createdAt.toISOString(), i: idOf(last._id) }) : null };
}

/** Paid / waiting / declined… for a project, in rupees. Foreign bills not yet priced count as 0. */
export async function paymentTotals(projectId) {
  return totalsOf(await paymentRequestRepository.totalsForProject(projectId));
}

/** Rows of { _id: status, n, amount } → paid / waiting / closed. */
export function totalsOf(rows) {
  const by = Object.fromEntries(rows.map((r) => [r._id, { count: r.n, amount: Math.round(r.amount * 100) / 100 }]));
  const sum = (ks) => ks.reduce((s, k) => s + (by[k]?.amount || 0), 0);
  const n = (ks) => ks.reduce((s, k) => s + (by[k]?.count || 0), 0);
  return {
    paid: { count: n(['paid']), amount: Math.round(sum(['paid']) * 100) / 100 },
    waiting: { count: n(['submitted', 'approved', 'on_hold']), amount: Math.round(sum(['submitted', 'approved', 'on_hold']) * 100) / 100 },
    closed: { count: n(['declined', 'cancelled']) },
  };
}

async function ordersById(ids) {
  const list = ids.slice(0, LINKED_MAX).map((x) => new mongoose.Types.ObjectId(x));
  if (!list.length) return [];
  const rows = await orderRepository.findForLookup(list);
  return rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(orderRow);
}

// ── What was typed ──────────────────────────────────────────────────────────

const looksLikeProject = (q) => /^\s*prj/i.test(q);

/** The orders a typed number may mean (full id, the panel's last-8, a WooCommerce number). */
async function ordersFor(q) {
  const term = q.replace(/^#+/, '').replace(/\s+/g, '');
  if (!/^[a-f0-9]{4,24}$/i.test(term) && !/^\d{1,9}$/.test(term)) return [];
  // The same matching the expense form's order picker uses; names are not tried here.
  const rows = await orderRepository.findForPaymentLink(term, { limit: ORDER_CANDIDATES_MAX + 1 });
  const want = term.toLowerCase();
  return rows.filter((o) => idOf(o._id).toLowerCase().endsWith(want) || String(o.wpId ?? '') === term);
}

// ── Lookup ──────────────────────────────────────────────────────────────────

async function forProject(p, { section, cursor } = {}, actor) {
  if (section === 'open' || section === 'done') return { tasks: { [section]: await taskPage(p._id, section, cursor) } };
  if (section === 'payments') return { payments: await paymentPage({ project: p._id }, cursor) };
  if (section) throw fail('Unknown list.', 400);
  const [project, open, done, payments, totals, fromTasks, fromPayments] = await Promise.all([
    getProject(actor, p._id),
    taskPage(p._id, 'open'),
    taskPage(p._id, 'done'),
    paymentPage({ project: p._id }),
    paymentTotals(p._id),
    staffTaskRepository.ordersForProject(p._id, LINK_SCAN_CAP),
    paymentRequestRepository.ordersForProject(p._id, LINK_SCAN_CAP),
  ]);
  const orderIds = [...new Set([...fromTasks, ...fromPayments])];
  return {
    match: 'project',
    project,
    tasks: { open, done },
    payments: { ...payments, totals },
    orders: await ordersById(orderIds),
    ordersCapped: orderIds.length > LINKED_MAX,
  };
}

async function forOrder(order, { section, cursor } = {}) {
  if (section === 'tasks') return { tasks: { order: await orderTaskPage(order._id, cursor) } };
  if (section === 'payments') return { payments: await paymentPage({ order: order._id }, cursor) };
  if (section) throw fail('Unknown list.', 400);
  const [tasks, payments, fromTasks, fromPayments] = await Promise.all([
    orderTaskPage(order._id),
    paymentPage({ order: order._id }),
    staffTaskRepository.projectsForOrder(order._id, LINK_SCAN_CAP),
    paymentRequestRepository.projectsForOrder(order._id, LINK_SCAN_CAP),
  ]);
  const projectIds = [...new Set([...fromTasks, ...fromPayments])].slice(0, LINKED_MAX).map((x) => new mongoose.Types.ObjectId(x));
  const projects = projectIds.length ? await staffProjectRepository.findByIds(projectIds) : [];
  const [full] = await orderRepository.findForLookup([order._id]);
  return {
    match: 'order',
    order: orderRow(full || order),
    tasks: { order: tasks },
    payments,
    projects: projects.map(projectRow),
  };
}

/**
 * Everything linked to what the admin typed. `section` + `cursor` return the next
 * page of one list ('open' / 'done' / 'payments' for a project; 'tasks' /
 * 'payments' for an order; 'payments' for another ID).
 */
export async function lookup(actor, { q, section, cursor } = {}) {
  if (!isAdmin(actor)) throw fail('Not authorized.', 403);
  const raw = typeof q === 'string' ? q.trim().slice(0, 80) : '';
  if (raw.length < 1) throw fail('Type a project ID, an order number or another ID.', 400);

  // "PRJ-…" is always a project.
  if (looksLikeProject(raw)) {
    const number = projectNumberIn(raw);
    const p = number && await staffProjectRepository.findByNumber(number);
    if (!p) return { match: 'none', query: raw, message: number ? `No project ${projectCode(number)}.` : 'Type a project ID like PRJ-0007.' };
    return { query: raw, ...(await forProject(p, { section, cursor }, actor)) };
  }

  const orders = await ordersFor(raw);
  if (orders.length === 1) return { query: raw, ...(await forOrder(orders[0], { section, cursor })) };
  if (orders.length > 1) {
    return {
      match: 'orders',
      query: raw,
      message: orders.length > ORDER_CANDIDATES_MAX ? 'Many orders match — type more of the number.' : 'Several orders match — pick one.',
      orders: (await ordersById(orders.slice(0, ORDER_CANDIDATES_MAX).map(idOf))),
    };
  }

  // Bare digits with no order: a project number ("7" → PRJ-0007).
  const number = /^\d+$/.test(raw) ? projectNumberIn(raw) : null;
  const p = number && await staffProjectRepository.findByNumber(number);
  if (p) return { query: raw, ...(await forProject(p, { section, cursor }, actor)) };

  // Anything else: another ID put on payments.
  const payments = await paymentPage({ reference: raw }, cursor);
  if (section && section !== 'payments') throw fail('Unknown list.', 400);
  if (section) return { payments };
  if (!payments.items.length) return { match: 'none', query: raw, message: `Nothing is linked to “${raw}”.` };
  return { match: 'reference', query: raw, payments };
}
