/**
 * Autobacs Partner — the supplier-facing API (routes/partner.js, services/supplierPortal/*).
 *
 * What must hold:
 *   - sign-up / verify / resend / login / forgot / reset: codes hashed, 15-min
 *     expiry, 5 tries, 60 s resend cooldown; login lockout; no "email not found" leak
 *   - auth failure is never 200; reset and logout-all revoke old tokens
 *   - a supplier only ever reaches its OWN listings — another supplier's id is 404
 *   - bodies are allow-lists: no selling price, productId, status… can be sent
 *   - every edit bumps rev (CAS); a stale editor is refused
 *   - a cost change on a live listing = exactly ONE pending price review (even with
 *     concurrent edits); Product.price never changes
 *   - availability on a live drivesStock listing → Product.stock + cache purge;
 *     withdraw → stock 'out'; isActive never changes
 *   - keyset pagination: no row repeated or skipped, ties broken by _id
 *   - EVERY response passes the FORBIDDEN_SUPPLIER_KEYS deep scan
 */
import { jest } from '@jest/globals';

// R2 presigning is local maths; fake credentials let signed photo URLs be minted offline.
Object.assign(process.env, {
  STORAGE_PROVIDER: 'r2',
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_PUBLIC_BUCKET: 'pub',
  R2_PRIVATE_BUCKET: 'priv',
  R2_PUBLIC_BASE_URL: 'https://cdn.example.test',
});

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));

const stored = new Map();
const storageMock = {
  resourceTypeFor: (t) => (String(t).startsWith('image/') ? 'image' : 'raw'),
  putPrivateAsset: async ({ buffer, folder, basename }) => {
    const publicId = `${folder}/${basename}`;
    stored.set(publicId, buffer);
    return { publicId, provider: 'r2', bytes: buffer.length, resourceType: 'image', url: '' };
  },
  deletePrivateAsset: async ({ publicId }) => { stored.delete(publicId); return true; },
  readPrivateAsset: async (ref) => stored.get(ref.publicId),
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));

// Plain functions, not jest.fn: jest.config resets mock implementations before every test.
const sentEmails = [];
let failNextEmail = false;
const emailMock = {
  sendEmail: async (msg) => {
    if (failNextEmail) { failNextEmail = false; return { success: false, error: 'down' }; }
    sentEmails.push(msg);
    return { success: true };
  },
  getStatus: () => ({ enabled: true }),
};
jest.unstable_mockModule('../services/emailHandler.js', () => ({ default: emailMock }));

const purges = [];
const revalidations = [];
const invalidateCache = (...patterns) => { purges.push(patterns); };
jest.unstable_mockModule('../middleware/cacheMiddleware.js', () => ({ invalidateCache, default: { invalidateCache } }));
const revalidateFrontendTags = async (tags) => { revalidations.push(tags); };
jest.unstable_mockModule('../services/frontendRevalidator.js', () => ({ revalidateFrontendTags, default: { revalidateFrontendTags } }));

const request = (await import('supertest')).default;
const { app } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: SupplierAccount } = await import('../models/SupplierAccount.js');
const { default: SupplierListing } = await import('../models/SupplierListing.js');
const { default: SupplierPriceReview } = await import('../models/SupplierPriceReview.js');
const { default: Product } = await import('../models/Product.js');
const { default: User } = await import('../models/User.js');
const { signSupplierToken } = await import('../middleware/supplierAuth.js');
const { FORBIDDEN_SUPPLIER_KEYS } = await import('../utils/supplierPortalView.js');
const { isEncrypted } = await import('../utils/fieldEncryption.js');
const { suggestSellingPrice } = await import('../utils/supplierPricing.js');
const { encodeCursor } = await import('../services/supplierPortal/listings.js');

const P = '/api/v1/partner';

// ── forbidden-key deep scan over EVERY response this suite receives ──────────
const responses = [];
const FORBIDDEN = new Set(FORBIDDEN_SUPPLIER_KEYS);
function forbiddenPaths(value, path = '$') {
  if (Array.isArray(value)) return value.flatMap((v, i) => forbiddenPaths(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(FORBIDDEN.has(k) ? [`${path}.${k}`] : []),
      ...forbiddenPaths(v, `${path}.${k}`),
    ]);
  }
  return [];
}
const track = async (pending) => {
  const res = await pending;
  responses.push({ url: res.req?.path, body: res.body });
  return res;
};

