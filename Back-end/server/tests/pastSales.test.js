/**
 * Past (offline) sales (services/pastSaleService.js), against a real Mongo.
 *
 * What must hold:
 *   - a salesman's sale is always credited to them; accounts / admin choose the salesman
 *   - who sees what: a lead sees their own, the GTM head / accounts / admin see all;
 *     other teams see nothing
 *   - a lead edits only their own; only accounts / admin delete and restore
 *   - one bill, one sale: same bill number, or the same sale with no number, is
 *     refused — including two saves racing — unless explicitly "saved anyway"
 *   - an edit is applied only to the version that was opened, and is recorded
 *     old → new; delete is soft and counts nowhere; restore can't create a duplicate
 *   - an upload's preview writes nothing; importing the same sheet twice adds nothing
 *   - nothing creates an order, an account, or a notification
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

jest.setTimeout(120000);

const queued = [];
const mockQueue = { add: (...a) => { queued.push(a); return Promise.resolve({}); } };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: (...a) => { queued.push(a); }, closeQueues: () => Promise.resolve(),
}));

const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: Product } = await import('../models/Product.js');
const { default: PastSale } = await import('../models/PastSale.js');
const ps = await import('../services/pastSaleService.js');

const req = { headers: {}, ip: '127.0.0.1', connection: {}, get: () => '' };

let n = 0;
const person = (role, staff, name) => {
  n += 1;
  return User.create({ name: name || `${role} ${n}`, email: `p${n}@autobacs.test`, phone: '9000000001', passwordHash: 'x', role, ...(staff && { staff: { active: true, isHead: false, ...staff } }) });
};

const sale = (over = {}) => ({
  saleDate: '2024-03-14',
  invoiceNo: 'AB/2024/0315',
  customer: { name: 'Arun Kumar', phone: '9876543210', city: 'Kochi' },
  items: [{ name: '7D floor mats', quantity: 1, price: 6500 }],
  totalAmount: 6500,
  paymentMethod: 'upi',
  channel: 'store',
  ...over,
});
const csv = (lines) => Buffer.from(lines.join('\n'));
const HEADER = 'Sale date,Bill no,Customer name,Customer phone,Item,Quantity,Price per unit,Discount,Total paid,Payment method';

let admin, accounts, head, lead, lead2, ops;
beforeAll(async () => { await PastSale.init(); });
beforeEach(async () => {
  queued.length = 0;
  admin = await person('admin', null, 'Owner');
  accounts = await person('staff', { team: 'accounts' }, 'Anu');
  head = await person('staff', { team: 'sales', isHead: true }, 'Hari');
  lead = await person('staff', { team: 'sales' }, 'Sam');
  lead2 = await person('staff', { team: 'sales' }, 'Tara');
  ops = await person('staff', { team: 'operations' }, 'Omar');
});

const ids = (r) => r.sales.map((s) => s.id);

describe('entering a sale', () => {
  it("a salesman's sale is theirs, whatever they send; money is kept exactly as written", async () => {
    const { sale: s, warnings } = await ps.createPastSale(lead, sale({ salesUserId: String(lead2._id), totalAmount: 6000, discount: 0 }), req);
    expect(s).toMatchObject({
      saleDate: '2024-03-14', invoiceNo: 'AB/2024/0315', soldBy: { id: String(lead._id), name: 'Sam' },
      enteredBy: 'Sam', itemsTotal: 6500, totalAmount: 6000, amountMismatch: true, paymentMethod: 'upi',
      can: { edit: true, delete: false, restore: false },
    });
    expect(warnings[0]).toMatch(/does not match/);
    const doc = await PastSale.findById(s.id).lean();
    expect(doc.history).toEqual([expect.objectContaining({ action: 'created', byName: 'Sam' })]);
  });

  it('accounts and the admin choose the salesman — a former one too — or none', async () => {
    const gone = await person('customer', { team: 'sales', active: false }, 'Old Raj');
    expect((await ps.createPastSale(accounts, sale({ salesUserId: String(gone._id) }), req)).sale.soldBy).toEqual({ id: String(gone._id), name: 'Old Raj' });
    expect((await ps.createPastSale(admin, sale({ invoiceNo: 'X2', salesUserId: 'none' }), req)).sale.soldBy).toBeNull();
    await expect(ps.createPastSale(admin, sale({ invoiceNo: 'X3', salesUserId: String(ops._id) }), req)).rejects.toMatchObject({ statusCode: 400 });
    const sellers = await ps.listPastSaleSellers(accounts);
    expect(sellers.map((s) => [s.name, s.current])).toEqual([['Hari', true], ['Sam', true], ['Tara', true], ['Old Raj', false]]);
    await expect(ps.listPastSaleSellers(lead)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('other teams and customers cannot use it', async () => {
    const customer = await person('customer', null, 'Cust');
    for (const who of [ops, customer]) {
      await expect(ps.createPastSale(who, sale(), req)).rejects.toMatchObject({ statusCode: 403 });
      await expect(ps.listPastSales(who)).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('a bad sale is refused with every problem listed, and nothing is saved', async () => {
    await expect(ps.createPastSale(lead, sale({ saleDate: '', totalAmount: '' }), req))
      .rejects.toMatchObject({ statusCode: 400, message: 'Enter the sale date. Enter the total amount paid.' });
    expect(await PastSale.countDocuments()).toBe(0);
  });

  it('a linked product must exist; the line keeps its own name and price', async () => {
    const p = await Product.collection.insertOne({ name: 'Mats (catalogue)', price: 9999 });
    const { sale: s } = await ps.createPastSale(lead, sale({ items: [{ product: String(p.insertedId), name: 'Mats as billed', quantity: 1, price: 6500 }] }), req);
    expect(s.items).toEqual([{ product: String(p.insertedId), name: 'Mats as billed', quantity: 1, price: 6500 }]);
    await expect(ps.createPastSale(lead, sale({ invoiceNo: 'Z9', items: [{ product: String(new mongoose.Types.ObjectId()), name: 'X', quantity: 1, price: 6500 }] }), req))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/no longer exists/) });
  });
});

describe('one bill, one sale', () => {
  it('the same bill number is refused — across salesmen, however it is typed', async () => {
    await ps.createPastSale(lead, sale(), req);
    await expect(ps.createPastSale(lead2, sale({ invoiceNo: 'ab-2024-0315', customer: { name: 'Someone else' } }), req))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/^Bill AB\/2024\/0315 is already entered.*by Sam/) });
  });

  it('the same sale without a bill number is refused, unless saved anyway', async () => {
    const noBill = sale({ invoiceNo: '' });
    await ps.createPastSale(lead, noBill, req);
    await expect(ps.createPastSale(lead, noBill, req)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/save it anyway/) });
    await ps.createPastSale(lead, { ...noBill, allowDuplicate: true }, req);
    // Another salesman's identical sale is a different sale.
    await ps.createPastSale(lead2, noBill, req);
    expect(await PastSale.countDocuments({ active: true })).toBe(3);
  });

  it('two saves at the same moment land once', async () => {
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => ps.createPastSale(lead, sale(), req)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').every((r) => r.reason.statusCode === 409)).toBe(true);
    expect(await PastSale.countDocuments()).toBe(1);
  });
});

describe('editing', () => {
  it('a lead edits their own; the change is recorded old → new', async () => {
    const { sale: s } = await ps.createPastSale(lead, sale(), req);
    const { sale: edited, changed } = await ps.updatePastSale(lead, s.id, { ...sale({ totalAmount: 6400, discount: 100, notes: 'Fitted' }), version: s.version }, req);
    expect(changed).toBe(true);
    expect(edited).toMatchObject({ totalAmount: 6400, discount: 100, notes: 'Fitted', amountMismatch: false });
    expect(edited.history.at(-1)).toMatchObject({
      action: 'edited', by: 'Sam',
      changes: [{ field: 'Discount', from: '0', to: '100' }, { field: 'Total paid', from: '6500', to: '6400' }, { field: 'Notes', from: '', to: 'Fitted' }],
    });
  });

  it("a lead cannot edit another's; the head cannot either; accounts can, and may change the salesman", async () => {
    const { sale: s } = await ps.createPastSale(lead, sale(), req);
    await expect(ps.updatePastSale(lead2, s.id, { ...sale(), version: s.version }, req)).rejects.toMatchObject({ statusCode: 404 });
    await expect(ps.updatePastSale(head, s.id, { ...sale(), version: s.version }, req)).rejects.toMatchObject({ statusCode: 403 });
    const { sale: moved } = await ps.updatePastSale(accounts, s.id, { ...sale(), salesUserId: String(lead2._id), version: s.version }, req);
    expect(moved.soldBy).toEqual({ id: String(lead2._id), name: 'Tara' });
    expect(moved.history.at(-1).changes).toEqual([{ field: 'Sold by', from: 'Sam', to: 'Tara' }]);
    // …and a lead's edit never moves the sale off its salesman.
    const { sale: s2 } = await ps.createPastSale(lead, sale({ invoiceNo: 'B2' }), req);
    const { sale: kept } = await ps.updatePastSale(lead, s2.id, { ...sale({ invoiceNo: 'B2' }), salesUserId: String(lead2._id), version: s2.version }, req);
    expect(kept.soldBy.id).toBe(String(lead._id));
  });

  it('an edit made from an old copy is refused (two people editing at once)', async () => {
    const { sale: s } = await ps.createPastSale(lead, sale(), req);
    await ps.updatePastSale(accounts, s.id, { ...sale({ notes: 'first' }), version: s.version }, req);
    await expect(ps.updatePastSale(lead, s.id, { ...sale({ notes: 'second' }), version: s.version }, req))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/Reload it/) });
    await expect(ps.updatePastSale(lead, s.id, sale({ notes: 'no version' }), req)).rejects.toMatchObject({ statusCode: 409 });
    expect((await PastSale.findById(s.id).lean()).notes).toBe('first');
  });

  it('nothing changed → nothing written; a bill number taken by another sale is refused', async () => {
    const { sale: a } = await ps.createPastSale(lead, sale(), req);
    const { sale: b } = await ps.createPastSale(lead, sale({ invoiceNo: 'B2' }), req);
    const same = await ps.updatePastSale(lead, a.id, { ...sale(), version: a.version }, req);
    expect(same.changed).toBe(false);
    expect((await PastSale.findById(a.id).lean()).history).toHaveLength(1);
    await expect(ps.updatePastSale(lead, b.id, { ...sale(), version: b.version }, req))
      .rejects.toMatchObject({ statusCode: 409, message: 'Bill AB/2024/0315 is already entered on another sale.' });
  });

  it('clearing an optional field removes it', async () => {
    const { sale: s } = await ps.createPastSale(lead, sale({ gstAmount: 991, vehicle: 'Creta' }), req);
    const { sale: e } = await ps.updatePastSale(lead, s.id, { ...sale({ invoiceNo: '' }), version: s.version }, req);
    expect(e).toMatchObject({ invoiceNo: '', gstAmount: null, vehicle: '' });
    const doc = await PastSale.findById(s.id).lean();
    expect(doc.invoiceKey).toBeUndefined();
    expect(doc.gstAmount).toBeUndefined();
  });
});

describe('delete and restore', () => {
  it('only accounts / admin; soft; repeat clicks are harmless; a deleted sale counts nowhere', async () => {
    const { sale: s } = await ps.createPastSale(lead, sale(), req);
    await expect(ps.deletePastSale(lead, s.id, req)).rejects.toMatchObject({ statusCode: 403 });
    await expect(ps.deletePastSale(head, s.id, req)).rejects.toMatchObject({ statusCode: 403 });
    const { sale: d } = await ps.deletePastSale(accounts, s.id, req);
    expect(d).toMatchObject({ deleted: { by: 'Anu' }, can: { edit: false, delete: false, restore: true } });
    await ps.deletePastSale(admin, s.id, req);
    expect(await PastSale.countDocuments()).toBe(1);

    expect(ids(await ps.listPastSales(lead))).toEqual([]);
    expect((await ps.pastSaleTotals(admin)).total).toEqual({ sales: 0, value: 0 });
    expect(await ps.customerPastSales('9876543210')).toEqual([]);
    expect(ids(await ps.listPastSales(accounts, { deleted: '1' }))).toEqual([s.id]);
    await expect(ps.listPastSales(lead, { deleted: '1' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(ps.updatePastSale(accounts, s.id, { ...sale(), version: d.version }, req)).rejects.toMatchObject({ statusCode: 409 });

    // The bill can be entered again while this one is deleted…
    const { sale: again } = await ps.createPastSale(lead, sale(), req);
    // …and then restoring the old one would make two: refused.
    await expect(ps.restorePastSale(accounts, s.id, req)).rejects.toMatchObject({ statusCode: 409 });
    await ps.deletePastSale(accounts, again.id, req);
    const { sale: back } = await ps.restorePastSale(accounts, s.id, req);
    expect(back.deleted).toBeNull();
    expect((await ps.getPastSale(admin, s.id)).history.map((h) => h.action)).toEqual(['created', 'deleted', 'restored']);
  });
});

describe('reading', () => {
  it('a lead sees their own; the head, accounts and admin see everyone; filters by salesman and dates', async () => {
    const a = (await ps.createPastSale(lead, sale({ invoiceNo: 'A1', saleDate: '2024-01-10' }), req)).sale;
    const b = (await ps.createPastSale(lead2, sale({ invoiceNo: 'B1', saleDate: '2024-02-10' }), req)).sale;
    const c = (await ps.createPastSale(admin, sale({ invoiceNo: 'C1', saleDate: '2024-03-10', salesUserId: 'none' }), req)).sale;

    expect(ids(await ps.listPastSales(lead))).toEqual([a.id]);
    expect(ids(await ps.listPastSales(lead, { seller: String(lead2._id) }))).toEqual([a.id]); // cannot widen
    await expect(ps.getPastSale(lead, b.id)).rejects.toMatchObject({ statusCode: 404 });
    for (const who of [head, accounts, admin]) expect(ids(await ps.listPastSales(who))).toEqual([c.id, b.id, a.id]);
    expect(ids(await ps.listPastSales(admin, { seller: String(lead2._id) }))).toEqual([b.id]);
    expect(ids(await ps.listPastSales(admin, { seller: 'none' }))).toEqual([c.id]);
    expect(ids(await ps.listPastSales(admin, { from: '2024-02-10', to: '2024-02-10' }))).toEqual([b.id]);
    await expect(ps.listPastSales(admin, { from: 'garbage' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('search by phone (any format), bill number, or name', async () => {
    const a = (await ps.createPastSale(lead, sale({ invoiceNo: 'A1' }), req)).sale;
    const b = (await ps.createPastSale(lead, sale({ invoiceNo: 'B-77', customer: { name: 'Bina Paul', phone: '9123456780' } }), req)).sale;
    expect(ids(await ps.listPastSales(lead, { q: '+91 98765-43210' }))).toEqual([a.id]);
    expect(ids(await ps.listPastSales(lead, { q: 'b 77' }))).toEqual([b.id]);
    expect(ids(await ps.listPastSales(lead, { q: 'bina' }))).toEqual([b.id]);
    expect(ids(await ps.listPastSales(lead, { q: '(.*' }))).toEqual([]); // regex-safe
  });

  it('pages newest sale first with no gaps or repeats, including sales on the same day', async () => {
    const made = [];
    for (let i = 0; i < 53; i += 1) {
      // Several sales share each date, so the cursor must break ties on _id.
      const day = String(1 + (i % 5)).padStart(2, '0');
      made.push((await ps.createPastSale(lead, sale({ invoiceNo: `P${i}`, saleDate: `2024-04-${day}` }), req)).sale.id);
    }
    const seen = [];
    let cursor;
    let pages = 0;
    do {
      const page = await ps.listPastSales(lead, { cursor });
      expect(page.sales.length).toBeLessThanOrEqual(25);
      seen.push(...ids(page));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(53);
    expect(seen.sort()).toEqual(made.sort());
    // A junk cursor starts from the top rather than failing.
    expect((await ps.listPastSales(lead, { cursor: 'junk' })).sales).toHaveLength(25);
  });

  it('totals per salesman: a lead gets their own, others get everyone, deleted never counts', async () => {
    await ps.createPastSale(lead, sale({ invoiceNo: 'A1', totalAmount: 1000.1, items: [{ name: 'X', quantity: 1, price: 1000.1 }] }), req);
    await ps.createPastSale(lead, sale({ invoiceNo: 'A2', totalAmount: 2000.2, items: [{ name: 'X', quantity: 1, price: 2000.2 }] }), req);
    const gone = (await ps.createPastSale(lead2, sale({ invoiceNo: 'B1', totalAmount: 500, items: [{ name: 'X', quantity: 1, price: 500 }] }), req)).sale;
    await ps.createPastSale(lead2, sale({ invoiceNo: 'B2', totalAmount: 700, items: [{ name: 'X', quantity: 1, price: 700 }] }), req);
    await ps.deletePastSale(accounts, gone.id, req);

    expect(await ps.pastSaleTotals(lead)).toEqual({ sellers: [{ id: String(lead._id), name: 'Sam', sales: 2, value: 3000.3 }], total: { sales: 2, value: 3000.3 } });
    expect((await ps.pastSaleTotals(head)).sellers.map((s) => [s.name, s.sales, s.value])).toEqual([['Sam', 2, 3000.3], ['Tara', 1, 700]]);
    expect((await ps.pastSaleTotals(admin, { from: '2025-01-01' })).total).toEqual({ sales: 0, value: 0 });
  });

  it("a customer's past purchases by phone, however the number was written", async () => {
    await ps.createPastSale(lead, sale({ invoiceNo: 'A1', saleDate: '2023-05-01', customer: { name: 'Arun', phone: '+91 98765 43210' } }), req);
    await ps.createPastSale(lead2, sale({ invoiceNo: 'A2', saleDate: '2024-05-01', customer: { name: 'Arun K', phone: '098765-43210' } }), req);
    await ps.createPastSale(lead2, sale({ invoiceNo: 'A3', customer: { name: 'Other', phone: '9000000000' } }), req);
    const history = await ps.customerPastSales('9876543210');
    expect(history.map((h) => [h.invoiceNo, h.soldBy])).toEqual([['A2', 'Tara'], ['A1', 'Sam']]);
    expect(await ps.customerPastSales('')).toEqual([]);
  });
});

describe('spreadsheet upload', () => {
  const sheet = csv([
    HEADER,
    '14/03/2024,AB-1,Arun,9876543210,Mats,1,6500,0,7400,GPay',
    '14/03/2024,AB-1,Arun,9876543210,Perfume,2,450,,,',
    '15/03/2024,,Bina,,Wiper,2,450,0,900,Cash',
    '16/03/2024,AB-3,,,Bulb,1,300,0,300,Cash',
    '17/03/2024,AB-1,Arun,9876543210,Mats,1,6500,0,7400,UPI',
  ]);

  it('the preview writes nothing and shows what would happen to each sale', async () => {
    const preview = await ps.previewUpload(lead, sheet);
    expect(await PastSale.countDocuments()).toBe(0);
    expect(preview.counts).toEqual({ rows: 5, sales: 3, ready: 1, duplicates: 0, errors: 2 });
    expect(preview.sales.map((s) => [s.rows, s.status])).toEqual([[[2, 3, 6], 'error'], [[4], 'ready'], [[5], 'error']]);
    const byFirstRow = Object.fromEntries(preview.sales.map((s) => [s.rows[0], s]));
    // Row 6 repeats bill AB-1 with another date → the whole bill is held back.
    expect(byFirstRow[2]).toMatchObject({ status: 'error', reasons: ['Row 6 has a different date for the same bill.'] });
    expect(byFirstRow[4]).toMatchObject({ status: 'ready', customer: 'Bina', totalAmount: 900 });
    expect(byFirstRow[5]).toMatchObject({ status: 'error', reasons: ['Enter the customer name.'] });
  });

  it('imports the ready sales; the same sheet again adds nothing; a fixed sheet adds only the fixes', async () => {
    const good = csv([
      HEADER,
      '14/03/2024,AB-1,Arun,9876543210,Mats,1,6500,0,7400,GPay',
      '14/03/2024,AB-1,Arun,9876543210,Perfume,2,450,,,',
      '15/03/2024,,Bina,,Wiper,2,450,0,900,Cash',
      '16/03/2024,AB-3,,,Bulb,1,300,0,300,Cash',
    ]);
    const first = await ps.importUpload(lead, good, {}, req);
    expect(first.counts).toEqual({ rows: 4, sales: 3, imported: 2, duplicates: 0, errors: 1 });
    expect(first.importedValue).toBe(8300);
    expect(first.batchId).toMatch(/^[a-f0-9]{24}$/);
    const stored = await PastSale.find().sort({ saleDate: 1 }).lean();
    expect(stored.map((s) => [s.invoiceNo, s.items.length, s.totalAmount, s.paymentMethod, String(s.salesUser), s.batchId])).toEqual([
      ['AB-1', 2, 7400, 'upi', String(lead._id), first.batchId],
      [undefined, 1, 900, 'cash', String(lead._id), first.batchId],
    ]);

    const again = await ps.importUpload(lead, good, {}, req);
    expect(again.counts).toEqual({ rows: 4, sales: 3, imported: 0, duplicates: 2, errors: 1 });
    expect(again.batchId).toBeNull();
    expect(await PastSale.countDocuments()).toBe(2);

    const fixed = csv([HEADER, '14/03/2024,AB-1,Arun,9876543210,Mats,1,6500,0,7400,GPay', '16/03/2024,AB-3,Chitra,,Bulb,1,300,0,300,Cash']);
    expect((await ps.importUpload(lead, fixed, {}, req)).counts).toMatchObject({ imported: 1, duplicates: 1 });
    expect(await PastSale.countDocuments()).toBe(3);
  });

  it('the same bill twice in one file goes in once', async () => {
    const twice = csv([HEADER, '15/03/2024,,Bina,,Wiper,2,450,0,900,Cash', '14/03/2024,,Arun,,Mats,1,100,0,100,Cash', '15/03/2024,,Bina,,Wiper,2,450,0,900,Cash']);
    const res = await ps.importUpload(lead, twice, {}, req);
    expect(res.counts).toMatchObject({ sales: 3, imported: 2, duplicates: 1 });
    expect(res.sales[2].reasons).toEqual(['Same bill as row 2 in this file.']);
  });

  it('two imports of one sheet at the same moment add it once', async () => {
    const one = csv([HEADER, '14/03/2024,AB-9,Arun,,Mats,1,100,0,100,Cash', '15/03/2024,,Bina,,Wiper,1,50,0,50,Cash']);
    const results = await Promise.all([1, 2, 3].map(() => ps.importUpload(lead, one, {}, req)));
    expect(results.reduce((n, r) => n + r.counts.imported, 0)).toBe(2);
    expect(await PastSale.countDocuments()).toBe(2);
  });

  it('a bill entered by someone else between the check and the save is skipped, not doubled, and the rest still go in', async () => {
    const { default: repo } = await import('../repositories/pastSaleRepository.js');
    const realClashes = repo.findActiveClashes;
    // The check sees nothing; then, before the batch is saved, AB-2 is entered by hand.
    repo.findActiveClashes = async (...a) => {
      const r = await realClashes(...a);
      repo.findActiveClashes = realClashes; // once: the hand entry below runs the real check
      await ps.createPastSale(lead2, sale({ invoiceNo: 'AB-2', customer: { name: 'Bina' } }), req);
      return r;
    };
    try {
      const res = await ps.importUpload(lead, csv([HEADER,
        '14/03/2024,AB-1,Arun,,Mats,1,100,0,100,Cash',
        '14/03/2024,AB-2,Bina,,Wiper,1,50,0,50,Cash',
        '14/03/2024,AB-3,Chitra,,Bulb,1,30,0,30,Cash']), {}, req);
      expect(res.counts).toMatchObject({ imported: 2, duplicates: 1 });
      expect(res.importedValue).toBe(130);
      expect(res.sales.map((x) => x.status)).toEqual(['imported', 'duplicate', 'imported']);
    } finally {
      repo.findActiveClashes = realClashes;
    }
    expect(await PastSale.countDocuments({ invoiceKey: 'AB2' })).toBe(1);
    expect(await PastSale.countDocuments()).toBe(3);
  });

  it('accounts uploads for a chosen salesman, and can undo the whole upload', async () => {
    const res = await ps.importUpload(accounts, csv([HEADER, '15/03/2024,,Bina,,Wiper,2,450,0,900,Cash']), { salesUserId: String(lead2._id) }, req);
    expect((await PastSale.findOne().lean()).salesUserName).toBe('Tara');
    await expect(ps.deleteUpload(lead2, res.batchId, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await ps.deleteUpload(accounts, res.batchId, req)).toEqual({ deleted: 1 });
    expect(await ps.deleteUpload(accounts, res.batchId, req)).toEqual({ deleted: 0 });
    expect(await PastSale.countDocuments({ active: true })).toBe(0);
  });

  it('an unreadable sheet is a 400 with words', async () => {
    await expect(ps.previewUpload(lead, csv(['Date,Customer', 'x,y']))).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/columns are missing/) });
  });
});

describe('side effects', () => {
  it('creates no order, no account and no notification', async () => {
    const usersBefore = await User.countDocuments();
    await ps.createPastSale(lead, sale({ customer: { name: 'New Person', phone: '9988776655', email: 'new@example.com' } }), req);
    await ps.importUpload(lead, csv([HEADER, '15/03/2024,,Bina,9123456789,Wiper,2,450,0,900,Cash']), {}, req);
    expect(await Order.countDocuments()).toBe(0);
    expect(await User.countDocuments()).toBe(usersBefore);
    expect(queued).toEqual([]);
  });
});
