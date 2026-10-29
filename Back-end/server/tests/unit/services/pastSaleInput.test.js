/**
 * Past (offline) sales — the pure reading / checking rules (services/pastSaleInput.js).
 * The same cleaner serves the form and the spreadsheet, so these are the rules for both.
 */
import {
  parseSaleDate, parseAmount, parsePaymentMethod, parseChannel, invoiceKeyOf, fingerprintOf,
  cleanSale, parseSheet, groupRows, templateCsv, istToday, MAX_UPLOAD_ROWS,
} from '../../../services/pastSaleInput.js';

const NOW = Date.parse('2026-10-29T06:00:00Z');
const sale = (over = {}) => ({
  saleDate: '14/03/2024',
  invoiceNo: 'AB/2024/0315',
  customer: { name: 'Arun Kumar', phone: '+91 98765 43210', email: 'Arun@Example.com', city: 'Kochi', state: 'Kerala' },
  items: [{ name: '7D floor mats', quantity: 1, price: 6500 }],
  discount: 0,
  gstAmount: 991,
  totalAmount: 6500,
  paymentMethod: 'UPI',
  channel: 'Store',
  ...over,
});
const csv = (lines) => Buffer.from(lines.join('\n'));
const HEADER = 'Sale date,Bill no,Customer name,Customer phone,Item,Quantity,Price per unit,Discount,Total paid,Payment method';

describe('parseSaleDate', () => {
  it.each([
    ['14/03/2024', '2024-03-14'], ['14-03-24', '2024-03-14'], ['4.3.2024', '2024-03-04'],
    ['2024-03-14', '2024-03-14'], ['14 Mar 2024', '2024-03-14'], ['14-Mar-24', '2024-03-14'],
    ['March 14, 2024', '2024-03-14'], ['29/02/2024', '2024-02-29'],
  ])('%s → %s (day first, as written in India)', (raw, out) => {
    expect(parseSaleDate(raw)).toBe(out);
  });
  it.each(['', '31/02/2024', '29/02/2023', '13/13/2024', 'yesterday', '2024/03/14x', '14 Foo 2024'])('rejects %p', (raw) => {
    expect(parseSaleDate(raw)).toBeNull();
  });
});

describe('parseAmount', () => {
  it('reads rupees as written on a bill', () => {
    expect(parseAmount('₹6,500.00')).toBe(6500);
    expect(parseAmount('Rs. 1,23,456')).toBe(123456);
    expect(parseAmount('INR 99.5')).toBe(99.5);
    expect(parseAmount(42)).toBe(42);
  });
  it('blank is "not given", junk is NaN (an error, never a silent zero)', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount('six thousand')).toBeNaN();
    expect(parseAmount('12.3.4')).toBeNaN();
  });
});

describe('payment method and place of sale', () => {
  it('understands what salesmen write', () => {
    expect(['GPay', 'phonepe', 'UPI', 'Paytm'].map(parsePaymentMethod)).toEqual(['upi', 'upi', 'upi', 'upi']);
    expect(['NEFT', 'Bank transfer', 'bank_transfer'].map(parsePaymentMethod)).toEqual(['bank_transfer', 'bank_transfer', 'bank_transfer']);
    expect(['Credit card', 'swipe'].map(parsePaymentMethod)).toEqual(['card', 'card']);
    expect(parsePaymentMethod('Cheque')).toBe('cheque');
    expect(['Walk-in', 'Showroom', 'Home visit', 'home_visit', 'WhatsApp'].map(parseChannel))
      .toEqual(['store', 'store', 'home_visit', 'home_visit', 'whatsapp']);
  });
  it('blank → null, unknown → undefined', () => {
    expect(parsePaymentMethod('')).toBeNull();
    expect(parsePaymentMethod('barter')).toBeUndefined();
    expect(parseChannel('')).toBeNull();
    expect(parseChannel('mars')).toBeUndefined();
  });
});

describe('invoiceKeyOf', () => {
  it('compares bill numbers however they were typed', () => {
    expect(invoiceKeyOf('ab/2024/0315')).toBe(invoiceKeyOf(' AB-2024-0315 '));
    expect(invoiceKeyOf('AB 2024 0315')).toBe('AB20240315');
  });
});

