import crypto from 'crypto';
import mongoose from 'mongoose';
import sharp from 'sharp';
import AppError from '../../utils/AppError.js';
import { checkAttachments } from '../storage/attachmentCheck.js';
import { slipReaderConfig, SLIP_TOKEN_TTL_MS } from '../../config/slipReader.js';
import { extractSlipFields, SlipReadError } from './anthropicSlipClient.js';
import bankTransferRepository from '../../repositories/bankTransferRepository.js';
import paymentRequestRepository from '../../repositories/paymentRequestRepository.js';
import supplierLedgerRepository from '../../repositories/supplierLedgerRepository.js';

/**
 * Reads a payment slip (screenshot, photo or PDF) and SUGGESTS the transaction
 * ID / UTR, date & time, amount, payer, payee and app or bank, for a person to
 * check before saving. It never saves, approves or changes anything.
 *
 *   readSlip()       — called when a slip is attached, before the form is saved.
 *                      Returns suggestions, warnings and a signed token of what
 *                      was read. A failed read is a normal answer, never an error:
 *                      the form simply stays open for typing.
 *   slipProvenance() — called by each save path with that token: works out, per
 *                      field, whether the saved value is what the slip said or
 *                      what a person typed / changed. The browser cannot fake it.
 *
 * Slip contents and the values read are never logged.
 */

const fail = (message, status = 400) => new AppError(message, status);
const TOKEN_LABEL = 'slip-read:v1';
// Claude reads images best at ≤1568 px on the long side; larger only costs more.
const MAX_IMAGE_EDGE = 1568;

const idOf = (v) => (v?._id ?? v)?.toString?.() ?? '';
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const str = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const paise = (n) => Math.round(Number(n) * 100);

/** A UTR / reference as typed → the form it is compared on (upper case, no spaces or dashes). */
export const referenceKey = (raw) => String(raw ?? '').toUpperCase().replace(/[\s\-/]/g, '');

// ── Cleaning what was read ──────────────────────────────────────────────────

function cleanReference(raw) {
  const reference = str(raw, 40);
  return /^[A-Z0-9]{6,30}$/.test(referenceKey(reference)) ? reference : '';
}

function cleanDate(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(raw, 10));
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCDate() === +m[3] && d.getUTCMonth() === +m[2] - 1 ? m[0] : '';
}

/** 'HH:MM' (24 h). A 12-hour '9:07 PM' is converted, never misread as morning. */
function cleanTime(raw) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i.exec(str(raw, 12));
  if (!m) return '';
  let h = +m[1];
  const half = m[3]?.[0]?.toLowerCase();
  if (half && (h < 1 || h > 12)) return '';
  if (half === 'p' && h < 12) h += 12;
  if (half === 'a' && h === 12) h = 0;
  if (h > 23 || +m[2] > 59) return '';
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

const cleanAmount = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1e10 ? Math.round(n * 100) / 100 : null;
};

/** IST wall-clock date + time on the slip → an instant. */
export const istInstant = (date, time) => (date ? new Date(`${date}T${time || '00:00'}:00+05:30`) : null);

/** An instant → its IST 'YYYY-MM-DD' and 'HH:MM'. */
export function istParts(at) {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  const ist = new Date(d.getTime() + 330 * 60 * 1000).toISOString();
  return { date: ist.slice(0, 10), time: ist.slice(11, 16) };
}

// ── Duplicate UTR ───────────────────────────────────────────────────────────

/**
 * Is this reference already on another payment? Bank transfers compare on the
 * stored key (indexed, unique while active); payments and supplier refunds store
 * it as typed, so the common spellings are matched exactly.
 *
 * @returns {Promise<string>} where it is used, e.g. "order AB-1234" — '' when nowhere
 */
