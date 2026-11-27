/**
 * Zoho Books invoice export → plain invoices, and the count-once matcher.
 * Pure functions (no DB) so every rule is unit-tested directly.
 *
 * Zoho's "Sales → Invoices → Export" CSV has one row per LINE ITEM; the invoice
 * fields repeat on every line. We group by "Invoice ID" and read the invoice
 * fields from the first line.
 */
import { parse } from 'csv-parse/sync';
import AppError from '../utils/AppError.js';
import {
  MATCH_TOLERANCE, ZOHO_EXCLUDED_STATUSES, ZOHO_IMPORT_MAX_INVOICES, ZOHO_PAYMENT_EXCLUDED_STATUSES,
} from '../config/companyRevenue.js';

const DAY_MS = 864e5;
const IST_OFFSET_MS = 5.5 * 3600e3;

const REQUIRED_COLUMNS = ['Invoice Date', 'Invoice ID', 'Invoice Number', 'Invoice Status', 'Total'];
const REFERENCE_COLUMNS = ['Reference#', 'Reference Number', 'PurchaseOrder'];
const PANEL_REF = /\bAB-?([0-9A-F]{8})\b/gi;

const str = (v) => (v == null ? '' : String(v).trim());

/** "1,23,456.70" / "₹ 1234" → 1234.7; blank → 0; anything else → NaN. */
export function parseMoney(raw) {
  const s = str(raw).replace(/[₹,\s]/g, '').replace(/^INR/i, '');
  if (s === '') return 0;
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/** "2026-09-15" or "15/09/2026" (Zoho India) → IST midnight of that day; else null. */
export function parseInvoiceDate(raw) {
  const s = str(raw);
  let y; let m; let d;
  let hit = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (hit) [, y, m, d] = hit;
  else if ((hit = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/))) [, d, m, y] = hit;
  else return null;
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d)) - IST_OFFSET_MS;
  const date = new Date(ms);
  // Reject roll-overs like 31/02 → 03/03.
  const back = new Date(ms + IST_OFFSET_MS);
  if (back.getUTCFullYear() !== Number(y) || back.getUTCMonth() !== Number(m) - 1 || back.getUTCDate() !== Number(d)) return null;
  return date;
}

const STOP_WORDS = new Set(['mr', 'mrs', 'ms', 'dr', 'm', 's', 'pvt', 'private', 'ltd', 'limited', 'llp', 'the', 'and', 'co', 'india', 'enterprises', 'traders', 'company']);

/** "M/s. Sharma Motors Pvt Ltd" → "sharma motors". Used only for matching. */
export function nameKey(raw) {
  return str(raw)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP_WORDS.has(t))
    .join(' ');
}

/** Two names agree when one contains the other, or they share a real word (3+ letters). */
export function namesAgree(a, b) {
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const words = new Set(a.split(' ').filter((t) => t.length >= 3));
  return b.split(' ').some((t) => t.length >= 3 && words.has(t));
}

/** The 8-char panel order code ("AB-1A2B3C4D") for an order id. */
export const panelRefOf = (orderId) => String(orderId).slice(-8).toUpperCase();

/**
 * Parse a Zoho invoice export.
 * @returns {{ invoices: object[], skipped: { draft: number, void: number }, errors: string[] }}
 */
export function readZohoCsv(buffer) {
  let rows;
  try {
    rows = parse(buffer, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true, trim: true });
  } catch (err) {
    throw new AppError(`That file is not a readable CSV (${err.code || 'parse error'}).`, 400, { expose: true });
  }
  if (!rows.length) throw new AppError('The file has no rows.', 400, { expose: true });
  return rows;
}

/** Which Zoho export this is: 'credit_notes', 'payments' or 'invoices' (the default, validated by its parser). */
export const zohoExportKind = (rows) => {
  if ('Credit Note Number' in rows[0]) return 'credit_notes';
  if ('CustomerPayment ID' in rows[0]) return 'payments';
  return 'invoices';
};

