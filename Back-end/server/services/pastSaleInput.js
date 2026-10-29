/**
 * Past (offline) sales — reading and checking what people type or upload.
 * Pure functions only (no database), so every rule here is unit-tested directly.
 *
 * One cleaner serves both ways in: the form sends canonical values, a sheet sends
 * whatever the salesman wrote ("14/03/2024", "₹6,500", "GPay"). Both go through
 * cleanSale(), so a rule can never differ between the form and the upload.
 *
 * Money is taken exactly as written on the bill (rounded to paise) — never
 * recomputed. Items − discount ≠ total is a WARNING, not an error: old bills are
 * not always exact, and refusing them would leave them out of the record.
 */
import crypto from 'crypto';
import { parse } from 'csv-parse/sync';
import AppError from '../utils/AppError.js';
import { normalizePhone, normalizeEmail } from '../utils/identity.js';
import { validateGstin } from '../utils/gstin.js';
import { PAST_SALE_CHANNELS, PAST_SALE_PAYMENT_METHODS } from '../config/pastSale.js';

export const MAX_ITEMS = 100;
export const MAX_QUANTITY = 10000;
export const MAX_UNIT_PRICE = 10_000_000;
export const MAX_TOTAL = 100_000_000;
export const MISMATCH_TOLERANCE = 1; // rupees
export const EARLIEST_SALE = '2000-01-01';
export const MAX_UPLOAD_ROWS = 2000;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const str = (v) => (v == null ? '' : String(v).trim());
const round2 = (n) => Math.round(n * 100) / 100;

// ── Small parsers ───────────────────────────────────────────────────────────

/** Today's calendar date in India as 'YYYY-MM-DD'. */
export const istToday = (now = Date.now()) => new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);

const ymdOf = (y, m, d) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
};
const fullYear = (y) => (y < 100 ? 2000 + y : y);

/**
 * A sale date as written → 'YYYY-MM-DD', or null. Indian order (day first) for
 * numeric dates: 14/03/2024, 14-03-24, 14.03.2024. Also 2024-03-14 and
 * 14 Mar 2024 / 14-Mar-24 / Mar 14, 2024.
 */
export function parseSaleDate(raw) {
  const s = str(raw).toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return ymdOf(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) return ymdOf(fullYear(Number(m[3])), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[\s-]([a-z]{3,9})[\s-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3)) + 1;
    return month ? ymdOf(fullYear(Number(m[3])), month, Number(m[1])) : null;
  }
  m = /^([a-z]{3,9}) (\d{1,2}) (\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3)) + 1;
    return month ? ymdOf(Number(m[3]), month, Number(m[2])) : null;
  }
  return null;
}