describe('cleanSale', () => {
  it('normalises a good sale and keeps the money exactly as written', () => {
    const { value, errors, warnings } = cleanSale(sale(), { now: NOW });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(value).toMatchObject({
      saleDate: '2024-03-14',
      invoiceNo: 'AB/2024/0315',
      invoiceKey: 'AB20240315',
      customer: { name: 'Arun Kumar', phone: '+91 98765 43210', phoneKey: '9876543210', email: 'arun@example.com' },
      items: [{ product: null, name: '7D floor mats', quantity: 1, price: 6500 }],
      itemsTotal: 6500, discount: 0, gstAmount: 991, totalAmount: 6500,
      amountMismatch: false, paymentMethod: 'upi', channel: 'store',
    });
  });

  it('only five things are required', () => {
    const { value, errors } = cleanSale({
      saleDate: '2024-03-14', customer: { name: 'Walk-in' }, items: [{ name: 'Wiper', quantity: 2, price: 450 }],
      totalAmount: 900, paymentMethod: 'cash',
    }, { now: NOW });
    expect(errors).toEqual([]);
    expect(value.invoiceKey).toBeUndefined();
    expect(value.customer.phoneKey).toBeUndefined();
    expect(value.business).toBeUndefined();
  });

  it('lists every problem at once, in plain words', () => {
    const { value, errors } = cleanSale({ items: [{ name: '', quantity: 0, price: 'abc' }], totalAmount: 0, paymentMethod: 'barter' }, { now: NOW });
    expect(value).toBeNull();
    expect(errors).toEqual(expect.arrayContaining([
      'Enter the sale date.', 'Enter the customer name.', 'enter the item name.',
      expect.stringMatching(/quantity must be a whole number/), 'the price is not a valid amount.',
      'The total paid must be an amount above ₹0.', expect.stringMatching(/not a payment method/),
    ]));
  });

  it('refuses a future or impossibly old date', () => {
    expect(cleanSale(sale({ saleDate: '2026-10-30' }), { now: NOW }).errors).toContain('The sale date cannot be in the future.');
    expect(cleanSale(sale({ saleDate: istToday(NOW) }), { now: NOW }).errors).toEqual([]);
    expect(cleanSale(sale({ saleDate: '01/01/1999' }), { now: NOW }).errors[0]).toMatch(/too old/);
  });

  it('checks phone, email and GSTIN', () => {
    expect(cleanSale(sale({ customer: { name: 'A', phone: '12' } }), { now: NOW }).errors[0]).toMatch(/phone number "12" looks wrong/);
    expect(cleanSale(sale({ customer: { name: 'A', email: 'not-an-email' } }), { now: NOW }).errors[0]).toMatch(/email/);
    expect(cleanSale(sale({ business: { gstin: '27AAPFU0939F1ZX' } }), { now: NOW }).errors[0]).toMatch(/check-digit/);
    const ok = cleanSale(sale({ business: { legalName: 'Acme Motors', gstin: '27aapfu0939f1zv' } }), { now: NOW });
    expect(ok.value.business).toEqual({ legalName: 'Acme Motors', gstin: '27AAPFU0939F1ZV' });
  });

  it('a total that does not add up is saved as written, with a warning', () => {
    const { value, errors, warnings } = cleanSale(sale({ items: [{ name: 'Mats', quantity: 2, price: 3000 }], discount: 500, totalAmount: 6000 }), { now: NOW });
    expect(errors).toEqual([]);
    expect(value).toMatchObject({ itemsTotal: 6000, discount: 500, totalAmount: 6000, amountMismatch: true });
    expect(warnings[0]).toMatch(/does not match the total paid/);
    // Within ₹1 is rounding on the bill, not a mismatch.
    expect(cleanSale(sale({ items: [{ name: 'Mats', quantity: 3, price: 33.33 }], totalAmount: 100, gstAmount: '' }), { now: NOW }).value.amountMismatch).toBe(false);
  });

  it('GST cannot exceed the total; amounts round to paise', () => {
    expect(cleanSale(sale({ gstAmount: 7000 }), { now: NOW }).errors).toContain('The GST amount cannot be more than the total.');
    const { value } = cleanSale(sale({ items: [{ name: 'X', quantity: 1, price: 10.005 }], totalAmount: 10.005, gstAmount: null }), { now: NOW });
    expect(value.items[0].price).toBe(10.01);
    expect(value.totalAmount).toBe(10.01);
  });

  it('a linked product must be an id', () => {
    expect(cleanSale(sale({ items: [{ name: 'X', quantity: 1, price: 1, product: 'nope' }], totalAmount: 1 }), { now: NOW }).errors[0]).toMatch(/linked product/);
  });
});