beforeAll(async () => { await dbHandler.connect(); });
afterEach(async () => {
  const leaks = responses.flatMap((r) => forbiddenPaths(r.body).map((p) => `${r.url} ${p}`));
  responses.length = 0;
  expect(leaks).toEqual([]);
  sentEmails.length = 0;
  stored.clear();
  purges.length = 0;
  revalidations.length = 0;
  failNextEmail = false;
  await dbHandler.clearDatabase();
});
afterAll(async () => { await dbHandler.closeDatabase(); });

// ── helpers ──────────────────────────────────────────────────────────────────

/** Signed-out client: fetches the CSRF token the way the mobile app does. */
async function guest() {
  const agent = request.agent(app);
  const res = await agent.get('/api/v1/csrf-token');
  const token = res.body.csrfToken;
  return { post: (url, body = {}) => track(agent.post(`${P}${url}`).set('X-XSRF-TOKEN', token).send(body)) };
}

/** Bearer client (no cookies — exactly the mobile app after sign-in). */
const as = (token) => ({
  get: (url) => track(request(app).get(`${P}${url}`).set('Authorization', `Bearer ${token}`)),
  post: (url, body = {}) => track(request(app).post(`${P}${url}`).set('Authorization', `Bearer ${token}`).send(body)),
  patch: (url, body = {}) => track(request(app).patch(`${P}${url}`).set('Authorization', `Bearer ${token}`).send(body)),
  del: (url) => track(request(app).delete(`${P}${url}`).set('Authorization', `Bearer ${token}`)),
  upload: (url, field, files) => {
    let r = request(app).post(`${P}${url}`).set('Authorization', `Bearer ${token}`);
    for (const f of files) r = r.attach(field, f.buffer, { filename: f.name, contentType: f.type });
    return track(r);
  },
});

let seq = 0;
async function makeSupplier(status = 'approved', over = {}) {
  seq += 1;
  const email = `supplier${seq}@example.test`;
  const account = await SupplierAccount.create({
    email, emailKey: email, passwordHash: 'x'.repeat(60), companyName: `Acme ${seq}`, contactName: 'Ravi',
    phone: '9876543210', status, emailVerifiedAt: status === 'email_unverified' ? null : new Date(), ...over,
  });
  return { account, api: as(signSupplierToken(account)) };
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(64, 1)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 32)]);
const png = (name = 'a.png') => ({ buffer: PNG, name, type: 'image/png' });

const LISTING = {
  title: 'Brake pads front', brand: 'Bosch', partNumber: 'BP-1', costPaise: 180000, gstPct: 18,
  availability: 'in', dispatchDays: 2, specs: [{ label: 'Axle', value: 'Front' }],
};

let pseq = 0;
const makeProduct = (over = {}) => {
  pseq += 1;
  return Product.create({
    name: `Pads ${pseq}`, slug: `pads-${pseq}`, description: 'x', price: 3000, stock: 'in', brand: 'B', isActive: true, ...over,
  });
};

/** A live listing linked to a product (what procurement approval would leave behind). */
async function liveListing(account, { drivesStock = true, product } = {}) {
  const p = product || await makeProduct();
  const l = await SupplierListing.create({
    ...LISTING, supplierAccount: account._id, status: 'live', productId: p._id, drivesStock, liveAt: new Date(), rev: 3,
    images: [{ key: `supplier-portal/listings/${account._id}/x/photo-1.png`, provider: 'r2', contentType: 'image/png' }],
  });
  return { listing: l, product: p };
}

const lastCode = () => {
  const msg = sentEmails[sentEmails.length - 1];
  return msg?.text.match(/\b(\d{6})\b/)?.[1];
};