/** "₹6,500.00" / "Rs. 6500" / 6500 → 6500. Blank → null. Anything else → NaN. */
export function parseAmount(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  const s = str(raw).replace(/₹|rs\.?|inr|,|\s/gi, '');
  if (!s) return null;
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

const PAYMENT_ALIASES = {
  cash: 'cash',
  upi: 'upi', gpay: 'upi', googlepay: 'upi', phonepe: 'upi', paytm: 'upi', bhim: 'upi',
  card: 'card', creditcard: 'card', debitcard: 'card', credit: 'card', debit: 'card', pos: 'card', swipe: 'card',
  banktransfer: 'bank_transfer', bank: 'bank_transfer', neft: 'bank_transfer', rtgs: 'bank_transfer', imps: 'bank_transfer', netbanking: 'bank_transfer',
  cheque: 'cheque', check: 'cheque', chq: 'cheque',
  other: 'other', others: 'other',
};
const CHANNEL_ALIASES = {
  store: 'store', shop: 'store', showroom: 'store', walkin: 'store', counter: 'store', instore: 'store',
  phone: 'phone', call: 'phone', telephone: 'phone', phonecall: 'phone',
  whatsapp: 'whatsapp', wa: 'whatsapp',
  homevisit: 'home_visit', home: 'home_visit', visit: 'home_visit', doorstep: 'home_visit',
  event: 'event', expo: 'event', exhibition: 'event', stall: 'event',
  other: 'other', others: 'other',
};
const aliasKey = (v) => str(v).toLowerCase().replace(/[^a-z]/g, '');

/** "GPay" → 'upi'. Blank → null. Unknown → undefined. */
export const parsePaymentMethod = (raw) => {
  if (!str(raw)) return null;
  if (PAST_SALE_PAYMENT_METHODS.includes(raw)) return raw;
  return PAYMENT_ALIASES[aliasKey(raw)];
};
/** "Walk-in" → 'store'. Blank → null. Unknown → undefined. */
export const parseChannel = (raw) => {
  if (!str(raw)) return null;
  if (PAST_SALE_CHANNELS.includes(raw)) return raw;
  return CHANNEL_ALIASES[aliasKey(raw)];
};

/** The bill number as compared: upper-case, no spaces, dashes or slashes. */
export const invoiceKeyOf = (raw) => str(raw).toUpperCase().replace(/[\s\-/\\._#]/g, '');

/**
 * What makes two entries "the same sale". Bill number included, so two real
 * bills with identical contents but different numbers never collide.
 */
export function fingerprintOf(s, salesUserId) {
  const basis = JSON.stringify([
    salesUserId ? String(salesUserId) : '',
    s.saleDate,
    s.invoiceKey || '',
    s.customer.phoneKey || '',
    s.customer.name.toLowerCase().replace(/\s+/g, ' '),
    Math.round(s.totalAmount * 100),
    s.items.map((i) => [i.name.toLowerCase().replace(/\s+/g, ' '), i.quantity, Math.round(i.price * 100)]),
  ]);
  return crypto.createHash('sha256').update(basis).digest('hex').slice(0, 40);
}

// ── One sale ────────────────────────────────────────────────────────────────

const PAYMENT_LABELS = 'Cash, UPI, Card, Bank transfer, Cheque or Other';
const CHANNEL_LABELS = 'Store, Phone, WhatsApp, Home visit, Event or Other';

/**
 * Check and normalise one sale.
 *
 * @param {Object} raw  { saleDate, invoiceNo?, customer:{name,phone?,email?,city?,state?},
 *   business?:{legalName?,gstin?}, vehicle?, channel?, items:[{product?,name,quantity,price}],
 *   discount?, gstAmount?, totalAmount, paymentMethod, notes? }
 * @returns {{ value: Object|null, errors: string[], warnings: string[] }}
 */
export function cleanSale(raw = {}, { now = Date.now() } = {}) {
  const errors = [];
  const warnings = [];
  const customerIn = raw.customer || {};

  // Date
  const saleDate = parseSaleDate(raw.saleDate);
  if (!str(raw.saleDate)) errors.push('Enter the sale date.');
  else if (!saleDate) errors.push(`"${str(raw.saleDate).slice(0, 20)}" is not a date — write it like 14/03/2024.`);
  else if (saleDate > istToday(now)) errors.push('The sale date cannot be in the future.');
  else if (saleDate < EARLIEST_SALE) errors.push('The sale date is too old — check the year.');

  // Bill number
  const invoiceNo = str(raw.invoiceNo).slice(0, 61);
  const invoiceKey = invoiceKeyOf(invoiceNo);
  if (invoiceNo && invoiceNo.length > 60) errors.push('The bill number is too long (60 characters at most).');
  if (invoiceNo && !invoiceKey) errors.push('The bill number has no letters or digits.');

  // Customer
  const name = str(customerIn.name).replace(/\s+/g, ' ');
  if (!name) errors.push('Enter the customer name.');
  else if (name.length > 120) errors.push('The customer name is too long.');
  const phone = str(customerIn.phone);
  const phoneKey = phone ? normalizePhone(phone) : null;
  if (phone && !phoneKey) errors.push(`The phone number "${phone.slice(0, 20)}" looks wrong.`);
  if (phone.length > 20) errors.push('The phone number is too long.');
  const email = normalizeEmail(str(customerIn.email)) || '';
  if (email && (!EMAIL_RE.test(email) || email.length > 254)) errors.push(`The email "${email.slice(0, 40)}" looks wrong.`);
  const city = str(customerIn.city).slice(0, 80);
  const state = str(customerIn.state).slice(0, 80);

  // Business buyer
  const legalName = str(raw.business?.legalName).slice(0, 160);
  const gstinRaw = str(raw.business?.gstin);
  let business;
  if (gstinRaw) {
    const g = validateGstin(gstinRaw);
    if (!g.valid) errors.push(g.message.replace('for an enterprise purchase', ''));
    else business = { legalName: legalName || undefined, gstin: g.gstin };
  } else if (legalName) {
    business = { legalName };
  }

  // Items
  const itemsIn = Array.isArray(raw.items) ? raw.items : [];
  if (!itemsIn.length) errors.push('Add at least one item.');
  if (itemsIn.length > MAX_ITEMS) errors.push(`At most ${MAX_ITEMS} items in one sale.`);
  const items = [];
  itemsIn.slice(0, MAX_ITEMS).forEach((it, i) => {
    const label = itemsIn.length > 1 ? `Item ${i + 1}: ` : '';
    const itemName = str(it?.name).replace(/\s+/g, ' ');
    const quantity = parseAmount(it?.quantity);
    const price = parseAmount(it?.price);
    const product = str(it?.product) || null;
    let ok = true;
    if (!itemName) { errors.push(`${label}enter the item name.`); ok = false; } else if (itemName.length > 200) { errors.push(`${label}the item name is too long.`); ok = false; }
    if (quantity == null) { errors.push(`${label}enter the quantity.`); ok = false; } else if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) { errors.push(`${label}the quantity must be a whole number from 1 to ${MAX_QUANTITY}.`); ok = false; }
    if (price == null) { errors.push(`${label}enter the price.`); ok = false; } else if (!Number.isFinite(price) || price < 0 || price > MAX_UNIT_PRICE) { errors.push(`${label}the price is not a valid amount.`); ok = false; }
    if (product && !/^[a-f0-9]{24}$/i.test(product)) { errors.push(`${label}the linked product is not valid.`); ok = false; }
    if (ok) items.push({ product, name: itemName, quantity, price: round2(price) });
  });

  // Money
  const total = parseAmount(raw.totalAmount);
  if (total == null) errors.push('Enter the total amount paid.');
  else if (!Number.isFinite(total) || total <= 0 || total > MAX_TOTAL) errors.push('The total paid must be an amount above ₹0.');
  const discount = parseAmount(raw.discount);
  if (discount != null && (!Number.isFinite(discount) || discount < 0 || discount > MAX_TOTAL)) errors.push('The discount is not a valid amount.');
  const gst = parseAmount(raw.gstAmount);
  if (gst != null && (!Number.isFinite(gst) || gst < 0)) errors.push('The GST amount is not a valid amount.');
  else if (gst != null && Number.isFinite(total) && gst > total) errors.push('The GST amount cannot be more than the total.');

  // Payment, channel, free text
  const paymentMethod = parsePaymentMethod(raw.paymentMethod);
  if (paymentMethod === null) errors.push('Choose how the customer paid.');
  else if (!paymentMethod) errors.push(`"${str(raw.paymentMethod).slice(0, 20)}" is not a payment method — use ${PAYMENT_LABELS}.`);
  const channel = parseChannel(raw.channel);
  if (channel === undefined) errors.push(`"${str(raw.channel).slice(0, 20)}" is not a place of sale — use ${CHANNEL_LABELS}.`);
  const vehicle = str(raw.vehicle);
  if (vehicle.length > 120) errors.push('The car is too long (120 characters at most).');
  const notes = str(raw.notes);
  if (notes.length > 1000) errors.push('The notes are too long (1000 characters at most).');

  if (errors.length) return { value: null, errors, warnings };

  const itemsTotal = round2(items.reduce((s, i) => s + i.quantity * i.price, 0));
  const totalAmount = round2(total);
  const discountAmount = round2(discount || 0);
  const amountMismatch = Math.abs(itemsTotal - discountAmount - totalAmount) > MISMATCH_TOLERANCE;
  if (amountMismatch) {
    warnings.push(`Items (₹${itemsTotal.toLocaleString('en-IN')}) minus discount (₹${discountAmount.toLocaleString('en-IN')}) does not match the total paid (₹${totalAmount.toLocaleString('en-IN')}). Saved as written on the bill.`);
  }

  return {
    value: {
      saleDate,
      invoiceNo: invoiceNo || undefined,
      invoiceKey: invoiceKey || undefined,
      customer: {
        name,
        phone: phone || undefined,
        phoneKey: phoneKey || undefined,
        email: email || undefined,
        city: city || undefined,
        state: state || undefined,
      },
      business,
      vehicle: vehicle || undefined,
      channel: channel || undefined,
      items,
      itemsTotal,
      discount: discountAmount,
      gstAmount: gst == null ? undefined : round2(gst),
      totalAmount,
      amountMismatch,
      paymentMethod,
      notes: notes || undefined,
    },
    errors,
    warnings,
  };
}

// ── The spreadsheet ─────────────────────────────────────────────────────────

/** Template columns, in order. Header matching ignores case, spaces and punctuation. */
export const TEMPLATE_COLUMNS = Object.freeze([
  'Sale date', 'Bill no', 'Customer name', 'Customer phone', 'Customer email', 'City', 'State',
  'Car', 'Where sold', 'Item', 'Quantity', 'Price per unit', 'Discount', 'GST amount',
  'Total paid', 'Payment method', 'Company name', 'GSTIN', 'Notes',
]);

const HEADER_ALIASES = {
  saleDate: ['saledate', 'date', 'billdate', 'invoicedate'],
  invoiceNo: ['billno', 'billnumber', 'invoiceno', 'invoicenumber', 'invoice', 'bill'],
  name: ['customername', 'customer', 'name'],
  phone: ['customerphone', 'phone', 'mobile', 'phonenumber', 'mobilenumber', 'contact'],
  email: ['customeremail', 'email', 'emailid'],
  city: ['city', 'town'],
  state: ['state'],
  vehicle: ['car', 'vehicle', 'carmodel'],
  channel: ['wheresold', 'saletype', 'channel', 'source'],
  item: ['item', 'itemname', 'product', 'productname', 'description'],
  quantity: ['quantity', 'qty'],
  price: ['priceperunit', 'price', 'unitprice', 'rate', 'mrp'],
  discount: ['discount'],
  gstAmount: ['gstamount', 'gst', 'tax', 'taxamount'],
  totalAmount: ['totalpaid', 'total', 'totalamount', 'amountpaid', 'amount', 'billamount', 'grandtotal'],
  paymentMethod: ['paymentmethod', 'payment', 'paymentmode', 'mode', 'paidby'],
  legalName: ['companyname', 'company', 'businessname', 'firmname'],
  gstin: ['gstin', 'gstno', 'gstnumber'],
  notes: ['notes', 'note', 'remarks', 'remark', 'comments'],
};
const HEADER_LOOKUP = Object.fromEntries(
  Object.entries(HEADER_ALIASES).flatMap(([field, names]) => names.map((n) => [n, field])),
);
const REQUIRED_COLUMNS = { saleDate: 'Sale date', name: 'Customer name', item: 'Item', quantity: 'Quantity', price: 'Price per unit', totalAmount: 'Total paid', paymentMethod: 'Payment method' };

/** The template as a CSV (header + one example row), for the download button. */
export function templateCsv() {
  const example = ['14/03/2024', 'AB/2024/0315', 'Arun Kumar', '9876543210', '', 'Kochi', 'Kerala',
    'Hyundai Creta 2022', 'Store', '7D floor mats', '1', '6500', '0', '991', '6500', 'UPI', '', '', 'Fitted at store'];
  return `${TEMPLATE_COLUMNS.join(',')}\n${example.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')}\n`;
}

const fail = (message) => new AppError(message, 400, { expose: true });

/**
 * CSV bytes → data rows keyed by field, with their sheet row numbers (header = 1).
 * Throws (400) for a file that cannot be read at all; per-row problems are left
 * to cleanSale so the preview can show them against the row.
 */
export function parseSheet(buffer) {
  if (!buffer?.length) throw fail('The file is empty.');
  if (buffer.length > MAX_UPLOAD_BYTES) throw fail('The file is too large (2 MB at most). Split it into smaller files.');
  let records;
  try {
    records = parse(buffer, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: true });
  } catch {
    throw fail('Could not read the file. In Excel, use File → Save As → "CSV UTF-8", then upload that.');
  }
  if (!records.length) throw fail('The file is empty.');
  const header = records[0].map((h) => HEADER_LOOKUP[String(h).toLowerCase().replace(/[^a-z]/g, '')] || null);
  const missing = Object.entries(REQUIRED_COLUMNS).filter(([f]) => !header.includes(f)).map(([, label]) => label);
  if (missing.length) throw fail(`These columns are missing: ${missing.join(', ')}. Download the template to see the column names.`);
  const body = records.slice(1);
  if (!body.length) throw fail('The file has the column names but no sales under them.');
  if (body.length > MAX_UPLOAD_ROWS) throw fail(`The file has ${body.length} rows; upload at most ${MAX_UPLOAD_ROWS} at a time.`);
  return body
    .map((cells, i) => {
      const row = { rowNumber: i + 2 };
      header.forEach((field, c) => { if (field && row[field] == null) row[field] = str(cells[c]); });
      return row;
    })
    .filter((row) => Object.entries(row).some(([k, v]) => k !== 'rowNumber' && v));
}

/**
 * Rows → sales. One row per item; rows with the same bill number make one sale.
 * Rows without a bill number join a sale only when date, customer and phone all
 * match the row above them (a multi-item cash bill written on consecutive lines).
 * Sale-level values (date, customer, total, payment…) come from the first row of
 * the group; a later row that disagrees on date or total is an error.
 */
export function groupRows(rows) {
  const sales = [];
  const byInvoice = new Map();
  let previous = null;
  for (const row of rows) {
    const key = invoiceKeyOf(row.invoiceNo);
    const looseKey = [row.saleDate, (row.name || '').toLowerCase(), normalizePhone(row.phone || '') || ''].join('|');
    let sale = key ? byInvoice.get(key) : (previous && !previous.invoiceKey && previous.looseKey === looseKey ? previous : null);
    if (!sale) {
      sale = {
        rows: [],
        invoiceKey: key || null,
        looseKey,
        conflicts: [],
        input: {
          saleDate: row.saleDate,
          invoiceNo: row.invoiceNo,
          customer: { name: row.name, phone: row.phone, email: row.email, city: row.city, state: row.state },
          business: { legalName: row.legalName, gstin: row.gstin },
          vehicle: row.vehicle,
          channel: row.channel,
          items: [],
          discount: row.discount,
          gstAmount: row.gstAmount,
          totalAmount: row.totalAmount,
          paymentMethod: row.paymentMethod,
          notes: row.notes,
        },
      };
      sales.push(sale);
      if (key) byInvoice.set(key, sale);
    } else {
      if (row.saleDate && row.saleDate !== sale.input.saleDate) sale.conflicts.push(`Row ${row.rowNumber} has a different date for the same bill.`);
      if (row.totalAmount && parseAmount(row.totalAmount) !== parseAmount(sale.input.totalAmount)) {
        sale.conflicts.push(`Row ${row.rowNumber} has a different total for the same bill — write the bill total on every row, or only on the first.`);
      }
    }
    sale.rows.push(row.rowNumber);
    sale.input.items.push({ name: row.item, quantity: row.quantity, price: row.price });
    previous = sale;
  }
  return sales;
}