describe('fingerprintOf', () => {
  const v = (over) => cleanSale(sale(over), { now: NOW }).value;
  it('is stable for the same sale however it was typed', () => {
    expect(fingerprintOf(v(), 'u1')).toBe(fingerprintOf(v({ customer: { name: ' arun   KUMAR ', phone: '09876543210' }, saleDate: '2024-03-14' }), 'u1'));
  });
  it('differs by salesman, bill number, total or items', () => {
    const base = fingerprintOf(v(), 'u1');
    expect(fingerprintOf(v(), 'u2')).not.toBe(base);
    expect(fingerprintOf(v({ invoiceNo: 'AB/2024/0316' }), 'u1')).not.toBe(base);
    expect(fingerprintOf(v({ totalAmount: 6499 }), 'u1')).not.toBe(base);
    expect(fingerprintOf(v({ items: [{ name: '7D floor mats', quantity: 2, price: 3250 }] }), 'u1')).not.toBe(base);
  });
});

describe('parseSheet', () => {
  it('reads the template it hands out', () => {
    const rows = parseSheet(Buffer.from(templateCsv()));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rowNumber: 2, saleDate: '14/03/2024', name: 'Arun Kumar', item: '7D floor mats', paymentMethod: 'UPI' });
  });

  it('matches headers loosely, skips blank lines, strips the Excel BOM', () => {
    const rows = parseSheet(Buffer.concat([Buffer.from('﻿'), csv([
      'DATE,Invoice No.,Customer,Mobile,Product,Qty,Rate,Amount,Mode,Something else',
      '14/03/2024,1,Arun,9876543210,Mats,1,6500,6500,Cash,ignored',
      ',,,,,,,,,',
      '15/03/2024,2,Bina,,Wiper,2,450,900,UPI,',
    ])]));
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 4]);
    expect(rows[1]).toMatchObject({ invoiceNo: '2', name: 'Bina', item: 'Wiper', quantity: '2', price: '450', totalAmount: '900', paymentMethod: 'UPI' });
  });

  it('names the missing columns', () => {
    expect(() => parseSheet(csv(['Date,Customer', '1/1/2024,A']))).toThrow(/missing: Item, Quantity, Price per unit, Total paid, Payment method/);
  });

  it('refuses empty, header-only, oversized and unreadable files', () => {
    expect(() => parseSheet(Buffer.alloc(0))).toThrow(/empty/);
    expect(() => parseSheet(csv([HEADER]))).toThrow(/no sales under them/);
    const many = [HEADER, ...Array.from({ length: MAX_UPLOAD_ROWS + 1 }, (_, i) => `1/1/2024,${i},A,,X,1,1,0,1,Cash`)];
    expect(() => parseSheet(csv(many))).toThrow(/at most 2000/);
    expect(() => parseSheet(Buffer.alloc(3 * 1024 * 1024, 65))).toThrow(/too large/);
    expect(() => parseSheet(csv([HEADER, '"unterminated,quote']))).toThrow(/Could not read the file/);
  });
});

describe('groupRows', () => {
  const rows = (lines) => parseSheet(csv([HEADER, ...lines]));

  it('rows with the same bill number make one sale, wherever they are', () => {
    const sales = groupRows(rows([
      '14/03/2024,AB-1,Arun,9876543210,Mats,1,6500,0,7400,UPI',
      '14/03/2024,AB-2,Bina,,Wiper,2,450,0,900,Cash',
      '14/03/2024,ab 1,Arun,9876543210,Perfume,2,450,0,7400,UPI',
    ]));
    expect(sales).toHaveLength(2);
    expect(sales[0].rows).toEqual([2, 4]);
    expect(sales[0].input.items.map((i) => i.name)).toEqual(['Mats', 'Perfume']);
    expect(sales[0].conflicts).toEqual([]);
  });

  it('rows without a bill number join only the matching row directly above', () => {
    const sales = groupRows(rows([
      '14/03/2024,,Arun,9876543210,Mats,1,6500,0,7400,Cash',
      '14/03/2024,,Arun,+91 98765 43210,Perfume,2,450,,,',
      '14/03/2024,,Bina,,Wiper,1,450,0,450,Cash',
      '14/03/2024,,Arun,9876543210,Mats,1,6500,0,6500,Cash',
    ]));
    expect(sales.map((s) => s.rows)).toEqual([[2, 3], [4], [5]]);
  });

  it('a later row that disagrees on date or total is flagged', () => {
    const [s] = groupRows(rows([
      '14/03/2024,AB-1,Arun,,Mats,1,6500,0,7400,UPI',
      '15/03/2024,AB-1,Arun,,Perfume,2,450,0,7000,UPI',
    ]));
    expect(s.conflicts).toEqual([
      'Row 3 has a different date for the same bill.',
      expect.stringMatching(/^Row 3 has a different total/),
    ]);
  });
});