export async function findReferenceUse(reference, { excludeId } = {}) {
  const key = referenceKey(reference);
  if (!key) return '';
  const spellings = [...new Set([str(reference, 120), key, key.toLowerCase()])].filter(Boolean);
  const self = excludeId && mongoose.isValidObjectId(excludeId) ? new mongoose.Types.ObjectId(excludeId) : null;
  const [transfer, payment, refund] = await Promise.all([
    bankTransferRepository.findActiveByReference(key, self),
    paymentRequestRepository.findPaidByReference(spellings, self),
    supplierLedgerRepository.findLiveByReference(spellings, self),
  ]);
  if (transfer) return `the bank transfer for order ${transfer.orderNumber}`;
  if (payment) return `payment ${payment.number}`;
  if (refund) return `a supplier refund${refund.paymentRequestNumber ? ` on ${refund.paymentRequestNumber}` : ''}${refund.supplierName ? ` (${refund.supplierName})` : ''}`;
  return '';
}

// ── Signed token of what was read ───────────────────────────────────────────

const hmac = (secret, body) => crypto.createHmac('sha256', secret).update(`${TOKEN_LABEL}.${body}`).digest('base64url');

export function signReadToken(payload) {
  const { signingSecret } = slipReaderConfig();
  if (!signingSecret) return '';
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(signingSecret, body)}`;
}

/** @returns {object|null} the payload, or null when forged, expired or malformed */
export function verifyReadToken(token, now = Date.now()) {
  const { signingSecret } = slipReaderConfig();
  if (!signingSecret || typeof token !== 'string' || token.length > 4000) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(hmac(signingSecret, body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload?.v !== 1 || typeof payload.at !== 'number' || now - payload.at > SLIP_TOKEN_TTL_MS || payload.at > now + 60_000) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Read ────────────────────────────────────────────────────────────────────

async function prepare(checked) {
  if (checked.contentType === 'application/pdf') {
    return { data: checked.file.buffer.toString('base64'), mediaType: 'application/pdf', isPdf: true };
  }
  // Upright (phone EXIF), no bigger than the model uses, and well under the API's image limit.
  const jpeg = await sharp(checked.file.buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { data: jpeg.toString('base64'), mediaType: 'image/jpeg', isPdf: false };
}

const READ_FAILED = Object.freeze({
  timeout: 'Reading the slip took too long — please type the details.',
  unavailable: 'Could not read the slip just now — please type the details.',
  config: 'Slip reading is not set up correctly — please type the details.',
  refused: 'Could not read this slip — please type the details.',
  bad_output: 'Could not read this slip — please type the details.',
  bad_image: 'Could not open this picture to read it — please type the details.',
});

/**
 * @param {object} actor the signed-in staff member
 * @param {object} file multer file (field `slip`)
 * @param {{ expectedAmount?: number|string, excludeId?: string }} [context]
 *   expectedAmount — what this payment should be, in rupees (warns on a mismatch)
 *   excludeId      — the record being edited, so its own UTR is not a "duplicate"
 */
export async function readSlip(actor, file, { expectedAmount, excludeId } = {}) {
  const cfg = slipReaderConfig();
  if (!cfg.enabled) return { status: 'off' };
  if (!file?.buffer?.length) throw fail('Attach the slip to read.');
  const [checked] = checkAttachments([file], { max: 1, noun: 'slip' });

  let raw;
  try {
    raw = await extractSlipFields({ ...(await prepare(checked).catch(() => { throw new SlipReadError('bad_image'); })), model: cfg.model, timeoutMs: cfg.timeoutMs });
  } catch (err) {
    const reason = err instanceof SlipReadError ? err.reason : 'unavailable';
    if (!(err instanceof SlipReadError)) console.error('[SlipReader] unexpected failure:', err?.name || 'Error');
    return { status: 'failed', reason, message: READ_FAILED[reason] || READ_FAILED.unavailable };
  }

  const date = cleanDate(raw.date);
  const time = date ? cleanTime(raw.time) : '';
  const fields = {
    reference: cleanReference(raw.reference),
    referenceLabel: str(raw.referenceLabel, 40),
    otherReferences: (Array.isArray(raw.otherReferences) ? raw.otherReferences : []).map((r) => str(r, 60)).filter(Boolean).slice(0, 5),
    amount: cleanAmount(raw.amount),
    date,
    time,
    transactionAt: date ? istInstant(date, time).toISOString() : '',
    paymentStatus: ['success', 'failed', 'pending'].includes(raw.paymentStatus) ? raw.paymentStatus : 'unknown',
    payerName: str(raw.payerName, 80),
    payeeName: str(raw.payeeName, 80),
    payeeAccount: str(raw.payeeAccount, 80),
    appOrBank: str(raw.appOrBank, 60),
  };
  const found = Boolean(fields.reference || fields.amount || fields.date);
  if (raw.readable === false || !found) {
    return { status: 'unreadable', message: 'Could not read the details on this slip — please type them.' };
  }

  const warnings = [];
  if (fields.paymentStatus === 'failed' || fields.paymentStatus === 'pending') {
    warnings.push({ code: 'not_successful', message: `The slip says the payment is ${fields.paymentStatus.toUpperCase()} — check that the money really went through.` });
  }
  const expected = cleanAmount(expectedAmount);
  if (expected && fields.amount && paise(expected) !== paise(fields.amount)) {
    warnings.push({ code: 'amount_mismatch', message: `The slip shows ${inr(fields.amount)}, but this payment is ${inr(expected)}. Check the slip before saving.` });
  }
  if (fields.reference) {
    const usedOn = await findReferenceUse(fields.reference, { excludeId });
    if (usedOn) warnings.push({ code: 'duplicate_reference', message: `This UTR / reference is already used on ${usedOn}. Check you have the right slip.` });
  }

  const token = signReadToken({
    v: 1,
    u: idOf(actor?._id),
    at: Date.now(),
    m: raw.model || cfg.model,
    h: sha256(file.buffer),
    f: { reference: fields.reference, date, time, amount: fields.amount },
  });
  return { status: 'read', fields, warnings, token };
}

// ── On save: which fields came from the slip ────────────────────────────────

const sameDay = (a, b) => Boolean(a && b) && a === b;

/**
 * @param {object} actor who is saving
 * @param {string} token `slipRead` sent with the form (what readSlip returned)
 * @param {object} saved what is being saved; leave a field out when the form has no such field
 * @param {object[]} saved.files multer files being uploaded — the slip read must be one of them
 * @param {string}  [saved.reference]
 * @param {string|Date} [saved.date] a day ('YYYY-MM-DD' or a Date at IST midnight / UTC midnight)
 * @param {Date}    [saved.transactionAt] a day and time
 * @param {number}  [saved.amount] rupees
 * @returns {null | { readAt: Date, model: string, fields: object }} null = no valid read for this save
 */
export function slipProvenance(actor, token, { files = [], reference, date, transactionAt, amount } = {}) {
  if (!token) return null;
  const read = verifyReadToken(token);
  if (!read || read.u !== idOf(actor?._id)) return null;
  // The slip that was read must be one of the files being saved, not some other picture.
  const hashes = new Set((Array.isArray(files) ? files : [files]).filter((f) => f?.buffer?.length).map((f) => sha256(f.buffer)));
  if (!hashes.has(read.h)) return null;

  const f = read.f || {};
  const source = (fromSlip, same) => {
    if (!fromSlip) return 'typed';
    return same ? 'slip' : 'edited';
  };
  const fields = {};
  if (reference !== undefined) fields.reference = source(f.reference, referenceKey(f.reference) === referenceKey(reference));
  if (transactionAt !== undefined && transactionAt !== null) {
    const at = istParts(transactionAt);
    fields.date = source(f.date, sameDay(f.date, at.date) && (!f.time || f.time === at.time));
  } else if (date !== undefined && date !== null) {
    const day = typeof date === 'string' ? date.slice(0, 10) : new Date(date).toISOString().slice(0, 10);
    fields.date = source(f.date, sameDay(f.date, day));
  }
  if (amount !== undefined && amount !== null) fields.amount = source(f.amount, paise(f.amount) === paise(amount));
  return { readAt: new Date(read.at), model: String(read.m || '').slice(0, 60), fields };
}

/**
 * A field that was saved as read from the slip is corrected later: it is now a
 * person's value. Adds the `$set` for that to `set` (a Mongo update object).
 */
export function markEdited(slipRead, set, field, path = 'slipRead') {
  if (slipRead?.fields?.[field] === 'slip') set[`${path}.fields.${field}`] = 'edited';
}

export default { markEdited, readSlip, slipProvenance, findReferenceUse, signReadToken, verifyReadToken };