export function parseZohoInvoiceCsv(buffer, preRead) {
  const rows = preRead || readZohoCsv(buffer);
  const missing = REQUIRED_COLUMNS.filter((c) => !(c in rows[0]));
  if (missing.length) {
    throw new AppError(
      `This is not a Zoho invoice export — missing column(s): ${missing.join(', ')}. In Zoho Books use Sales → Invoices → Export.`,
      400,
      { expose: true }
    );
  }

  const byId = new Map();
  for (const row of rows) {
    const id = str(row['Invoice ID']);
    if (id && !byId.has(id)) byId.set(id, row);
  }
  if (byId.size > ZOHO_IMPORT_MAX_INVOICES) {
    throw new AppError(`Too many invoices in one file (${byId.size}). Export at most ${ZOHO_IMPORT_MAX_INVOICES} at a time.`, 400, { expose: true });
  }

  const invoices = [];
  const errors = [];
  const skipped = { draft: 0, void: 0 };
  for (const [id, row] of byId) {
    const number = str(row['Invoice Number']) || id;
    const status = str(row['Invoice Status']).toLowerCase();
    if (ZOHO_EXCLUDED_STATUSES.includes(status)) {
      skipped[status] += 1;
      continue;
    }
    const currency = str(row['Currency Code']).toUpperCase();
    if (currency && currency !== 'INR') { errors.push(`${number}: currency ${currency} is not INR — skipped.`); continue; }
    const invoiceDate = parseInvoiceDate(row['Invoice Date']);
    const total = parseMoney(row.Total);
    const subTotal = parseMoney(row.SubTotal ?? row['Sub Total']);
    const balance = parseMoney(row.Balance);
    if (!invoiceDate) { errors.push(`${number}: invoice date "${str(row['Invoice Date'])}" is not a date — skipped.`); continue; }
    if (!Number.isFinite(total) || total < 0) { errors.push(`${number}: total "${str(row.Total)}" is not an amount — skipped.`); continue; }

    const refs = REFERENCE_COLUMNS.map((c) => str(row[c])).filter(Boolean);
    const panelRefs = [...`${refs.join(' ')} ${str(row.Notes)}`.matchAll(PANEL_REF)].map((h) => `AB-${h[1].toUpperCase()}`);
    const customerName = str(row['Customer Name']).slice(0, 200);
    invoices.push({
      zohoInvoiceId: id.slice(0, 40),
      invoiceNumber: number.slice(0, 60),
      invoiceDate,
      status: status.slice(0, 30) || 'unknown',
      customerName,
      customerKey: nameKey(customerName).slice(0, 200),
      subTotal: Number.isFinite(subTotal) && subTotal >= 0 ? subTotal : total,
      total,
      balance: Number.isFinite(balance) && balance > 0 ? balance : 0,
      reference: [...new Set([...refs, ...panelRefs])].join(' ').slice(0, 200),
    });
  }
  return { invoices, skipped, errors };
}

const CREDIT_NOTE_COLUMNS = ['Credit Note Date', 'CreditNotes ID', 'Credit Note Number', 'Credit Note Status', 'Total'];

/**
 * Parse a Zoho credit-note export ("Sales → Credit Notes → Export"). One row per
 * line item, grouped by "CreditNotes ID". Draft / void notes are not refunds.
 */
export function parseZohoCreditNoteCsv(buffer, preRead) {
  const rows = preRead || readZohoCsv(buffer);
  const missing = CREDIT_NOTE_COLUMNS.filter((c) => !(c in rows[0]));
  if (missing.length) {
    throw new AppError(`This is not a Zoho credit note export — missing column(s): ${missing.join(', ')}.`, 400, { expose: true });
  }
  const byId = new Map();
  for (const row of rows) {
    const id = str(row['CreditNotes ID']);
    if (id && !byId.has(id)) byId.set(id, row);
  }
  if (byId.size > ZOHO_IMPORT_MAX_INVOICES) {
    throw new AppError(`Too many credit notes in one file (${byId.size}).`, 400, { expose: true });
  }
  const creditNotes = [];
  const errors = [];
  const skipped = { draft: 0, void: 0 };
  for (const [id, row] of byId) {
    const number = str(row['Credit Note Number']) || id;
    const status = str(row['Credit Note Status']).toLowerCase();
    if (ZOHO_EXCLUDED_STATUSES.includes(status)) { skipped[status] += 1; continue; }
    const currency = str(row['Currency Code']).toUpperCase();
    if (currency && currency !== 'INR') { errors.push(`${number}: currency ${currency} is not INR — skipped.`); continue; }
    const date = parseInvoiceDate(row['Credit Note Date']);
    const total = parseMoney(row.Total);
    const subTotal = parseMoney(row.SubTotal);
    if (!date) { errors.push(`${number}: date "${str(row['Credit Note Date'])}" is not a date — skipped.`); continue; }
    if (!Number.isFinite(total) || total < 0) { errors.push(`${number}: total "${str(row.Total)}" is not an amount — skipped.`); continue; }
    const invoiceNumber = str(row['Associated Invoice Number']) || str(row['Applied Invoice Number']);
    if (!invoiceNumber) errors.push(`${number}: no invoice number — kept, but it cannot reduce any bill.`);
    creditNotes.push({
      zohoCreditNoteId: id.slice(0, 40),
      creditNoteNumber: number.slice(0, 60),
      creditNoteDate: date,
      status: status.slice(0, 30) || 'unknown',
      invoiceNumber: invoiceNumber.slice(0, 60) || undefined,
      subTotal: Number.isFinite(subTotal) && subTotal >= 0 ? subTotal : total,
      total,
    });
  }
  return { creditNotes, skipped, errors };
}

