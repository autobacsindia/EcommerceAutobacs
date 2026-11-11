/**
 * Everything about one order for the Admin, in one read-only answer: the money,
 * who did what, and the records linked to it. Writes nothing. A fixed set of
 * bounded reads by indexed fields; no per-row lookups.
 *
 * Money rule: the order's own numbers are the snapshot on the order; each extra is
 * its own record. Nothing here is taken from the client or from live product prices.
 */
import mongoose from 'mongoose';
import orderRepository from '../repositories/orderRepository.js';
import orderExtraChargeRepository from '../repositories/orderExtraChargeRepository.js';
import bankTransferRepository from '../repositories/bankTransferRepository.js';
import paymentRepository from '../repositories/paymentRepository.js';
import paymentRequestRepository from '../repositories/paymentRequestRepository.js';
import returnRequestRepository from '../repositories/returnRequestRepository.js';
import salesQuotationRepository from '../repositories/salesQuotationRepository.js';
import leadRepository from '../repositories/leadRepository.js';
import userRepository from '../repositories/userRepository.js';
import * as supplierDeals from './supplierDealService.js';
import { STATUS_LABELS as REQUEST_STATUS } from './paymentRequestService.js';
import { HISTORY_LABELS } from './teamWorkflowService.js';
import AppError from '../utils/AppError.js';
import { buildOrderTimeline, orderStatusLabel, timelineUserIds } from '../utils/orderTimeline.js';
import { extraTotals, statusLabel, toPaise } from '../utils/extraCharge.js';

const ROWS = 50; // far above any real order; a bound, not a business rule
const fromPaise = (p) => Math.round(p) / 100;
const sum = (rows, pick) => rows.reduce((total, r) => total + pick(r), 0);
const INR = (r) => !r.currency || r.currency === 'INR';

/** Pure: the money box. All arithmetic in paise. */
export function moneySummary({ order, extras = [], returns = [], requests = [], payments = [] }) {
  const totals = extraTotals(order, extras);
  const orderTotal = toPaise(order.totalAmount);
  const offer = toPaise(order.gatewayOffer?.discount || 0);
  const fullyPaid = ['paid', 'refunded'].includes(order.paymentStatus) || Boolean(order.paidAt);
  const partsPaid = sum((order.paymentParts || []).filter((p) => p.status === 'paid'), (p) => toPaise(p.amount));
  const orderReceived = fullyPaid ? Math.max(0, orderTotal - offer) : partsPaid;
  const closed = ['cancelled', 'returned'].includes(order.status);
  const toCollect = (fullyPaid || closed ? 0 : Math.max(0, orderTotal - partsPaid)) + toPaise(totals.extrasWaiting);

  // Same sources as refundMathService, but only money that has actually gone back.
  const rd = order.refundDetails;
  const mirror = typeof rd?.notes === 'string' && rd.notes.startsWith('Return ');
  const byStatus = (status) => sum(returns.filter((r) => r.refund?.status === status), (r) => toPaise(r.refund.finalAmount || 0))
    + sum((order.cancellations || []).filter((c) => c.refund?.status === status), (c) => Math.floor(Number(c.refund.amountPaise) || 0))
    + (rd?.status === status && !mirror ? toPaise(rd.amount || 0) : 0);
  const extraGateways = new Set(extras.map((e) => e.gatewayPaymentId).filter(Boolean));
  const paymentRefunds = sum(payments.filter((p) => !extraGateways.has(p.gatewayPaymentId)), (p) => toPaise(p.refundAmount || 0));
  const orderRefunded = Math.max(byStatus('completed'), paymentRefunds);
  const refunded = orderRefunded + toPaise(totals.extrasRefunded);
  const refundInProgress = byStatus('processing') + sum(extras.filter((e) => e.refund?.status === 'processing'), (e) => toPaise(e.amount));

  const supplier = requests.filter((r) => r.kind === 'supplier');
  const billOf = (r) => toPaise(r.amount) + (INR(r) && r.credit?.amount ? toPaise(r.credit.amount) : 0);
  const supplierPaidRows = supplier.filter((r) => r.status === 'paid');
  const supplierPaid = sum(supplierPaidRows, billOf);
  const supplierWaiting = sum(supplier.filter((r) => ['submitted', 'approved', 'on_hold'].includes(r.status)), billOf);
  const expenses = sum(requests.filter((r) => r.kind === 'expense' && r.status === 'paid'), (r) => toPaise(r.amount));
  const received = orderReceived + toPaise(totals.extrasPaid);

  return {
    orderTotal: fromPaise(orderTotal),
    gatewayOffer: fromPaise(offer),
    extrasPaid: totals.extrasPaid,
    extrasWaiting: totals.extrasWaiting,
    extrasRefundDue: totals.extrasRefundDue,
    totalWithExtras: totals.finalAmount,
    received: fromPaise(received),
    refunded: fromPaise(refunded),
    refundInProgress: fromPaise(refundInProgress),
    toCollect: fromPaise(toCollect),
    supplierPaid: fromPaise(supplierPaid),
    supplierWaiting: fromPaise(supplierWaiting),
    // Paid from a foreign account or rupees not known yet: not in supplierPaid.
    supplierNotPriced: supplierPaidRows.filter((r) => !r.amount).length,
    expenses: fromPaise(expenses),
    leftAfterSupplier: fromPaise(received - refunded - supplierPaid),
  };
}

