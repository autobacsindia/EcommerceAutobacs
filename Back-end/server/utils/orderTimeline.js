/**
 * One plain-language story of an order, built only from the records passed in.
 * Pure: no database, so every line can be unit tested. Each event is
 * { at, kind, what, who, note }, oldest first, at most MAX_TIMELINE events.
 */
export const MAX_TIMELINE = 300;

const ORDER_STATUS = {
  awaiting_payment: 'Waiting for payment', pending: 'Waiting for payment', processing: 'Being processed',
  shipped: 'Shipped', delivered: 'Delivered', returned: 'Returned', cancelled: 'Cancelled',
};
const EXTRA_ACTION = {
  requested: 'Extra charge asked for', edited: 'Extra charge edited', cancelled: 'Extra charge cancelled', approved: 'Extra charge approved by Accounts',
  rejected: 'Extra charge rejected by Accounts', link_sent: 'Payment link sent for extra charge', paid: 'Extra charge paid',
  refund_due: 'Extra charge to be refunded', refund_started: 'Extra charge refund started', refunded: 'Extra charge refunded', refund_failed: 'Extra charge refund failed',
};
const TRANSFER_ACTION = {
  recorded: 'Bank payment recorded', edited: 'Bank payment edited', withdrawn: 'Bank payment withdrawn',
  confirmed: 'Bank payment confirmed by Accounts', rejected: 'Bank payment rejected by Accounts',
};

const humanize = (text) => {
  const s = String(text || '').replace(/_/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
};
export const orderStatusLabel = (status) => ORDER_STATUS[status] || humanize(status);
const rupee = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

/** @param sources { order, extras, transfers, returns, requests, workflowLabels, nameOf } */
export function buildOrderTimeline({ order, extras = [], transfers = [], returns = [], requests = [], workflowLabels = {}, nameOf = () => '' }) {
  const events = [];
  const add = (at, kind, what, who = '', note = '') => {
    const when = at ? new Date(at) : null;
    if (when && !Number.isNaN(when.getTime())) events.push({ at: when.toISOString(), kind, what, who: who || '', note: note || '' });
  };

  add(order.createdAt, 'order', 'Order placed', order.salesUser ? nameOf(order.salesUser) : 'Customer');
  for (const h of order.statusHistory || []) add(h.timestamp, 'order', `Order status: ${orderStatusLabel(h.status)}`, nameOf(h.updatedBy), h.reason || h.notes);
  for (const a of order.salesAttribution || []) add(a.at, 'sales', `Sale credited to ${a.toName || 'no one'}${a.fromName ? ` (was ${a.fromName})` : ''}`, a.byName, a.note);

  if (order.paidAt) add(order.paidAt, 'money', `Payment received: ${rupee(order.totalAmount)}`, order.offlinePayment?.confirmedByName || 'Razorpay');
  for (const p of order.paymentParts || []) {
    if (p.paidAt) add(p.paidAt, 'money', `Part payment received: ${rupee(p.amount)}`, 'Razorpay');
  }
  for (const t of transfers) for (const h of t.history || []) add(h.at, 'money', `${t.extraCharge ? 'Extra charge: ' : ''}${TRANSFER_ACTION[h.action] || humanize(h.action)} (${rupee(t.amount)})`, h.byName, h.note);
  for (const e of extras) for (const h of e.history || []) add(h.at, 'extra', `${EXTRA_ACTION[h.action] || humanize(h.action)} (${rupee(e.amount)})`, h.byName, h.note);

  for (const h of order.workflow?.history || []) add(h.at, 'work', workflowLabels[h.action] || humanize(h.action), h.byName, h.note);
  // The team's own log already covers parcels on orders that went through it.
  const hasWorkLog = (order.workflow?.history || []).length > 0;
  for (const s of order.shipments || []) {
    if (!hasWorkLog && s.shippedAt) add(s.shippedAt, 'delivery', `Parcel ${s.sequence} shipped`);
    if (!hasWorkLog && s.deliveredAt) add(s.deliveredAt, 'delivery', `Parcel ${s.sequence} delivered`);
    for (const h of s.etaHistory || []) add(h.at, 'delivery', `Parcel ${s.sequence} delivery date changed to ${h.to}`, h.byName, h.from ? `Was ${h.from}` : '');
  }

  for (const c of order.cancellations || []) {
    add(c.cancelledAt, 'order', `Items cancelled (cancellation ${c.sequence})`, nameOf(c.cancelledBy), c.reason || c.notes);
    if (c.refund?.status === 'completed') add(c.refund.completedAt, 'money', `Refund sent: ${rupee((c.refund.amountPaise || 0) / 100)}`);
    if (c.refund?.status === 'failed') add(c.refund.initiatedAt, 'money', 'Refund failed', '', c.refund.failureReason);
  }
  const rd = order.refundDetails;
  if (rd?.status && !String(rd.notes || '').startsWith('Return ')) {
    add(rd.processedAt || rd.requestedAt, 'money', `Refund ${rd.status}: ${rupee(rd.amount)}`, nameOf(rd.processedBy), rd.failureReason);
  }
  for (const r of returns) for (const h of r.timeline || []) add(h.timestamp, 'return', `Return: ${humanize(h.status)}`, nameOf(h.updatedBy), h.note);

  for (const r of requests) {
    const label = r.kind === 'supplier' ? `Supplier payment ${r.number}` : `Expense ${r.number}`;
    add(r.createdAt, 'supplier', `${label} asked for: ${rupee(r.amount)}`, r.requestedByName);
    if (r.status === 'paid') add(r.payment?.paidAt, 'supplier', `${label} paid to ${r.payee?.name || 'payee'}`, r.payment?.paidByName);
  }

  events.sort((a, b) => a.at.localeCompare(b.at));
  return events.slice(-MAX_TIMELINE);
}

/** Every user id the timeline needs a name for: read once, in one query. */
export function timelineUserIds(order, returns = []) {
  const ids = [
    order.salesUser,
    order.refundDetails?.processedBy,
    ...(order.statusHistory || []).map((h) => h.updatedBy),
    ...(order.cancellations || []).map((c) => c.cancelledBy),
    ...returns.flatMap((r) => (r.timeline || []).map((h) => h.updatedBy)),
  ];
  return [...new Set(ids.filter(Boolean).map(String))];
}