const PAYMENT_COLUMNS = ['CustomerPayment ID', 'Payment Number', 'Date', 'Customer Name', 'Amount', 'Unused Amount'];

/**
 * Parse a Zoho "Payments Received → Export → Invoice Payments" CSV. One row per
 * invoice the payment was applied to; the payment fields (Amount, Unused Amount)
 * repeat on every row, so we group by "CustomerPayment ID".
 *
 * Returns every confirmed payment with its Unused Amount — including 0, so a
 * re-upload can zero out a payment that has since been applied to an invoice.
 */
export function parseZohoPaymentCsv(buffer, preRead) {
  const rows = preRead || readZohoCsv(buffer);
  const missing = PAYMENT_COLUMNS.filter((c) => !(c in rows[0]));
  if (missing.length) {
    throw new AppError(
      `This is not a Zoho payments export — missing column(s): ${missing.join(', ')}. In Zoho Books use Payments Received → ⋯ → Export → Invoice Payments.`,
      400,
      { expose: true }
    );
  }
  const byId = new Map();
  for (const row of rows) {
    const id = str(row['CustomerPayment ID']);
    if (id && !byId.has(id)) byId.set(id, row);
  }
  if (byId.size > ZOHO_IMPORT_MAX_INVOICES) {
    throw new AppError(`Too many payments in one file (${byId.size}). Export at most ${ZOHO_IMPORT_MAX_INVOICES} at a time.`, 400, { expose: true });
  }
  const payments = [];
  const errors = [];
  const skipped = { draft: 0, void: 0 };
  for (const [id, row] of byId) {
    const number = str(row['Payment Number']) || id;
    const status = str(row['Payment Status']).toLowerCase();
    if (ZOHO_PAYMENT_EXCLUDED_STATUSES.includes(status)) { skipped[status] += 1; continue; }
    const currency = str(row['Currency Code']).toUpperCase();
    if (currency && currency !== 'INR') { errors.push(`Payment ${number}: currency ${currency} is not INR — skipped.`); continue; }
    const receivedAt = parseInvoiceDate(row.Date);
    const amount = parseMoney(row.Amount);
    const unused = parseMoney(row['Unused Amount']);
    if (!receivedAt) { errors.push(`Payment ${number}: date "${str(row.Date)}" is not a date — skipped.`); continue; }
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(unused) || unused < 0) {
      errors.push(`Payment ${number}: amount is not a number — skipped.`);
      continue;
    }
    const customerName = str(row['Customer Name']).slice(0, 200) || 'Unknown customer';
    payments.push({
      zohoPaymentId: id.slice(0, 40),
      paymentNumber: number.slice(0, 60),
      zohoStatus: status.slice(0, 30) || 'paid',
      receivedAt,
      customerName,
      customerKey: nameKey(customerName).slice(0, 200),
      mode: str(row.Mode).slice(0, 60),
      reference: str(row['Reference Number']).slice(0, 200),
      paymentTotal: amount,
      // Zoho prints the unused part to 3 decimals; never more than the payment itself.
      amount: Math.min(Math.round(unused * 100) / 100, amount),
    });
  }
  return { payments, skipped, errors };
}

