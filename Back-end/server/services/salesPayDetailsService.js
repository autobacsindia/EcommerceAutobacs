/**
 * How a GTM-sold order's customer is told to pay when it is not (only) a
 * Razorpay link: the company bank account, a GPay / UPI QR, or another way.
 * Printed on the payment request PDF and in the WhatsApp text.
 *
 *   • Only the seller (or the GTM head), only while the order is unpaid and no
 *     bank transfer is waiting for accounts — a compare-and-set on exactly that,
 *     so a payment landing at the same moment wins.
 *   • Nothing here marks anything paid: the customer's payment is recorded as a
 *     bank transfer (UTR + screenshot) and confirmed by accounts, as before.
 *   • Every save is posted in full to #accounts — they check the bank, so they
 *     see exactly which account the customer was told to pay into.
 *   • The QR image is a PRIVATE file, served to the seller through the API.
 */
import crypto from 'crypto';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import orderRepository from '../repositories/orderRepository.js';
import { loadOwnUnpaid, getSalesOrder } from './salesOrderService.js';
import { putPrivateAsset, deletePrivateAsset, readPrivateAsset } from './storage/privateUploads.js';
import { detectKind, KIND } from './storage/contentSniff.js';
import { postSystemMessage } from './chatService.js';
import { orderNumber } from './invoiceService.js';
import { canSell } from '../config/staff.js';
import { cleanPayDetails, payDetailsLines } from '../utils/salesPayDetails.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => (v == null ? '' : String(v._id ?? v));
export const PAY_DETAILS_FOLDER = 'sales-pay-details';
const MAX_QR_BYTES = 5 * 1024 * 1024;
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

async function storeQr(file, orderId) {
  if (!file?.buffer?.length) return null;
  if (file.buffer.length > MAX_QR_BYTES) throw fail('The QR image is too large (5 MB maximum).', 400);
  if (detectKind(file.buffer) !== KIND.IMAGE) throw fail('The QR must be a photo (JPG, PNG or WebP).', 400);
  const ext = { 'image/png': 'png', 'image/webp': 'webp' }[file.mimetype] || 'jpg';
  const contentType = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg' }[ext];
  const ref = await putPrivateAsset({
    buffer: file.buffer,
    folder: `${PAY_DETAILS_FOLDER}/${orderId}`,
    basename: `qr-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`,
    contentType,
    cloudinaryPrivate: true,
  });
  return { publicId: ref.publicId, provider: ref.provider, contentType, bytes: ref.bytes };
}

const drop = (qr) => (qr?.publicId
  ? deletePrivateAsset({ publicId: qr.publicId, provider: qr.provider, resourceType: 'image' }).catch(() => {})
  : Promise.resolve());

/**
 * Set (or change) the payment details on an unpaid sales order.
 * @param {object} input  { method, bank?(JSON), upiId?, note? }
 * @param {object|null} qrFile  multer file (field `qr`), optional when one is already saved
 */
export async function setPayDetails(actor, orderId, input = {}, qrFile = null, req) {
  const order = await loadOwnUnpaid(actor, orderId);
  const before = order.salesPayDetails || null;
  const keepsQr = input.method === 'upi_qr' && !!before?.qr?.publicId;
  // Check everything before storing anything.
  const clean = cleanPayDetails(input, { hasQr: !!qrFile?.buffer?.length || keepsQr });

  const newQr = clean.method === 'upi_qr' ? await storeQr(qrFile, idOf(order._id)) : null;
  const qr = clean.method === 'upi_qr' ? newQr || before?.qr || null : null;
  const details = { ...clean, qr, setBy: actor._id, setByName: actor.name || '', setAt: new Date() };

  const updated = await orderRepository.model.findOneAndUpdate(
    { _id: order._id, status: 'awaiting_payment', paymentStatus: 'pending', bankTransferPendingAt: null },
    { $set: { salesPayDetails: details } },
    { new: true },
  );
  if (!updated) {
    await drop(newQr);
    throw fail('This order was paid or changed just now — reload it.', 409);
  }
  // The QR it replaced (or that a switch to bank / other made unused).
  if (before?.qr?.publicId && before.qr.publicId !== qr?.publicId) await drop(before.qr);

  auditLogger.logAction(req, 'UPDATE', 'Order', idOf(order._id), {
    change: before ? 'sales_pay_details_changed' : 'sales_pay_details_set', method: clean.method,
    ...(clean.bank && { accountLast4: clean.bank.accountNumber.slice(-4), ifsc: clean.bank.ifsc }),
  });
  try {
    const lines = payDetailsLines(details, updated.totalAmount);
    await postSystemMessage('team:accounts',
      `🧾 ${orderNumber(updated)} — ${actor.name} ${before ? 'changed' : 'shared'} the payment details for ${inr(updated.totalAmount)}:\n${lines.join('\n')}`
      + '\nAccounts: this is the account the customer was told to pay into — check it is ours.',
      { key: `salespaydetails-${idOf(updated._id)}-${details.setAt.getTime()}`, orderIds: [idOf(updated._id)] });
  } catch (err) {
    console.error('[SalesPayDetails] chat update failed (ignored):', err.message);
  }
  return getSalesOrder(actor, idOf(order._id));
}

/** The saved QR image's bytes, for the seller's screen and the PDF. */
export async function readPayDetailsQr(actor, orderId) {
  if (!canSell(actor)) throw fail('Not authorized.', 403);
  await getSalesOrder(actor, orderId); // 404s an order this person may not see
  const order = await orderRepository.findById(orderId);
  const qr = order?.salesPayDetails?.qr;
  if (!qr?.publicId) throw fail('No QR saved on this order.', 404);
  return { buffer: await readPrivateAsset(qr), contentType: qr.contentType || 'image/jpeg' };
}

export default { setPayDetails, readPayDetailsQr };
