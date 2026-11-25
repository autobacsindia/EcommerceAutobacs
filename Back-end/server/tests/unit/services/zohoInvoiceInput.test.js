/**
 * Zoho invoice export parsing and the count-once matcher (services/zohoInvoiceInput.js).
 * Pure functions — every rule is proven here; the HTTP wiring is in companyRevenueRoutes.test.js.
 */
import {
  parseMoney,
  parseInvoiceDate,
  nameKey,
  namesAgree,
  parseZohoInvoiceCsv,
  parseZohoCreditNoteCsv,
  readZohoCsv,
  zohoExportKind,
  matchInvoicesToOrders,
} from '../../../services/zohoInvoiceInput.js';

const HEAD = 'Invoice Date,Invoice ID,Invoice Number,Invoice Status,Customer Name,Currency Code,SubTotal,Total,Balance,PurchaseOrder,Notes,Item Name';
const line = (o = {}) => {
  const r = {
    date: '2026-09-15', id: '1001', no: 'AUTO/26-27/0001', status: 'Closed', name: 'Ravi Kumar', cur: 'INR',
    sub: '8474.58', total: '10000.00', bal: '0.00', po: '', notes: '', item: 'Mats', ...o,
  };
  return [r.date, r.id, r.no, r.status, `"${r.name}"`, r.cur, r.sub, r.total, r.bal, r.po, r.notes, r.item].join(',');
};
const csv = (...lines) => Buffer.from([HEAD, ...lines].join('\n'));
const ist = (s) => parseInvoiceDate(s);

describe('parseMoney / parseInvoiceDate', () => {
  it('reads Indian money formats, rejects junk', () => {
    expect(parseMoney('1,23,456.70')).toBe(123456.7);
    expect(parseMoney('₹ 500')).toBe(500);
    expect(parseMoney('')).toBe(0);
    expect(parseMoney('abc')).toBeNaN();
  });
  it('reads ISO and dd/mm/yyyy as IST midnight, rejects impossible dates', () => {
    expect(parseInvoiceDate('2026-09-15').toISOString()).toBe('2026-09-14T18:30:00.000Z');
    expect(parseInvoiceDate('15/09/2026').toISOString()).toBe('2026-09-14T18:30:00.000Z');
    expect(parseInvoiceDate('31/02/2026')).toBeNull();
    expect(parseInvoiceDate('yesterday')).toBeNull();
  });
});

describe('names', () => {
  it('drops titles and company words', () => {
    expect(nameKey('M/s. Sharma Motors Pvt Ltd')).toBe('sharma motors');
    expect(nameKey('Mr. RAVI  Kumar')).toBe('ravi kumar');
  });
  it('agree on a shared real word or containment, not on nothing', () => {
    expect(namesAgree('ravi kumar', 'ravi')).toBe(true);
    expect(namesAgree('sharma motors', 'anil sharma')).toBe(true);
    expect(namesAgree('ravi kumar', 'anil das')).toBe(false);
    expect(namesAgree('', 'ravi')).toBe(false);
  });
});

describe('parseZohoInvoiceCsv', () => {
  it('groups line items into one invoice and keeps invoice-level totals', () => {
    const { invoices } = parseZohoInvoiceCsv(csv(line(), line({ item: 'Cover' })));
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ zohoInvoiceId: '1001', total: 10000, subTotal: 8474.58, status: 'closed', customerKey: 'ravi kumar' });
  });

  it('drops draft and void invoices and counts them', () => {
    const { invoices, skipped } = parseZohoInvoiceCsv(csv(line(), line({ id: '2', status: 'Draft' }), line({ id: '3', status: 'Void' })));
    expect(invoices.map((i) => i.zohoInvoiceId)).toEqual(['1001']);
    expect(skipped).toEqual({ draft: 1, void: 1 });
  });

  it('keeps unpaid (overdue) invoices with their balance', () => {
    const { invoices } = parseZohoInvoiceCsv(csv(line({ status: 'Overdue', bal: '10000' })));
    expect(invoices[0]).toMatchObject({ status: 'overdue', balance: 10000 });
  });

  it('reports bad rows instead of guessing', () => {
    const { invoices, errors } = parseZohoInvoiceCsv(csv(line({ id: '4', date: 'soon' }), line({ id: '5', total: 'x' }), line({ id: '6', cur: 'USD' })));
    expect(invoices).toHaveLength(0);
    expect(errors).toHaveLength(3);
  });

  it('picks up a panel order number written anywhere in the reference or notes', () => {
    const { invoices } = parseZohoInvoiceCsv(csv(line({ notes: 'web order ab-1a2b3c4d' })));
    expect(invoices[0].reference).toContain('AB-1A2B3C4D');
  });

  it('refuses a file that is not a Zoho invoice export', () => {
    expect(() => parseZohoInvoiceCsv(Buffer.from('Date,Amount\n2026-01-01,5'))).toThrow(/not a Zoho invoice export/);
    expect(() => parseZohoInvoiceCsv(Buffer.from(HEAD))).toThrow(/no rows/);
  });
});