/** Razorpay payment ids ("pay_…") in a Zoho reference — the website order it is. */
export const razorpayIdsIn = (reference) => [...str(reference).matchAll(/\bpay_[A-Za-z0-9]{8,30}\b/g)].map((m) => m[0]);

/**
 * The count-once matcher. Decides, for every invoice an admin has not decided,
 * whether it is a panel order already counted.
 *
 * @param {object[]} invoices  { key, invoiceDate, total, customerKey, reference, adminOrderId?, adminDecided? }
 * @param {object[]} orders    { id, createdAt, totalAmount, nameKey } — counted panel orders
 * @returns {Map<string, { state, orderId, reason }>} by invoice key (admin-decided invoices omitted)
 */
export function matchInvoicesToOrders(invoices, orders) {
  const T = MATCH_TOLERANCE;
  const result = new Map();
  const claimed = new Set(invoices.filter((i) => i.adminDecided && i.adminOrderId).map((i) => String(i.adminOrderId)));
  const byRef = new Map(orders.map((o) => [`AB-${panelRefOf(o.id)}`, o]));
  const open = invoices.filter((i) => !i.adminDecided);

  // 1. The invoice names the panel order — certain.
  for (const inv of open) {
    const hit = (inv.reference || '').match(/AB-[0-9A-F]{8}/g)?.map((r) => byRef.get(r)).find((o) => o && !claimed.has(String(o.id)));
    if (hit) {
      claimed.add(String(hit.id));
      result.set(inv.key, { state: 'linked', orderId: hit.id, reason: 'Panel order number on the Zoho invoice' });
    }
  }

  // 2. Score every remaining invoice against nearby orders (orders sorted by date → a window scan).
  const sorted = [...orders].sort((a, b) => a.createdAt - b.createdAt);
  const pairs = [];
  for (const inv of open) {
    if (result.has(inv.key)) continue;
    const from = inv.invoiceDate.getTime() - T.possibleDays * DAY_MS;
    const to = inv.invoiceDate.getTime() + T.possibleDays * DAY_MS;
    for (const o of sorted) {
      const t = o.createdAt.getTime();
      if (t < from) continue;
      if (t > to) break;
      const days = Math.abs(t - inv.invoiceDate.getTime()) / DAY_MS;
      const diff = Math.abs(o.totalAmount - inv.total);
      const name = namesAgree(inv.customerKey, o.nameKey);
      const sure = name && diff <= T.sureAmountRupees && days <= T.sureDays;
      const possible = sure
        || (name && diff <= Math.max(T.sureAmountRupees, T.possibleAmountRatio * Math.max(o.totalAmount, inv.total)))
        || (name && inv.total <= o.totalAmount + T.sureAmountRupees) // part of the order billed
        || (diff <= T.sureAmountRupees && days <= T.sameAmountDays);
      if (possible) pairs.push({ inv, o, sure, days, diff, name });
    }
  }

  // 3. Sure pairs, best first; one order per invoice and one invoice per order.
  pairs.sort((a, b) => (b.sure - a.sure) || (a.diff - b.diff) || (a.days - b.days));
  for (const p of pairs) {
    if (!p.sure || result.has(p.inv.key) || claimed.has(String(p.o.id))) continue;
    claimed.add(String(p.o.id));
    result.set(p.inv.key, { state: 'linked', orderId: p.o.id, reason: 'Same customer, amount and date as a panel order' });
  }

  // 4. Anything that only MIGHT be a panel order is held back (never counted on a guess).
  for (const p of pairs) {
    if (result.has(p.inv.key)) continue;
    const why = !p.name ? 'Same amount and date as a panel order, different name'
      : p.inv.total < p.o.totalAmount - T.sureAmountRupees ? 'Same customer, smaller than a panel order (part billed?)'
        : 'Same customer, close amount and date to a panel order';
    result.set(p.inv.key, { state: 'needs_check', orderId: p.o.id, reason: why });
  }

  for (const inv of open) {
    if (!result.has(inv.key)) result.set(inv.key, { state: 'zoho_only', orderId: null, reason: 'No panel order like it' });
  }
  return result;
}