// ═════════════════════════════════════════════════════════════════════════════
describe('sign-up and email code', () => {
  const SIGNUP = { email: 'New.Supplier@Example.test', password: 'longenough1', companyName: 'Acme Parts', contactName: 'Ravi K', phone: '+91 98765 43210' };

  test('creates an unverified account, returns a token, and emails a 6-digit code', async () => {
    const g = await guest();
    const res = await g.post('/auth/signup', SIGNUP);
    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.codeSent).toBe(true);
    expect(res.body.account).toMatchObject({ status: 'email_unverified', emailVerified: false, phone: '9876543210' });
    expect(lastCode()).toMatch(/^\d{6}$/);
    expect(sentEmails[0].to).toBe('New.Supplier@Example.test');

    const raw = await SupplierAccount.findOne({ emailKey: 'new.supplier@example.test' }).select('+passwordHash +emailCode.hash').lean();
    expect(raw.passwordHash).not.toContain('longenough1');
    expect(raw.emailCode.hash).not.toContain(lastCode()); // stored hashed
  });

  test('a duplicate email (any case) is refused and creates nothing', async () => {
    const g = await guest();
    expect((await g.post('/auth/signup', SIGNUP)).status).toBe(201);
    const dup = await g.post('/auth/signup', { ...SIGNUP, email: 'new.supplier@EXAMPLE.test' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('EMAIL_TAKEN');
    expect(dup.body.token).toBeUndefined();
    expect(await SupplierAccount.countDocuments()).toBe(1);
  });

  test('signup refuses extra fields (cannot self-approve) and weak passwords', async () => {
    const g = await guest();
    const sneaky = await g.post('/auth/signup', { ...SIGNUP, status: 'approved' });
    expect(sneaky.status).toBe(400);
    expect(sneaky.body.code).toBe('UNKNOWN_FIELDS');
    const weak = await g.post('/auth/signup', { ...SIGNUP, password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('WEAK_PASSWORD');
    expect(await SupplierAccount.countDocuments()).toBe(0);
  });

  test('without the CSRF token a signed-out write is refused', async () => {
    const res = await request(app).post(`${P}/auth/signup`).send(SIGNUP);
    expect(res.status).toBe(403);
  });

  test('wrong code counts down; right code verifies; a retried verify is still 200', async () => {
    const g = await guest();
    const { body } = await g.post('/auth/signup', SIGNUP);
    const api = as(body.token);
    const code = lastCode();
    const wrong = await api.post('/auth/verify-email', { code: code === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body).toMatchObject({ code: 'INVALID_CODE', attemptsLeft: 4 });
    const right = await api.post('/auth/verify-email', { code });
    expect(right.status).toBe(200);
    expect(right.body.account).toMatchObject({ status: 'draft', emailVerified: true });
    const again = await api.post('/auth/verify-email', { code });
    expect(again.status).toBe(200);
  });

  test('after 5 wrong tries even the right code is refused', async () => {
    const g = await guest();
    const { body } = await g.post('/auth/signup', SIGNUP);
    const api = as(body.token);
    const code = lastCode();
    const bad = code === '000000' ? '111111' : '000000';
    // Fired in parallel: the cap is enforced in the update filter, so it cannot be raced past.
    await Promise.all(Array.from({ length: 7 }, () => api.post('/auth/verify-email', { code: bad })));
    const res = await api.post('/auth/verify-email', { code });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CODE_LOCKED');
    const raw = await SupplierAccount.findById(body.account.id).select('+emailCode.attempts').lean();
    expect(raw.emailCode.attempts).toBe(5);
    expect(raw.status).toBe('email_unverified');
  });

  test('an expired code is refused', async () => {
    const g = await guest();
    const { body } = await g.post('/auth/signup', SIGNUP);
    await SupplierAccount.updateOne({ _id: body.account.id }, { $set: { 'emailCode.expiresAt': new Date(Date.now() - 1000) } });
    const res = await as(body.token).post('/auth/verify-email', { code: lastCode() });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CODE_EXPIRED');
  });

  test('resend has a 60 s cooldown, and the new code replaces the old one', async () => {
    const g = await guest();
    const { body } = await g.post('/auth/signup', SIGNUP);
    const api = as(body.token);
    const first = lastCode();
    const tooSoon = await api.post('/auth/resend-code');
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.code).toBe('RESEND_COOLDOWN');
    await SupplierAccount.updateOne({ _id: body.account.id }, { $set: { 'emailCode.sentAt': new Date(Date.now() - 61_000) } });
    const later = await api.post('/auth/resend-code');
    expect(later.status).toBe(200);
    const second = lastCode();
    if (first !== second) {
      expect((await api.post('/auth/verify-email', { code: first })).status).toBe(400);
    }
    expect((await api.post('/auth/verify-email', { code: second })).status).toBe(200);
  });

  test('a failed email send frees the cooldown and says so', async () => {
    failNextEmail = true;
    const g = await guest();
    const res = await g.post('/auth/signup', SIGNUP);
    expect(res.status).toBe(201);
    expect(res.body.codeSent).toBe(false);
    const again = await as(res.body.token).post('/auth/resend-code');
    expect(again.status).toBe(200); // not 429: the failed send did not start a cooldown
  });
});

describe('sign-in, lockout, reset, sign out everywhere', () => {
  const PW = 'correct-horse-9';
  async function withPassword() {
    const g = await guest();
    const res = await g.post('/auth/signup', { email: 'login@example.test', password: PW, companyName: 'Acme', contactName: 'Ravi', phone: '9876543210' });
    return { g, signup: res.body };
  }

  test('right password signs in; wrong password and unknown email look the same', async () => {
    const { g } = await withPassword();
    const good = await g.post('/auth/login', { email: 'LOGIN@example.test', password: PW });
    expect(good.status).toBe(200);
    expect(good.body.token).toEqual(expect.any(String));
    const wrong = await g.post('/auth/login', { email: 'login@example.test', password: 'nope-nope' });
    const unknown = await g.post('/auth/login', { email: 'nobody@example.test', password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const strip = ({ requestId, ...rest }) => rest; // per-request trace id differs by design
    expect(strip(unknown.body)).toEqual(strip(wrong.body));
  });

  test('5 wrong passwords lock sign-in for 15 minutes, even with the right password', async () => {
    const { g, signup } = await withPassword();
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect((await g.post('/auth/login', { email: 'login@example.test', password: `wrong-${i}-xx` })).status).toBe(401);
    }
    const locked = await g.post('/auth/login', { email: 'login@example.test', password: PW });
    expect(locked.status).toBe(401);
    expect(locked.body.code).toBe('INVALID_LOGIN');
    await SupplierAccount.updateOne({ _id: signup.account.id }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await g.post('/auth/login', { email: 'login@example.test', password: PW })).status).toBe(200);
  });

  test('forgot always says the same; reset sets the password and signs out old tokens', async () => {
    const { g, signup } = await withPassword();
    const unknown = await g.post('/auth/forgot', { email: 'nobody@example.test' });
    expect(unknown.status).toBe(200);
    expect(sentEmails.filter((m) => m.purpose === 'supplier-reset-code')).toHaveLength(0);
    // The sign-up code is <60 s old; release the cooldown so the reset code goes out.
    await SupplierAccount.updateOne({ _id: signup.account.id }, { $set: { 'emailCode.sentAt': null } });
    const known = await g.post('/auth/forgot', { email: 'login@example.test' });
    expect(known.status).toBe(200);
    expect(known.body.message).toBe(unknown.body.message);
    const code = lastCode();

    const bad = await g.post('/auth/reset', { email: 'login@example.test', code: code === '000000' ? '111111' : '000000', password: 'brand-new-pass' });
    expect(bad.status).toBe(400);
    const ok = await g.post('/auth/reset', { email: 'login@example.test', code, password: 'brand-new-pass' });
    expect(ok.status).toBe(200);
    expect(ok.body.account.status).toBe('draft'); // the code proved the inbox
    expect((await as(signup.token).get('/me')).status).toBe(401);
    expect((await as(ok.body.token).get('/me')).status).toBe(200);
    expect((await g.post('/auth/login', { email: 'login@example.test', password: PW })).status).toBe(401);
    expect((await g.post('/auth/login', { email: 'login@example.test', password: 'brand-new-pass' })).status).toBe(200);
    // A used code does not work twice.
    expect((await g.post('/auth/reset', { email: 'login@example.test', code, password: 'another-pass-1' })).status).toBe(400);
  });

  test('logout-all revokes every token', async () => {
    const { account, api } = await makeSupplier('draft');
    const other = as(signSupplierToken(account));
    expect((await api.post('/auth/logout-all')).status).toBe(200);
    expect((await api.get('/me')).status).toBe(401);
    expect((await other.get('/me')).status).toBe(401);
  });

  test('no token / a customer cookie never gets a 200', async () => {
    expect((await track(request(app).get(`${P}/me`))).status).toBe(401);
    expect((await track(request(app).get(`${P}/listings`).set('Cookie', 'accessToken=abc'))).status).toBe(401);
  });
});

describe('company profile and documents', () => {
  const FULL = {
    gstin: '29ABCDE1234F1Z5', pan: 'abcde1234f', address: '12 MG Road', city: 'Bengaluru',
    bank: { accountName: 'Acme Parts', accountNumber: '123456789012', ifsc: 'hdfc0001234' },
  };

  test('saves GSTIN/PAN/bank; the account number is encrypted and only last 4 shown', async () => {
    const { account, api } = await makeSupplier('draft');
    const res = await api.patch('/me', FULL);
    expect(res.status).toBe(200);
    expect(res.body.account).toMatchObject({ gstin: '29ABCDE1234F1Z5', pan: 'ABCDE1234F', bank: { accountLast4: '9012', ifsc: 'HDFC0001234' } });
    expect(JSON.stringify(res.body)).not.toContain('123456789012');
    const raw = await SupplierAccount.findById(account._id).select('+bank.accountNumber').lean();
    expect(isEncrypted(raw.bank.accountNumber)).toBe(true);
  });

  test('bad formats, a GSTIN/PAN mismatch and unknown fields are refused', async () => {
    const { api } = await makeSupplier('draft');
    expect((await api.patch('/me', { gstin: '12345' })).body.code).toBe('INVALID_FIELD');
    expect((await api.patch('/me', { bank: { ifsc: 'HDFC1234567' } })).body.code).toBe('INVALID_FIELD');
    expect((await api.patch('/me', { gstin: '29ABCDE1234F1Z5', pan: 'ZZZZZ9999Z' })).body.code).toBe('GSTIN_PAN_MISMATCH');
    const sneaky = await api.patch('/me', { status: 'approved', supplierId: '507f1f77bcf86cd799439011' });
    expect(sneaky.status).toBe(400);
    expect(sneaky.body.code).toBe('UNKNOWN_FIELDS');
    expect((await api.patch('/me', { bank: { accountNumber: '1234567890', balance: 5 } })).body.code).toBe('UNKNOWN_FIELDS');
  });

  test('documents: image/PDF accepted from the bytes, anything else refused; replacing deletes the old file', async () => {
    const { api } = await makeSupplier('draft');
    const bad = await api.upload('/me/documents/gstCertificate', 'file', [{ buffer: Buffer.from('<html>hi</html>'), name: 'x.pdf', type: 'application/pdf' }]);
    expect(bad.status).toBe(400);
    const first = await api.upload('/me/documents/gstCertificate', 'file', [{ buffer: PDF, name: 'gst.pdf', type: 'application/pdf' }]);
    expect(first.status).toBe(200);
    expect(first.body.account.hasGstCertificate).toBe(true);
    expect(stored.size).toBe(1);
    const [firstKey] = [...stored.keys()];
    expect(firstKey.startsWith('supplier-portal/accounts/')).toBe(true);
    await api.upload('/me/documents/gstCertificate', 'file', [png('gst.png')]);
    expect(stored.size).toBe(1);
    expect(stored.has(firstKey)).toBe(false);
    expect((await api.upload('/me/documents/passport', 'file', [png()])).status).toBe(404);
  });

  test('submit needs everything, moves to in_review once, tells procurement once, then locks edits', async () => {
    await User.create({ name: 'Proc', email: 'proc@autobacs.test', role: 'staff', staff: { team: 'procurement', active: true }, phone: '9876543210', passwordHash: 'x' });
    const { api } = await makeSupplier('draft');
    const early = await api.post('/me/submit');
    expect(early.status).toBe(400);
    expect(early.body.missing).toEqual(expect.arrayContaining(['gstin', 'gstCertificate', 'cancelledCheque']));
    await api.patch('/me', FULL);
    await api.upload('/me/documents/gstCertificate', 'file', [png()]);
    await api.upload('/me/documents/cancelledCheque', 'file', [png()]);
    const [a, b] = await Promise.all([api.post('/me/submit'), api.post('/me/submit')]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.account.status).toBe('in_review');
    await new Promise((r) => { setTimeout(r, 50); });
    expect(sentEmails.filter((m) => m.to === 'proc@autobacs.test')).toHaveLength(1);
    const edit = await api.patch('/me', { city: 'Mysuru' });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe('PROFILE_LOCKED');
  });
});

describe('listings: ownership, status gating, allow-list, rev', () => {
  test('only approved suppliers create; suspended can read but not write', async () => {
    const { api: draft } = await makeSupplier('draft');
    const r = await draft.post('/listings', LISTING);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SUPPLIER_STATUS');
    const { account, api: susp } = await makeSupplier('suspended');
    await SupplierListing.create({ ...LISTING, supplierAccount: account._id });
    expect((await susp.get('/listings')).body.listings).toHaveLength(1);
    expect((await susp.post('/listings', LISTING)).status).toBe(403);
  });

  test('create: no selling price / productId / status can be sent; cost must be whole paise', async () => {
    const { api } = await makeSupplier();
    for (const extra of [{ price: 3500 }, { sellingPrice: 3500 }, { productId: '507f1f77bcf86cd799439011' }, { status: 'live' }, { drivesStock: true }, { rev: 9 }]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await api.post('/listings', { ...LISTING, ...extra });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('UNKNOWN_FIELDS');
    }
    expect((await api.post('/listings', { ...LISTING, costPaise: 1800.5 })).status).toBe(400);
    expect((await api.post('/listings', { ...LISTING, costPaise: -5 })).status).toBe(400);
    expect((await api.post('/listings', { ...LISTING, gstPct: 7 })).status).toBe(400);
    expect((await api.post('/listings', { ...LISTING, availability: 'backorder' })).status).toBe(400);
    const ok = await api.post('/listings', LISTING);
    expect(ok.status).toBe(201);
    expect(ok.body.listing).toMatchObject({ status: 'draft', rev: 0, costPaise: 180000 });
    expect(await SupplierListing.countDocuments()).toBe(1);
  });

  test("supplier A cannot read, edit, submit, withdraw or touch photos of B's listing (404)", async () => {
    const { api: a } = await makeSupplier();
    const { api: b } = await makeSupplier();
    const mine = (await b.post('/listings', LISTING)).body.listing;
    const id = mine.id;
    const tries = [
      await a.get(`/listings/${id}`),
      await a.patch(`/listings/${id}`, { title: 'Hacked title' }),
      await a.patch(`/listings/${id}/availability`, { availability: 'out' }),
      await a.post(`/listings/${id}/submit`),
      await a.post(`/listings/${id}/withdraw`),
      await a.upload(`/listings/${id}/photos`, 'photo', [png()]),
      await a.del(`/listings/${id}/photos/whatever.png`),
      await a.get('/listings/not-an-id'),
    ];
    expect(tries.map((t) => t.status)).toEqual(Array(tries.length).fill(404));
    expect((await a.get('/listings')).body.listings).toEqual([]);
    const after = await SupplierListing.findById(id).lean();
    expect(after).toMatchObject({ title: LISTING.title, status: 'draft', rev: 0, availability: 'in', images: [] });
  });

  test('every edit bumps rev; a no-op does not; a stale rev is refused', async () => {
    const { api } = await makeSupplier();
    const { id } = (await api.post('/listings', LISTING)).body.listing;
    const one = await api.patch(`/listings/${id}`, { title: 'Brake pads (front axle)' });
    expect(one.body.listing.rev).toBe(1);
    const noop = await api.patch(`/listings/${id}`, { title: 'Brake pads (front axle)' });
    expect(noop.body.listing.rev).toBe(1);
    const two = await api.patch(`/listings/${id}`, { description: 'Ceramic', rev: 1 });
    expect(two.body.listing.rev).toBe(2);
    const stale = await api.patch(`/listings/${id}`, { description: 'Old screen', rev: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE');
    expect((await api.patch(`/listings/${id}`, { price: 1 })).body.code).toBe('UNKNOWN_FIELDS');
  });

  test('photos: up to 6, signed URLs in the view, submit needs one, remove works', async () => {
    const { api } = await makeSupplier();
    const { id } = (await api.post('/listings', LISTING)).body.listing;
    const noPhoto = await api.post(`/listings/${id}/submit`);
    expect(noPhoto.body.code).toBe('INCOMPLETE');
    expect((await api.upload(`/listings/${id}/photos`, 'photo', [{ buffer: PDF, name: 'x.pdf', type: 'application/pdf' }])).status).toBe(400);
    const up = await api.upload(`/listings/${id}/photos`, 'photo', [png('1.png'), png('2.png')]);
    expect(up.status).toBe(200);
    expect(up.body.listing.images).toHaveLength(2);
    expect(up.body.listing.images[0].url).toMatch(/^https:\/\/.*X-Amz-Signature=/);
    expect(up.body.listing.rev).toBe(1);
    const tooMany = await api.upload(`/listings/${id}/photos`, 'photo', [1, 2, 3, 4, 5].map((n) => png(`${n}.png`)));
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.code).toBe('TOO_MANY_PHOTOS');
    const photoId = up.body.listing.images[0].key.split('/').pop();
    const removed = await api.del(`/listings/${id}/photos/${photoId}`);
    expect(removed.body.listing.images).toHaveLength(1);
    expect(stored.size).toBe(1);
    const sent = await api.post(`/listings/${id}/submit`);
    expect(sent.body.listing.status).toBe('submitted');
    expect((await api.post(`/listings/${id}/submit`)).status).toBe(200); // double tap
  });
});

describe('listings: keyset pagination', () => {
  test('pages walk every row once, newest first, ties broken by _id; bounds enforced', async () => {
    const { account, api } = await makeSupplier();
    const base = Date.now();
    const docs = [];
    for (let i = 0; i < 7; i += 1) {
      // 3 rows share one updatedAt to exercise the _id tie-break.
      docs.push({ ...LISTING, title: `Item ${i}`, supplierAccount: account._id, updatedAt: new Date(base - (i < 3 ? 0 : i) * 1000) });
    }
    await SupplierListing.collection.insertMany(docs.map((d) => ({ ...d, status: 'draft', rev: 0, images: [], createdAt: new Date() })));
    const { account: other } = await makeSupplier();
    await SupplierListing.create({ ...LISTING, supplierAccount: other._id });

    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      // eslint-disable-next-line no-await-in-loop
      const res = await api.get(`/listings?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.listings.map((l) => l.id));
      cursor = res.body.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(7);
    expect(seen).toHaveLength(7);
    const expected = (await SupplierListing.find({ supplierAccount: account._id }).sort({ updatedAt: -1, _id: -1 }).lean()).map((d) => String(d._id));
    expect(seen).toEqual(expected);

    const exact = await api.get('/listings?limit=7');
    expect(exact.body.nextCursor).toBeNull(); // exactly a full page → no phantom next page
    expect((await api.get('/listings?status=live')).body.listings).toEqual([]);
    expect((await api.get('/listings?limit=51')).status).toBe(400);
    expect((await api.get('/listings?limit=0')).status).toBe(400);
    expect((await api.get('/listings?cursor=garbage')).status).toBe(400);
    expect((await api.get('/listings?status=bogus')).status).toBe(400);
    // A cursor from a row that no longer exists still pages from its position.
    const ghost = encodeCursor({ updatedAt: new Date(base - 3500), _id: '000000000000000000000000' });
    expect((await api.get(`/listings?cursor=${ghost}`)).body.listings.map((l) => l.title)).toEqual(['Item 4', 'Item 5', 'Item 6']);
  });
});

describe('live listings: price reviews and stock', () => {
  test('a cost change raises ONE pending review and never touches Product.price', async () => {
    const { account, api } = await makeSupplier();
    const { listing, product } = await liveListing(account);
    const res = await api.patch(`/listings/${listing._id}`, { costPaise: 200000 });
    expect(res.status).toBe(200);
    expect(res.body.listing.rev).toBe(4);
    await api.patch(`/listings/${listing._id}`, { costPaise: 210000 });
    const rows = await SupplierPriceReview.find({ listing: listing._id }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'pending', oldCostPaise: 180000, newCostPaise: 210000, gstPct: 18, priceAtRaise: 3000, marginBp: 3000,
      suggestedPrice: suggestSellingPrice({ costPaise: 210000, gstPct: 18, marginBp: 3000 }),
    });
    const p = await Product.findById(product._id).lean();
    expect(p.price).toBe(3000);
    expect(p.isActive).toBe(true);
  });

  test('two concurrent cost edits → exactly one pending review holding the final cost', async () => {
    const { account, api } = await makeSupplier();
    const { listing, product } = await liveListing(account);
    const results = await Promise.all([
      api.patch(`/listings/${listing._id}`, { costPaise: 190000 }),
      api.patch(`/listings/${listing._id}`, { costPaise: 220000 }),
      api.patch(`/listings/${listing._id}`, { gstPct: 28 }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const final = await SupplierListing.findById(listing._id).lean();
    expect(final.rev).toBe(6);
    const pending = await SupplierPriceReview.find({ listing: listing._id, status: 'pending' }).lean();
    expect(pending).toHaveLength(1);
    expect(pending[0].newCostPaise).toBe(final.costPaise);
    expect(pending[0].gstPct).toBe(final.gstPct);
    expect((await Product.findById(product._id).lean()).price).toBe(3000);
  });

  test('a cost change on a draft listing raises no review', async () => {
    const { api } = await makeSupplier();
    const { id } = (await api.post('/listings', LISTING)).body.listing;
    await api.patch(`/listings/${id}`, { costPaise: 1 });
    expect(await SupplierPriceReview.countDocuments()).toBe(0);
  });

  test('availability on a live drivesStock listing pushes Product.stock and purges cache', async () => {
    const { account, api } = await makeSupplier();
    const { listing, product } = await liveListing(account);
    const res = await api.patch(`/listings/${listing._id}/availability`, { availability: 'low' });
    expect(res.status).toBe(200);
    expect(res.body.listing.availability).toBe('low');
    expect(res.body.listing.rev).toBe(3); // a stock toggle is not a content edit
    const p = await Product.findById(product._id).lean();
    expect(p.stock).toBe('low');
    expect(p.isActive).toBe(true);
    expect(purges).toContainEqual(['products']);
    expect(revalidations).toContainEqual(expect.arrayContaining([`product:${product.slug}`]));
    expect((await api.patch(`/listings/${listing._id}/availability`, { availability: 'backorder' })).status).toBe(400);
  });

  test('a live listing that does not drive stock leaves Product.stock alone', async () => {
    const { account, api } = await makeSupplier();
    const { listing, product } = await liveListing(account, { drivesStock: false });
    await api.patch(`/listings/${listing._id}/availability`, { availability: 'out' });
    expect((await Product.findById(product._id).lean()).stock).toBe('in');
    expect(purges).toEqual([]);
  });

  test('editing words/photos of a live listing flags it for procurement', async () => {
    const { account, api } = await makeSupplier();
    const { listing } = await liveListing(account);
    await api.patch(`/listings/${listing._id}`, { title: 'Better title here' });
    expect((await SupplierListing.findById(listing._id).lean()).editedSinceLive).toBe(true);
  });

  test('withdraw of a live listing → stock out, pending review superseded, isActive kept; retry is safe', async () => {
    const { account, api } = await makeSupplier();
    const { listing, product } = await liveListing(account);
    await api.patch(`/listings/${listing._id}`, { costPaise: 200000 });
    const res = await api.post(`/listings/${listing._id}/withdraw`);
    expect(res.status).toBe(200);
    expect(res.body.listing.status).toBe('withdrawn');
    const p = await Product.findById(product._id).lean();
    expect(p).toMatchObject({ stock: 'out', isActive: true, price: 3000 });
    expect((await SupplierPriceReview.findOne({ listing: listing._id }).lean()).status).toBe('superseded');
    expect((await api.post(`/listings/${listing._id}/withdraw`)).status).toBe(200);
    expect((await api.patch(`/listings/${listing._id}`, { title: 'Back again?' })).body.code).toBe('LISTING_LOCKED');
  });
});
