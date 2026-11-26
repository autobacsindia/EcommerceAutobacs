/**
 * Autobacs Partner (supplier app) — the foundation every later piece relies on.
 *
 * What must hold:
 *   - a supplier token never passes the staff/customer `protect`, and a staff or
 *     customer token never passes `protectSupplier`
 *   - a cookie is never accepted for supplier routes; a tampered, expired or
 *     revoked (sessionVersion bumped) token is 401 — never 200
 *   - status gating is 403 with a machine-readable code
 *   - a suggested price never falls below its target margin (any cost, any GST)
 *   - supplier views never carry a selling price, margin, product link or secret
 *   - the index script builds exactly the declared indexes and is re-runnable
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

const dbHandler = await import('./db-handler.js');
const { default: SupplierAccount, SUPPLIER_ACCOUNT_STATUS } = await import('../models/SupplierAccount.js');
const { default: SupplierListing } = await import('../models/SupplierListing.js');
const { default: SupplierPriceReview } = await import('../models/SupplierPriceReview.js');
const { default: User } = await import('../models/User.js');
const { signSupplierToken, protectSupplier, requireSupplierStatus } = await import('../middleware/supplierAuth.js');
const { protect } = await import('../middleware/authMiddleware.js');
const { signToken } = await import('../utils/jwtSecretManager.js');
const { suggestSellingPrice, marginOfPrice, checkPrice } = await import('../utils/supplierPricing.js');
const { toSupplierAccountView, toSupplierListingView, FORBIDDEN_SUPPLIER_KEYS } = await import('../utils/supplierPortalView.js');
const { buildIndexes } = await import('../scripts/create-supplier-portal-indexes.js');
const { default: MarginRule } = await import('../models/MarginRule.js');
const { resolveMarginRule } = await import('../services/supplierPortal/marginRules.js');

beforeAll(async () => { await dbHandler.connect(); });
afterEach(async () => { await dbHandler.clearDatabase(); });
afterAll(async () => { await dbHandler.closeDatabase(); });

const makeAccount = (over = {}) => SupplierAccount.create({
  email: `s${Math.random().toString(36).slice(2)}@example.com`,
  emailKey: `s${Math.random().toString(36).slice(2)}@example.com`,
  passwordHash: 'x'.repeat(60),
  companyName: 'Acme Parts',
  contactName: 'Ravi',
  phone: '9876543210',
  status: SUPPLIER_ACCOUNT_STATUS.APPROVED,
  ...over,
});

const app = express();
app.use(cookieParser());
app.get('/supplier', protectSupplier, (req, res) => res.json({ id: String(req.supplier._id) }));
app.get('/supplier/approved', protectSupplier, requireSupplierStatus(), (req, res) => res.json({ ok: true }));
app.get('/staff', protect, (req, res) => res.json({ id: String(req.user._id) }));

describe('supplier auth is separate from staff/customer auth', () => {
  test('a supplier token passes protectSupplier', async () => {
    const acc = await makeAccount();
    const res = await request(app).get('/supplier').set('Authorization', `Bearer ${signSupplierToken(acc)}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(String(acc._id));
  });

  test('a supplier token is refused by the staff/customer protect', async () => {
    const acc = await makeAccount();
    const res = await request(app).get('/staff').set('Authorization', `Bearer ${signSupplierToken(acc)}`);
    expect(res.status).toBe(401);
  });

  test('a supplier token is refused even when a User shares its id', async () => {
    const acc = await makeAccount();
    await User.collection.insertOne({ _id: acc._id, email: 'same@example.com', role: 'admin', sessionVersion: 0 });
    const res = await request(app).get('/staff').set('Authorization', `Bearer ${signSupplierToken(acc)}`);
    expect(res.status).toBe(401);
  });

  test('a staff/customer token is refused by protectSupplier, even with the supplier id in it', async () => {
    const acc = await makeAccount();
    const staffToken = signToken({ id: String(acc._id), sid: String(acc._id), sv: 0, typ: 'supplier', sessionVersion: 0 }, { expiresIn: '1h' });
    const res = await request(app).get('/supplier').set('Authorization', `Bearer ${staffToken}`);
    expect(res.status).toBe(401);
  });

  test('a cookie is never accepted', async () => {
    const acc = await makeAccount();
    const res = await request(app).get('/supplier').set('Cookie', `accessToken=${signSupplierToken(acc)}`);
    expect(res.status).toBe(401);
  });

  test('tampered, expired and garbage tokens are 401', async () => {
    const acc = await makeAccount();
    const good = signSupplierToken(acc);
    const [h, , s] = good.split('.');
    const forged = Buffer.from(JSON.stringify({ sid: String(new mongoose.Types.ObjectId()), sv: 0, typ: 'supplier', aud: 'autobacs-partner' })).toString('base64url');
    const expired = jwt.sign({ sid: String(acc._id), sv: 0, typ: 'supplier' }, 'wrong', { expiresIn: -10 });
    for (const t of [`${h}.${forged}.${s}`, expired, 'nonsense', '']) {
      const res = await request(app).get('/supplier').set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(401);
    }
  });

  test('bumping sessionVersion revokes existing tokens', async () => {
    const acc = await makeAccount();
    const token = signSupplierToken(acc);
    await SupplierAccount.updateOne({ _id: acc._id }, { $inc: { sessionVersion: 1 } });
    const res = await request(app).get('/supplier').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_REVOKED');
  });

  test('a deleted account is 401', async () => {
    const acc = await makeAccount();
    const token = signSupplierToken(acc);
    await SupplierAccount.deleteOne({ _id: acc._id });
    expect((await request(app).get('/supplier').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  test.each(['in_review', 'draft', 'rejected', 'suspended', 'email_unverified', 'changes_requested'])(
    'status %s is 403 on approved-only routes', async (status) => {
      const acc = await makeAccount({ status });
      const res = await request(app).get('/supplier/approved').set('Authorization', `Bearer ${signSupplierToken(acc)}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('SUPPLIER_STATUS');
    }
  );
});

describe('selling-price maths', () => {
  test('worked example: ₹1,800 cost + 18% GST at 30% margin → ₹3,035', () => {
    expect(suggestSellingPrice({ costPaise: 180000, gstPct: 18, marginBp: 3000 })).toBe(3035);
    expect(marginOfPrice({ costPaise: 180000, gstPct: 18, priceRupees: 3035 })).toBeGreaterThanOrEqual(3000);
  });

  test('a suggestion never falls below its margin (randomised)', () => {
    let seed = 7;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let i = 0; i < 5000; i += 1) {
      const costPaise = 1 + rnd(10_000_000);
      const gstPct = [0, 5, 12, 18, 28][rnd(5)];
      const marginBp = rnd(8000);
      const price = suggestSellingPrice({ costPaise, gstPct, marginBp });
      expect(Number.isInteger(price)).toBe(true);
      expect(marginOfPrice({ costPaise, gstPct, priceRupees: price })).toBeGreaterThanOrEqual(marginBp - 1);
    }
  });

  test('below cost and below floor are flagged', () => {
    expect(checkPrice({ costPaise: 100000, gstPct: 18, priceRupees: 1000, floorBp: 1000 })).toMatchObject({ belowCost: true, belowFloor: true });
    expect(checkPrice({ costPaise: 100000, gstPct: 18, priceRupees: 1250, floorBp: 1000 })).toMatchObject({ belowCost: false, belowFloor: true });
    expect(checkPrice({ costPaise: 100000, gstPct: 18, priceRupees: 1500, floorBp: 1000 })).toMatchObject({ belowCost: false, belowFloor: false });
  });

  test.each([
    [{ costPaise: 100.5, gstPct: 18, marginBp: 3000 }],
    [{ costPaise: 0, gstPct: 18, marginBp: 3000 }],
    [{ costPaise: 100, gstPct: 15, marginBp: 3000 }],
    [{ costPaise: 100, gstPct: 18, marginBp: 10000 }],
    [{ costPaise: '100', gstPct: 18, marginBp: 3000 }],
  ])('bad input is refused: %j', (input) => {
    expect(() => suggestSellingPrice(input)).toThrow(RangeError);
  });
});

describe('supplier views never leak', () => {
  const collectKeys = (v, out = new Set()) => {
    if (Array.isArray(v)) v.forEach((x) => collectKeys(x, out));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); collectKeys(x, out); }
    return out;
  };

  test('listing view drops price, margin, product link and staff identity', () => {
    const view = toSupplierListingView({
      _id: new mongoose.Types.ObjectId(), status: 'live', rev: 3, title: 'Wiper', costPaise: 50000, gstPct: 18,
      availability: 'in', images: [{ key: 'k1' }], specs: [{ label: 'Size', value: '22"' }],
      productId: new mongoose.Types.ObjectId(), price: 999, sellingPrice: 999, marginBp: 3000, supplierId: 'x',
      reviewedBy: 'y', reviewedByName: 'Staff', supplierAccount: 'z', product: { price: 999, slug: 'wiper' },
    });
    const keys = collectKeys(view);
    for (const k of FORBIDDEN_SUPPLIER_KEYS) expect(keys.has(k)).toBe(false);
    expect(view.costPaise).toBe(50000);
  });

  test('account view drops secrets and the full bank account number', async () => {
    const acc = await makeAccount({ bank: { accountName: 'Acme', accountNumber: '123456789012', accountLast4: '9012', ifsc: 'HDFC0000001' } });
    const raw = await SupplierAccount.findById(acc._id).select('+passwordHash +bank.accountNumber +emailCode.hash').lean();
    const view = toSupplierAccountView(raw);
    const keys = collectKeys(view);
    for (const k of FORBIDDEN_SUPPLIER_KEYS) expect(keys.has(k)).toBe(false);
    expect(JSON.stringify(view)).not.toContain('123456789012');
    expect(view.bank.accountLast4).toBe('9012');
  });
});

describe('models and indexes', () => {
  test('cost must be whole paise', async () => {
    const acc = await makeAccount();
    await expect(SupplierListing.create({ supplierAccount: acc._id, title: 'X', costPaise: 10.5, gstPct: 18 })).rejects.toThrow();
    await expect(SupplierListing.create({ supplierAccount: acc._id, title: 'X', costPaise: 1000, gstPct: 15 })).rejects.toThrow();
    await expect(SupplierListing.create({ supplierAccount: acc._id, title: 'X', costPaise: 1000, gstPct: 18, availability: 'backorder' })).rejects.toThrow();
  });

  test('index script builds every declared index, then is a no-op', async () => {
    const first = await buildIndexes({ apply: true, log: () => {} });
    expect(first.length).toBeGreaterThanOrEqual(8);
    // The test DB may already hold some (autoIndex on in tests); every one must end up present.
    expect(first.every(([, s]) => s === 'built' || s === 'already there')).toBe(true);
    const second = await buildIndexes({ apply: true, log: () => {} });
    expect(second.every(([, s]) => s === 'already there')).toBe(true);
  });

  test('one pending price review per listing; history rows are unlimited', async () => {
    await buildIndexes({ apply: true, log: () => {} });
    const listing = new mongoose.Types.ObjectId();
    const base = { listing, product: new mongoose.Types.ObjectId(), supplierAccount: new mongoose.Types.ObjectId(), oldCostPaise: 100, newCostPaise: 120, gstPct: 18, priceAtRaise: 2, suggestedPrice: 3, marginBp: 3000 };
    await SupplierPriceReview.create(base);
    await expect(SupplierPriceReview.create(base)).rejects.toThrow(/duplicate key/);
    await SupplierPriceReview.create({ ...base, status: 'applied' });
    await SupplierPriceReview.create({ ...base, status: 'kept' });
  });

  test('one login per procurement supplier record; unlinked accounts are unlimited', async () => {
    await buildIndexes({ apply: true, log: () => {} });
    const supplierId = new mongoose.Types.ObjectId();
    await makeAccount();
    await makeAccount();
    await makeAccount({ supplierId });
    await expect(makeAccount({ supplierId })).rejects.toThrow(/duplicate key/);
  });
});

describe('margin rule precedence', () => {

  test('built-in → default row → first category with a rule', async () => {
    const c1 = new mongoose.Types.ObjectId();
    const c2 = new mongoose.Types.ObjectId();
    expect(await resolveMarginRule([c1, c2])).toMatchObject({ targetBp: 3000, floorBp: 1000, source: 'built-in' });
    await MarginRule.create({ key: 'default', targetBp: 2500, floorBp: 800 });
    expect(await resolveMarginRule([c1, c2])).toMatchObject({ targetBp: 2500, source: 'default' });
    await MarginRule.create({ key: `category:${c2}`, category: c2, targetBp: 1500, floorBp: 500 });
    expect(await resolveMarginRule([c1, c2])).toMatchObject({ targetBp: 1500, source: `category:${c2}` });
    await MarginRule.create({ key: `category:${c1}`, category: c1, targetBp: 4000, floorBp: 1200 });
    expect(await resolveMarginRule([c1, c2])).toMatchObject({ targetBp: 4000, source: `category:${c1}` });
  });
});