function paymentRows(order, extras, transfers, payments) {
  const rows = payments.map((p) => {
    const extra = extras.find((e) => e.gatewayPaymentId && e.gatewayPaymentId === p.gatewayPaymentId);
    return {
      id: String(p._id), label: extra ? `Extra ${extra.sequence}` : 'Order', amount: p.amount, method: p.paymentMethod || p.paymentGateway || '',
      reference: p.gatewayPaymentId || p.transactionId || '', status: p.status, at: p.createdAt, refunded: p.refundAmount || 0,
    };
  });
  for (const t of transfers) {
    rows.push({
      id: String(t._id), label: t.extraCharge ? 'Extra (bank)' : 'Order (bank)', amount: t.amount, method: 'Bank transfer',
      reference: t.reference, status: t.status, at: t.paidOn, refunded: 0,
    });
  }
  return rows.sort((a, b) => new Date(a.at) - new Date(b.at));
}

const requestRow = (r) => ({
  id: String(r._id), number: r.number, kind: r.kind, status: r.status, statusLabel: REQUEST_STATUS[r.status] || r.status,
  payee: r.payee?.name || '', items: r.itemNames || [], amount: r.amount, currency: r.currency || 'INR', foreignAmount: r.foreignAmount ?? null,
  part: r.part || '', paidAt: r.payment?.paidAt || null, askedBy: r.requestedByName || '', createdAt: r.createdAt,
});

const returnRow = (r) => ({
  id: String(r._id), status: r.status, statusLabel: orderStatusLabel(r.status), createdAt: r.createdAt,
  refundStatus: r.refund?.status || null, refundAmount: r.refund?.finalAmount ?? null,
});

const customerOf = (order, user) => ({
  name: user?.name || order.shippingAddress?.fullName || '',
  accountDeleted: !user,
});

/** @param actor must already be an admin (the route checks). */
export async function getOrderOverview(actor, orderId) {
  const order = await orderRepository.model.findById(orderId).lean();
  if (!order) throw new AppError('Order not found.', 404, { expose: true });

  const id = order._id;
  const bounded = (query) => query.limit(ROWS).lean();
  const [extras, transfers, payments, requests, returns, quotation, lead, deals] = await Promise.all([
    orderExtraChargeRepository.findByOrder(id),
    bounded(bankTransferRepository.model.find({ order: id }).sort({ createdAt: -1 }).select('amount reference paidOn status extraCharge history')),
    bounded(paymentRepository.model.find({ order: id }).sort({ createdAt: 1 }).select('amount paymentMethod paymentGateway gatewayPaymentId transactionId status refundAmount createdAt')),
    paymentRequestRepository.findForOrder(id),
    returnRequestRepository.findForOverview(id, ROWS),
    salesQuotationRepository.findByOrder(id, 'number version status'),
    order.crmLeadId ? leadRepository.model.findById(order.crmLeadId).select('name followUpStatus').lean() : null,
    supplierDeals.forOrder(actor, id),
  ]);

  const userIds = [...new Set([...timelineUserIds(order, returns), order.user ? String(order.user) : null].filter(Boolean))]
    .filter((u) => mongoose.isValidObjectId(u));
  const users = userIds.length
    ? await userRepository.model.find({ _id: { $in: userIds } }).select('name').limit(userIds.length).lean()
    : [];
  const names = new Map(users.map((u) => [String(u._id), u.name || '']));
  const nameOf = (u) => (u ? names.get(String(u)) || '' : '');
  const user = order.user ? users.find((u) => String(u._id) === String(order.user)) : null;

  return {
    orderNumber: order.orderNumber,
    status: order.status,
    statusLabel: orderStatusLabel(order.status),
    customer: customerOf(order, user),
    money: moneySummary({ order, extras, returns, requests, payments }),
    payments: paymentRows(order, extras, transfers, payments),
    extras: extras.map((e) => ({ id: String(e._id), sequence: e.sequence, amount: e.amount, reason: e.reason, statusLabel: statusLabel(e) })),
    supplierPayments: requests.map(requestRow),
    supplierDeals: deals,
    returns: returns.map(returnRow),
    linked: {
      source: order.source || 'web',
      invoiceNo: order.invoiceNo ?? null,
      seller: order.salesUser ? nameOf(order.salesUser) : '',
      quotation: quotation ? { id: String(quotation._id), number: quotation.number, version: quotation.version } : null,
      lead: lead ? { id: String(lead._id), name: lead.name || '', status: lead.followUpStatus || '' } : null,
      couponCode: order.couponCode || '',
      couponDiscount: order.couponDiscount || 0,
      karmaDiscount: order.karmaDiscount || 0,
      affiliate: order.affiliate?.code || '',
      onHold: Boolean(order.salesHold?.until),
    },
    timeline: buildOrderTimeline({ order, extras, transfers, returns, requests, workflowLabels: HISTORY_LABELS, nameOf }),
  };
}