describe('parseZohoCreditNoteCsv', () => {
  const CN_HEAD = 'Credit Note Date,CreditNotes ID,Credit Note Number,Credit Note Status,Customer Name,Currency Code,SubTotal,Total,Associated Invoice Number,Item Name';
  const cn = (id, status = 'Closed', inv = 'AUTO/26-27/0001') => ['2026-10-01', id, `CN-${id}`, status, 'X', 'INR', '847.46', '1000.00', inv, 'Mats'].join(',');

  it('is told apart from an invoice export by its columns', () => {
    expect(zohoExportKind(readZohoCsv(Buffer.from([CN_HEAD, cn('1')].join('\n'))))).toBe('credit_notes');
    expect(zohoExportKind(readZohoCsv(csv(line())))).toBe('invoices');
  });

  it('groups lines, drops void notes and keeps the invoice it reduces', () => {
    const { creditNotes, skipped } = parseZohoCreditNoteCsv(Buffer.from([CN_HEAD, cn('1'), cn('1'), cn('2', 'Void')].join('\n')));
    expect(creditNotes).toEqual([expect.objectContaining({ zohoCreditNoteId: '1', total: 1000, subTotal: 847.46, invoiceNumber: 'AUTO/26-27/0001' })]);
    expect(skipped.void).toBe(1);
  });

  it('flags a note with no invoice', () => {
    const { errors } = parseZohoCreditNoteCsv(Buffer.from([CN_HEAD, cn('3', 'Closed', '')].join('\n')));
    expect(errors[0]).toMatch(/no invoice number/);
  });
});

describe('matchInvoicesToOrders — every sale counted once, never on a guess', () => {
  const order = (id, date, amount, name) => ({ id, createdAt: ist(date), totalAmount: amount, nameKey: nameKey(name) });
  const inv = (key, date, total, name, extra = {}) => ({ key, invoiceDate: ist(date), total, customerKey: nameKey(name), reference: '', ...extra });

  it('links an invoice that carries the panel order number', () => {
    const o = order('64b000000000000012345678', '2026-06-01', 5000, 'Someone');
    const r = matchInvoicesToOrders([inv('a', '2026-09-01', 1, 'Else', { reference: 'AB-12345678' })], [o]);
    expect(r.get('a')).toMatchObject({ state: 'linked', orderId: o.id });
  });

  it('links same customer, same amount (±₹1), within 7 days', () => {
    const r = matchInvoicesToOrders([inv('a', '2026-09-05', 10000.5, 'Ravi Kumar')], [order('o1', '2026-09-01', 10000, 'Ravi')]);
    expect(r.get('a')).toMatchObject({ state: 'linked', orderId: 'o1' });
  });

  it('counts an invoice with no panel order like it as Zoho-only', () => {
    const r = matchInvoicesToOrders([inv('a', '2026-09-05', 10000, 'Anil Das')], [order('o1', '2026-09-01', 25000, 'Ravi')]);
    expect(r.get('a').state).toBe('zoho_only');
  });

  it('holds back a part-billed invoice for the same customer (needs a check, not counted)', () => {
    const r = matchInvoicesToOrders([inv('a', '2026-09-10', 4000, 'Ravi')], [order('o1', '2026-09-01', 10000, 'Ravi Kumar')]);
    expect(r.get('a')).toMatchObject({ state: 'needs_check', orderId: 'o1' });
  });

  it('holds back same amount and day under a different name (company bill for a person)', () => {
    const r = matchInvoicesToOrders([inv('a', '2026-09-02', 10000, 'Kumar Logistics')], [order('o1', '2026-09-01', 10000, 'Anil')]);
    expect(r.get('a').state).toBe('needs_check');
  });

  it('never links two invoices to one order — the second is held back', () => {
    const r = matchInvoicesToOrders(
      [inv('a', '2026-09-02', 10000, 'Ravi'), inv('b', '2026-09-03', 10000, 'Ravi')],
      [order('o1', '2026-09-01', 10000, 'Ravi')]
    );
    expect([r.get('a').state, r.get('b').state].sort()).toEqual(['linked', 'needs_check']);
  });

  it('prefers the closest match when two orders qualify', () => {
    const r = matchInvoicesToOrders([inv('a', '2026-09-05', 10000, 'Ravi')], [order('far', '2026-08-30', 10000, 'Ravi'), order('near', '2026-09-04', 10000, 'Ravi')]);
    expect(r.get('a').orderId).toBe('near');
  });

  it('ignores orders outside 15 days', () => {
    const r = matchInvoicesToOrders([inv('a', '2026-09-30', 10000, 'Ravi')], [order('o1', '2026-09-01', 10000, 'Ravi')]);
    expect(r.get('a').state).toBe('zoho_only');
  });

  it('leaves admin decisions alone and keeps their order claimed', () => {
    const r = matchInvoicesToOrders(
      [inv('a', '2026-09-02', 10000, 'Ravi', { adminDecided: true, adminOrderId: 'o1' }), inv('b', '2026-09-02', 10000, 'Ravi')],
      [order('o1', '2026-09-01', 10000, 'Ravi')]
    );
    expect(r.has('a')).toBe(false);
    expect(r.get('b').state).toBe('needs_check');
  });
});
