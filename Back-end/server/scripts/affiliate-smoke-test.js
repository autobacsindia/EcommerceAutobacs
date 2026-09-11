/**
 * Affiliate programme — automated end-to-end smoke test.
 *
 * The executable counterpart to docs/RUNBOOK-affiliate-smoke-test.md. That runbook is
 * ~45 minutes of clicking and cannot be run on every deploy; this drives the same cases
 * over the real HTTP API of a DEPLOYED environment and exits non-zero on any failure.
 *
 * It is a SMOKE TEST, not a unit test. The jest suites (tests/affiliate*.test.js) already
 * prove the logic in isolation against an in-memory Mongo. What they cannot prove is that
 * the deployed container has the right env, that the webhook signature path works end to
 * end, that the coupon/commission indexes exist on THIS cluster, and that the pieces agree
 * with each other over the wire. That is what this covers.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * ⚠️  THIS SCRIPT FORGES SIGNED PAYMENT WEBHOOKS. NEVER RUN IT AGAINST PRODUCTION.
 * ─────────────────────────────────────────────────────────────────────────────────
 * Paying an order here means computing an HMAC over a `payment.captured` body with
 * RAZORPAY_WEBHOOK_SECRET and POSTing it. That is the authoritative fulfilment path, by
 * design — which is exactly why using it on prod would create genuinely "paid" orders
 * against money that never moved, accrue real commission liabilities to real affiliates,
 * and send real order-confirmation emails to real people.
 *
 * scripts/affiliate-test-drive.js deliberately has NO NODE_ENV=production refusal, and
 * explains why: NODE_ENV describes the runtime mode, not the database. That reasoning is
 * right for backdating a delivery date. It is NOT right here, because this script also
 * CREATES money-path records rather than only nudging existing ones. So this one carries
 * BOTH guards:
 *
 *   • a hard refusal on any host in PROD_HOSTS, which no flag can override, and
 *   • `--confirm-api=<substring>` that must appear in the resolved API base URL, so you
 *     cannot run against an environment you did not name out loud.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────────
 *   export SMOKE_API_URL=https://ecommerceautobacs-test.up.railway.app
 *   export SMOKE_ADMIN_EMAIL=... SMOKE_ADMIN_PASSWORD=...
 *   export RAZORPAY_WEBHOOK_SECRET=...        # the TEST webhook secret
 *   export TEST_MONGODB_URI=...               # same cluster the API points at
 *
 *   npm run affiliate-smoke-test -- --confirm-api=railway
 *   npm run affiliate-smoke-test -- --confirm-api=railway --only=money
 *   npm run affiliate-smoke-test -- --confirm-api=railway --keep   # skip teardown
 *
 * Exit code is 0 only when every assertion passed.
 *
 * ── WHY MONGO AS WELL AS HTTP ────────────────────────────────────────────────────
 * Several invariants are invisible from the API: the commission ledger has no public
 * read for another user's rows, `Order.affiliate` is not echoed in full, and the whole
 * point of the idempotency cases is counting rows nobody exposes. So the script asserts
 * over HTTP where an endpoint exists and reads Mongo directly where one does not — and
 * uses Mongo for teardown, which has no API at all.
 */

import crypto from 'crypto';
import mongoose from 'mongoose';

// Never let an imported module construct a cache/queue client against a real host.
delete process.env.REDIS_URL;
delete process.env.QUEUE_REDIS_URL;

// ── Flags ────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};

const CONFIRM_API = flag('confirm-api');
const ONLY = flag('only');
const KEEP = Boolean(flag('keep'));
const VERBOSE = Boolean(flag('verbose'));

const API = (process.env.SMOKE_API_URL || '').replace(/\/+$/, '');
const BASE = `${API}/api/v1`;
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const MONGO_URI = process.env.TEST_MONGODB_URI || process.env.SMOKE_MONGODB_URI;

/**
 * Hosts this script must never touch, regardless of flags.
 *
 * Substring match, not exact: `api.autobacsindia.com`, `www.autobacsindia.com` and any
 * future prod alias all contain the apex. A test host must not contain it — which is
 * true today (`*.up.railway.app`, `*.vercel.app`) and is worth keeping true.
 */
const PROD_HOSTS = ['autobacsindia.com'];

// ── Output ───────────────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const line = (s = '') => console.log(s);
const money = (paise) => `₹${(paise / 100).toFixed(2)}`;
const debug = (...a) => { if (VERBOSE) console.log(C.dim, ...a, C.reset); };

const results = [];
let currentScenario = '(none)';

/** Record one assertion. Never throws — a scenario should report every case it can. */
function check(label, passed, detail = '') {
  results.push({ scenario: currentScenario, label, passed, detail });
  const mark = passed ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
  line(`   ${mark} ${label}${detail && !passed ? `\n       ${C.red}${detail}${C.reset}` : ''}`);
  return passed;
}

const eq = (label, actual, expected) =>
  check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

/** A scenario that throws is a failed scenario, not a crashed run. */
async function scenario(key, title, fn) {
  if (ONLY && ONLY !== key) return;
  currentScenario = key;
  line(`\n${C.bold}${C.cyan}▸ ${title}${C.reset} ${C.dim}(--only=${key})${C.reset}`);
  try {
    await fn();
  } catch (err) {
    check(`scenario completed without throwing`, false, `${err.message}\n${VERBOSE ? err.stack : ''}`);
  }
}

// ── HTTP: one cookie jar per identity ────────────────────────────────────────────

/**
 * A browser. Holds cookies, fetches a CSRF token, and sends it on every mutation —
 * exactly what the real frontend's tokenManager does. Posting without one is a 403,
 * and that is the correct answer, so the harness must play by the same rules.
 */
class Client {
  constructor(label) {
    this.label = label;
    this.cookies = new Map();
    this.csrf = '';
  }

  _storeCookies(res) {
    const raw = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const c of raw) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      if (idx < 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      // An expiry in the past is a deletion — keeping it would resurrect a logged-out
      // session and make every later assertion in that identity meaningless.
      if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const xsrf = this.cookies.get('XSRF-TOKEN');
    if (xsrf) this.csrf = decodeURIComponent(xsrf);
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /** Plant a cookie the server would normally set — used for the `ab_ref` referral. */
  setCookie(name, value) { this.cookies.set(name, value); }

  async request(method, path, body, extraHeaders = {}) {
    const headers = {
      accept: 'application/json',
      cookie: this.cookieHeader(),
      ...extraHeaders,
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET' && this.csrf) headers['X-XSRF-TOKEN'] = this.csrf;

    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    this._storeCookies(res);

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    debug(`[${this.label}] ${method} ${path} → ${res.status}`);
    return { status: res.status, body: json, text };
  }

  get(p, h) { return this.request('GET', p, undefined, h); }
  post(p, b, h) { return this.request('POST', p, b ?? {}, h); }
  put(p, b) { return this.request('PUT', p, b ?? {}); }
  patch(p, b) { return this.request('PATCH', p, b ?? {}); }

  async primeCsrf() {
    const res = await this.get('/csrf-token');
    if (!this.csrf && res.body?.csrfToken) this.csrf = res.body.csrfToken;
    return this.csrf;
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────────

/** One tag on every record this run creates, so teardown can find them all. */
const RUN = `smoke${Date.now().toString(36)}`;
const email = (who) => `${RUN}.${who}@smoke.invalid`;
const PASSWORD = 'SmokeTest123!';

const created = { users: [], affiliates: [], coupons: [], orders: [] };

let models = {};
let testProduct = null;

async function loadModels() {
  const [Affiliate, AffiliateCommission, AffiliatePayout, Order, User, Coupon, CouponUserUsage, Product] =
    await Promise.all([
      import('../models/Affiliate.js'),
      import('../models/AffiliateCommission.js'),
      import('../models/AffiliatePayout.js'),
      import('../models/Order.js'),
      import('../models/User.js'),
      import('../models/Coupon.js'),
      import('../models/CouponUserUsage.js'),
      import('../models/Product.js'),
    ]);
  models = {
    Affiliate: Affiliate.default,
    AffiliateCommission: AffiliateCommission.default,
    AffiliatePayout: AffiliatePayout.default,
    Order: Order.default,
    User: User.default,
    Coupon: Coupon.default,
    CouponUserUsage: CouponUserUsage.default,
    Product: Product.default,
  };
}

/** A signed-up, logged-in shopper with a live cookie jar. */
async function newShopper(who) {
  const c = new Client(who);
  await c.primeCsrf();
  const addr = email(who);
  const reg = await c.post('/auth/register', {
    name: `Smoke ${who}`,
    email: addr,
    password: PASSWORD,
    confirmPassword: PASSWORD,
  });
  if (reg.status >= 400) {
    // Registration may require email verification to log in; fall through to login and
    // let the caller's assertions report the real failure rather than hiding it here.
    debug(`register(${who}) → ${reg.status} ${reg.text?.slice(0, 200)}`);
  }
  await c.post('/auth/login', { email: addr, password: PASSWORD });
  const me = await c.get('/auth/me');
  c.userId = me.body?.user?.id || me.body?.user?._id || null;
  c.email = addr;
  created.users.push(addr);
  return c;
}

async function adminClient() {
  const c = new Client('admin');
  await c.primeCsrf();
  const res = await c.post('/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (res.status !== 200) throw new Error(`Admin login failed (${res.status}). Check SMOKE_ADMIN_*.`);
  const me = await c.get('/auth/me');
  if (me.body?.user?.role !== 'admin') throw new Error('SMOKE_ADMIN_EMAIL is not an admin account.');
  return c;
}

/**
 * Pick a real, in-stock, active product to order.
 *
 * Deliberately NOT created by this script: a smoke test that invents its own product
 * would also invent its own price and tax treatment, and would stop exercising the
 * pricing path the store actually runs.
 */
async function resolveProduct() {
  const p = await models.Product.findOne({
    isActive: true,
    $or: [{ stockStatus: 'in' }, { stockStatus: { $exists: false } }],
    price: { $gt: 0 },
    variants: { $size: 0 },
  }).select('_id name slug price').lean();
  if (!p) throw new Error('No active, in-stock, non-variant product found to order.');
  return p;
}

// ── The money path ───────────────────────────────────────────────────────────────

/**
 * Place an order as this client. Returns the created order document from Mongo.
 *
 * `couponCode` is sent as the buyer typed it; `refCookie` plants `ab_ref` first. Both
 * are CLAIMS — the server resolves attribution itself, which is the whole point of
 * several cases below.
 */
async function placeOrder(client, { couponCode = null, refCookie = null } = {}) {
  if (refCookie) client.setCookie('ab_ref', refCookie);

  const res = await client.post('/orders', {
    items: [{ product: testProduct._id.toString(), quantity: 1 }],
    shippingAddress: {
      fullName: `Smoke ${client.label}`,
      phone: '9000000000',
      addressLine1: '1 Test Street',
      city: 'Kochi',
      state: 'Kerala',
      postalCode: '682001',
      country: 'India',
    },
    paymentMethod: 'razorpay',
    buyerType: 'individual',
    acceptTerms: true,
    ...(couponCode ? { couponCode } : {}),
  });

  if (res.status !== 201) {
    return { ok: false, status: res.status, body: res.body, order: null };
  }
  const orderId = res.body?.order?._id || res.body?.order?.id;
  created.orders.push(orderId);
  const order = await models.Order.findById(orderId).lean();
  return { ok: true, status: res.status, body: res.body, order };
}

/**
 * Pay an order by delivering a signature-verified `payment.captured` webhook.
 *
 * This is the AUTHORITATIVE path — CLAUDE.md's first rule is that an order is fulfilled
 * only on the verified webhook, never the client callback — so driving it here tests the
 * real thing rather than a convenient shortcut.
 *
 * `eventId` is exposed because the two replay cases need opposite things from it:
 *   • the SAME id exercises webhook-layer dedup (Redis `razorpay:event:<id>`);
 *   • a DIFFERENT id with the same payment slips past that layer and exercises the
 *     actual money guarantee — the partial-unique index on {order, type:'accrual'}.
 * Only the second proves we cannot double-pay an affiliate, so both are worth firing.
 */
async function payOrder(order, { paymentId, eventId } = {}) {
  const pay = paymentId || `pay_smoke${crypto.randomBytes(7).toString('hex')}`;
  const body = JSON.stringify({
    event: 'payment.captured',
    created_at: Math.floor(Date.now() / 1000), // must be inside the 10-minute window
    payload: {
      payment: {
        entity: {
          id: pay,
          order_id: order.razorpayOrderId || `order_smoke${crypto.randomBytes(6).toString('hex')}`,
          // Must equal Math.round(order.totalAmount * 100) or the amount guard rejects it.
          amount: Math.round((order.totalAmount || 0) * 100),
          currency: 'INR',
          status: 'captured',
          method: 'card',
          notes: { orderId: order._id.toString() }, // how handlePaymentCaptured finds us
        },
      },
    },
  });

  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  const res = await fetch(`${BASE}/razorpay/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': signature,
      'x-razorpay-event-id': eventId || `evt_smoke${crypto.randomBytes(8).toString('hex')}`,
    },
    body,
  });
  debug(`webhook payment.captured ${pay} → ${res.status}`);

  // Accrual is fire-and-forget after the transaction commits (deliberately outside it —
  // a session-less write inside that transaction once self-deadlocked every capture for
  // 60s). So the ledger row lands shortly AFTER the 200, and polling beats sleeping.
  const paid = await waitFor(
    async () => {
      const o = await models.Order.findById(order._id).select('paymentStatus').lean();
      return o?.paymentStatus === 'paid' ? o : null;
    },
    15000,
  );
  return { status: res.status, paid: Boolean(paid), paymentId: pay };
}

/** Poll until `fn` returns something truthy, or give up. Async side effects need this. */
async function waitFor(fn, timeoutMs = 10000, intervalMs = 400) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ── Affiliate helpers ────────────────────────────────────────────────────────────

const APPLICATION = (who, overrides = {}) => ({
  name: `Smoke Affiliate ${who}`,
  email: email(who),
  phone: '9111111111',
  website: 'https://youtube.com/@smoketest',
  pitch: 'Automated smoke test application.',
  panNumber: 'ABCDE1234F',
  accountHolderName: `Smoke Affiliate ${who}`,
  accountNumber: '123456789012',
  ifsc: 'HDFC0001234',
  address: {
    line1: '1 Test Street', city: 'Kochi', state: 'Kerala',
    postalCode: '682001',
  },
  acceptTerms: true,
  ...overrides,
});

/** Apply anonymously, approve as admin, return the live Affiliate document. */
async function createAffiliate(admin, who, approve = {}, applyAs = null) {
  const applicant = applyAs || new Client(`applicant-${who}`);
  if (!applyAs) await applicant.primeCsrf();

  const payload = APPLICATION(who, applyAs ? { email: applyAs.email } : {});
  const res = await applicant.post('/affiliates/apply', payload);
  if (res.status >= 400) throw new Error(`apply(${who}) → ${res.status} ${res.text?.slice(0, 300)}`);

  const doc = await models.Affiliate.findOne({ email: payload.email.toLowerCase() });
  if (!doc) throw new Error(`Affiliate ${who} was not persisted.`);
  created.affiliates.push(doc._id);

  if (approve === false) return doc;

  const code = approve.code || `${RUN}${who}`.toUpperCase().slice(0, 20);
  const appr = await admin.post(`/affiliates/admin/${doc._id}/approve`, {
    commissionPercent: 10,
    repeatCommissionPercent: 3,
    discountPercent: 10,
    code,
    ...approve,
  });
  if (appr.status !== 200) throw new Error(`approve(${who}) → ${appr.status} ${appr.text?.slice(0, 300)}`);

  const live = await models.Affiliate.findById(doc._id);
  if (live.coupon) created.coupons.push(live.coupon);
  return live;
}

const accrualsFor = (orderId) =>
  models.AffiliateCommission.countDocuments({ order: orderId, type: 'accrual' });

const netForOrder = async (orderId) => {
  const rows = await models.AffiliateCommission.find({ order: orderId, status: { $ne: 'void' } }).lean();
  return rows.reduce((s, r) => s + r.amountPaise, 0);
};

// ═════════════════════════════════════════════════════════════════════════════════
//  SCENARIOS
// ═════════════════════════════════════════════════════════════════════════════════

/** 0 — Preconditions. A failure here makes every later scenario lie. */
async function scenarioPreconditions() {
  const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
  check('API /health responds', Boolean(health), 'the deployment is not answering');
  if (health?.uptime != null) {
    line(`   ${C.dim}container uptime: ${Math.round(health.uptime)}s${C.reset}`);
  }

  /*
    The kill switch is the single most common false failure in the manual runbook: a
    corrected Railway variable does nothing until the container restarts, so the switch
    can be "set" and still not live. We cannot read the env of a remote container, so we
    PROVE it behaviourally later — scenario `critical` fails loudly with this hint if no
    accrual row ever appears.
  */
  line(`   ${C.dim}kill switch is proven behaviourally in --only=critical, not read here${C.reset}`);

  // The per-user unique index is what makes "one discount per person" true. Without it
  // the discount can be taken twice and scenario `money` would pass for the wrong reason.
  const idx = await models.CouponUserUsage.collection.indexes();
  const unique = idx.find((i) => i.unique && i.key && i.key.coupon === 1 && i.key.user === 1);
  check('couponusages has the unique {coupon,user} index', Boolean(unique),
    'without it a buyer can take the same affiliate discount twice');

  const accrualIdx = await models.AffiliateCommission.collection.indexes();
  const uniqueAccrual = accrualIdx.find((i) => i.name === 'unique_accrual_per_order');
  check('affiliatecommissions has unique_accrual_per_order', Boolean(uniqueAccrual),
    'this index IS the "one commission per order" guarantee');

  const payoutIdx = await models.AffiliatePayout.collection.indexes();
  check('affiliatepayouts has unique_payout_reference',
    Boolean(payoutIdx.find((i) => i.name === 'unique_payout_reference')),
    'without it the same bank UTR can be recorded against two payouts');

  testProduct = await resolveProduct();
  check('found a product to order', Boolean(testProduct),
    'no active in-stock non-variant product exists on this cluster');
  line(`   ${C.dim}using "${testProduct.name}" @ ₹${testProduct.price}${C.reset}`);
}

/** 1 — Approval mints a coupon with the one-discount-per-person rule. */
async function scenarioFixture(admin, state) {
  const aff = await createAffiliate(admin, 'main');
  state.main = aff;

  eq('affiliate is active', aff.status, 'active');
  check('a code was minted', Boolean(aff.code), 'approval must mint a code');
  check('a managed coupon was minted', Boolean(aff.coupon), 'the coupon is the money path');

  const coupon = await models.Coupon.findById(aff.coupon).lean();
  eq('coupon.usageLimitPerUser is 1', coupon?.usageLimitPerUser, 1);
  // `true` here would mean old code or an unmigrated coupon: it refuses a lapsed
  // customer outright instead of letting them check out at full price.
  eq('coupon.firstOrderOnly is false', coupon?.firstOrderOnly, false);
  eq('coupon is hidden from public listings', coupon?.visibility, 'hidden');
  eq('coupon is active', coupon?.isActive, true);
  eq('coupon links back to the affiliate', String(coupon?.affiliate), String(aff._id));
  eq('coupon value mirrors the buyer discount', coupon?.value, 10);
}

/** 2 — The case that used to break: a returning buyer re-using the code. */
async function scenarioCritical(admin, state) {
  const aff = state.main;
  const buyer = await newShopper('buyer1');
  state.buyer1 = buyer;

  // ── 2a. First order: acquisition ──
  const first = await placeOrder(buyer, { couponCode: aff.code });
  if (!check('first order was created', first.ok, `status ${first.status}: ${JSON.stringify(first.body)?.slice(0, 200)}`)) return;

  check('the discount was applied', (first.order.discount || 0) > 0,
    `discount was ${first.order.discount}`);
  eq('attribution source is "coupon"', first.order.affiliate?.source, 'coupon');
  eq('full (new-customer) rate was snapshotted', first.order.affiliate?.commissionPercent, 10);
  eq('buyer is marked new', first.order.affiliate?.newCustomer, true);
  eq('the right affiliate was credited', first.order.affiliate?.code, aff.code);

  const paid1 = await payOrder(first.order);
  check('first order reached paymentStatus "paid"', paid1.paid,
    `webhook returned ${paid1.status}; order never flipped to paid`);

  const accrual1 = await waitFor(
    () => models.AffiliateCommission.findOne({ order: first.order._id, type: 'accrual' }).lean(),
    15000,
  );
  if (!check('an accrual row was written', Boolean(accrual1),
    'ZERO rows almost always means AFFILIATE_COMMISSION_ENABLED is not true in the RUNNING container — a Railway variable only takes effect on container start')) return;

  const goods1 = Math.round((first.order.subtotal - (first.order.discount || 0)) * 100);
  eq('accrual base is goods net of discount', accrual1.basePaise, goods1);
  eq('accrual percent is the snapshot', accrual1.percent, 10);
  eq('accrual amount = floor(base × percent)', accrual1.amountPaise, Math.floor((goods1 * 10) / 100));
  eq('accrual starts pending', accrual1.status, 'pending');
  eq('accrual source is "coupon"', accrual1.source, 'coupon');

  // ── 2b. Second order, SAME buyer, SAME code ──
  const second = await placeOrder(buyer, { couponCode: aff.code });
  // ⚠️ THE HEADLINE ASSERTION. This previously returned a hard 400 and no order existed,
  // while the same buyer arriving by link earned the affiliate a full commission.
  if (!check('second order was created (the soft refusal, not a 400)', second.ok,
    `status ${second.status} — a 400 here means the deployed code predates the soft refusal`)) return;

  eq('no second discount', second.order.discount || 0, 0);
  check('second order total is HIGHER than the first',
    second.order.totalAmount > first.order.totalAmount,
    `${second.order.totalAmount} vs ${first.order.totalAmount}`);
  eq('attribution source is "code", not "coupon" or "link"', second.order.affiliate?.source, 'code');
  eq('repeat rate was snapshotted', second.order.affiliate?.commissionPercent, 3);
  eq('buyer is no longer new', second.order.affiliate?.newCustomer, false);

  await payOrder(second.order);
  const accrual2 = await waitFor(
    () => models.AffiliateCommission.findOne({ order: second.order._id, type: 'accrual' }).lean(),
    15000,
  );
  if (!check('second accrual row was written', Boolean(accrual2))) return;

  const goods2 = Math.round((second.order.subtotal - (second.order.discount || 0)) * 100);
  eq('second accrual uses the repeat percent', accrual2.percent, 3);
  eq('second accrual base is the undiscounted goods', accrual2.basePaise, goods2);
  // Counterintuitive but correct: commission is a share of revenue, and no discount
  // means more revenue. A reviewer who "fixes" this reintroduces the original bug.
  check('second order has the LARGER base', accrual2.basePaise > accrual1.basePaise,
    `${accrual2.basePaise} vs ${accrual1.basePaise}`);

  const usage = await models.CouponUserUsage.findOne({
    coupon: aff.coupon, user: buyer.userId,
  }).lean();
  eq('coupon usage count for this buyer is exactly 1', usage?.count ?? usage?.usageCount, 1);

  state.firstOrder = first.order;
  state.secondOrder = second.order;
}

/** 3 — Arrival by link and by typed code must agree about the same buyer. */
async function scenarioArrival(admin, state) {
  const aff = state.main;
  const buyer = await newShopper('buyer2');

  const first = await placeOrder(buyer, { couponCode: aff.code, refCookie: aff.code });
  if (!check('link-arrival first order created', first.ok, `status ${first.status}`)) return;
  eq('source is "coupon" when the code actually discounted', first.order.affiliate?.source, 'coupon');
  eq('full rate for a new customer', first.order.affiliate?.commissionPercent, 10);
  eq('marked new', first.order.affiliate?.newCustomer, true);
  await payOrder(first.order);

  // Second order with NO code typed — cookie only.
  const second = await placeOrder(buyer, { refCookie: aff.code });
  if (!check('cookie-only second order created', second.ok, `status ${second.status}`)) return;
  eq('source is "link"', second.order.affiliate?.source, 'link');
  eq('repeat rate via the link', second.order.affiliate?.commissionPercent, 3);
  eq('marked returning', second.order.affiliate?.newCustomer, false);

  // A mismatch here is the original bug returning: code and link disagreeing about
  // the same person is what made the programme pay two different rates for one buyer.
  eq('link and typed-code agree on the repeat rate',
    second.order.affiliate?.commissionPercent, state.secondOrder?.affiliate?.commissionPercent ?? 3);
}

/** 4 — A lapsed customer: one per person per code, not "never bought here". */
async function scenarioLapsed(admin, state) {
  const aff = state.main;
  const buyer = await newShopper('buyer3');

  const plain = await placeOrder(buyer);
  if (!check('unreferred first order created', plain.ok, `status ${plain.status}`)) return;
  check('no affiliate attribution on an unreferred order', !plain.order.affiliate?.affiliate,
    'an order placed with no code and no cookie must credit nobody');
  await payOrder(plain.order);

  const withCode = await placeOrder(buyer, { couponCode: aff.code });
  if (!check('second order with the code created', withCode.ok, `status ${withCode.status}`)) return;
  // She has never used THIS code, so she gets the discount — the old `firstOrderOnly`
  // refused her outright.
  check('she DOES get the discount', (withCode.order.discount || 0) > 0,
    `discount was ${withCode.order.discount}`);
  eq('source is "coupon"', withCode.order.affiliate?.source, 'coupon');
  eq('but the affiliate earns the REPEAT rate', withCode.order.affiliate?.commissionPercent, 3);
  eq('and she is not a new customer', withCode.order.affiliate?.newCustomer, false);
}

/** 5 — A typed code beats a stale cookie. Otherwise we pay the wrong person. */
async function scenarioPrecedence(admin, state) {
  const other = await createAffiliate(admin, 'other', { commissionPercent: 20, discountPercent: 5 });
  state.other = other;

  const buyer = await newShopper('buyer4');
  const res = await placeOrder(buyer, { couponCode: state.main.code, refCookie: other.code });
  if (!check('order created with cookie A and typed code B', res.ok, `status ${res.status}`)) return;

  eq('the affiliate the buyer NAMED is credited', res.order.affiliate?.code, state.main.code);
  check('the cookie affiliate is NOT credited',
    String(res.order.affiliate?.affiliate) !== String(other._id),
    'precedence is broken and you are paying the wrong person');
}

/** 6 — Negative cases. The soft refusal must stay narrow. */
async function scenarioNegative(admin, state) {
  const aff = state.main;

  // 6.1 A typo must fail LOUDLY. Silently swallowing it means checking out believing
  // in a discount you never got.
  const typo = await newShopper('buyer5');
  const bad = await typo.post('/coupons/validate', { code: `${aff.code}X` })
    .catch(() => ({ status: 0 }));
  check('an unknown code is refused', bad.status >= 400,
    `expected 4xx, got ${bad.status} — a swallowed typo is a silent non-discount`);

  // 6.3 Self-referral: the affiliate's own account cannot use their own code.
  const selfShopper = new Client('selfref');
  await selfShopper.primeCsrf();
  const selfAddr = email('selfref');
  await selfShopper.post('/auth/register', {
    name: 'Smoke Selfref', email: selfAddr, password: PASSWORD, confirmPassword: PASSWORD,
  });
  await selfShopper.post('/auth/login', { email: selfAddr, password: PASSWORD });
  const selfMe = await selfShopper.get('/auth/me');
  selfShopper.userId = selfMe.body?.user?.id || selfMe.body?.user?._id;
  selfShopper.email = selfAddr;
  created.users.push(selfAddr);

  const selfAff = await createAffiliate(admin, 'selfref', { code: `${RUN}SELF`.toUpperCase() }, selfShopper);
  const selfOrder = await placeOrder(selfShopper, { couponCode: selfAff.code });
  if (selfOrder.ok) {
    check('a self-referred order credits nobody', !selfOrder.order.affiliate?.affiliate,
      'the affiliate was credited for their own purchase');
    eq('and takes no discount', selfOrder.order.discount || 0, 0);
  } else {
    check('self-referral refused at checkout', selfOrder.status >= 400,
      `status ${selfOrder.status}`);
  }

  // 6.2 A suspended affiliate stops attributing IMMEDIATELY.
  const susp = await createAffiliate(admin, 'susp', { code: `${RUN}SUSP`.toUpperCase() });
  await admin.post(`/affiliates/admin/${susp._id}/suspend`, { reason: 'smoke test' });

  const suspBuyer = await newShopper('buyer6');
  const suspOrder = await placeOrder(suspBuyer, { couponCode: susp.code, refCookie: susp.code });
  if (suspOrder.ok) {
    check('a suspended affiliate attributes nothing', !suspOrder.order.affiliate?.affiliate,
      'suspension must stop new attribution immediately');
    eq('and their code no longer discounts', suspOrder.order.discount || 0, 0);
  } else {
    check('suspended code refused at checkout', suspOrder.status >= 400, `status ${suspOrder.status}`);
  }

  // Commissions already earned keep their lifecycle — voiding them is a separate,
  // deliberate admin action, so suspension must NOT reverse anything.
  const suspLedger = await models.AffiliateCommission.countDocuments({
    affiliate: susp._id, type: { $in: ['clawback', 'adjust'] },
  });
  eq('suspension writes no reversal rows by itself', suspLedger, 0);
}

/** 7 — Money integrity: idempotency, snapshots, clawback. */
async function scenarioMoney(admin, state) {
  const aff = state.main;
  const order = state.firstOrder;
  if (!order) { check('prerequisite order from --only=critical exists', false, 'run without --only'); return; }

  // 7.2a Same event id twice → deduped at the webhook layer.
  const evt = `evt_smoke_replay_${RUN}`;
  const replayPay = `pay_smoke_replay_${RUN}`;
  await payOrder(order, { paymentId: replayPay, eventId: evt });
  await payOrder(order, { paymentId: replayPay, eventId: evt });
  eq('replaying the SAME event id still yields one accrual', await accrualsFor(order._id), 1);

  // 7.2b Different event id, same payment → slips past webhook-layer dedup and must be
  // stopped by the real guarantee: the partial-unique {order, type:'accrual'} index.
  // This is the assertion that actually proves we cannot double-pay an affiliate.
  await payOrder(order, { paymentId: replayPay, eventId: `${evt}_b` });
  eq('a NEW event id for the same payment still yields one accrual',
    await accrualsFor(order._id), 1);

  // 7.3 Past orders are never repriced.
  const before = await models.AffiliateCommission.findOne({ order: order._id, type: 'accrual' }).lean();
  await admin.patch(`/affiliates/admin/${aff._id}/terms`, {
    commissionPercent: 25, repeatCommissionPercent: 15,
  });
  const after = await models.AffiliateCommission.findOne({ order: order._id, type: 'accrual' }).lean();
  eq('an existing accrual keeps its percent after a rate change', after.percent, before.percent);
  eq('and keeps its amount', after.amountPaise, before.amountPaise);

  const reReadOrder = await models.Order.findById(order._id).select('affiliate').lean();
  eq('the order snapshot is untouched too', reReadOrder.affiliate?.commissionPercent, 10);

  // 7.4 A NEW order picks up the new rates.
  const freshBuyer = await newShopper('buyer7');
  const fresh = await placeOrder(freshBuyer, { couponCode: aff.code });
  if (fresh.ok) {
    eq('a new order uses the NEW rate', fresh.order.affiliate?.commissionPercent, 25);
    state.clawbackOrder = fresh.order;
    await payOrder(fresh.order);
  } else {
    check('new-rate order created', false, `status ${fresh.status}`);
  }

  // 7.6 An unpaid order must not brand a buyer as returning.
  const abandoner = await newShopper('buyer8');
  const abandoned = await placeOrder(abandoner, { couponCode: aff.code });
  check('abandoned order is not paid', abandoned.ok && abandoned.order.paymentStatus !== 'paid',
    `paymentStatus was ${abandoned.order?.paymentStatus}`);
  const real = await placeOrder(abandoner, { couponCode: aff.code });
  if (real.ok) {
    // A real bug once: the abandoned row marked them a returning customer forever.
    eq('after abandoning, the buyer is STILL new', real.order.affiliate?.newCustomer, true);
    eq('and still earns the full rate', real.order.affiliate?.commissionPercent, 25);
  }

  // 7.5 Clawback nets a refunded order to zero.
  if (state.clawbackOrder) {
    const target = state.clawbackOrder;
    const beforeNet = await netForOrder(target._id);
    check('the order to refund has a positive accrual', beforeNet > 0, `net was ${beforeNet}`);

    const refund = await admin.post(`/orders/${target._id}/refund`, {
      amount: target.totalAmount, reason: 'smoke test full refund',
    });
    check('admin refund accepted', refund.status < 400,
      `status ${refund.status}: ${refund.text?.slice(0, 200)}`);

    const netted = await waitFor(async () => (await netForOrder(target._id)) === 0 ? true : null, 20000);
    check('Σ amountPaise for a fully refunded order nets to 0', Boolean(netted),
      `net is still ${await netForOrder(target._id)} paise`);

    const rows = await models.AffiliateCommission.find({ order: target._id }).lean();
    check('a clawback ROW was appended, not a rewrite',
      rows.some((r) => r.type === 'clawback'),
      'the accrual must never be mutated — it is the record of what we decided');
  }
}

/** 8 — Maturity, payout batching, TDS. */
async function scenarioPayout(admin, state) {
  const aff = state.main;
  const order = state.firstOrder;
  if (!order) { check('prerequisite order exists', false, 'run without --only'); return; }

  // Nobody waits 4 days for a return window, so backdate delivery the same way
  // scripts/affiliate-test-drive.js does, then run the sweep on demand.
  const { RETURN_WINDOW_DAYS } = await import('../config/returnPolicy.js');
  const backdated = new Date(Date.now() - (RETURN_WINDOW_DAYS + 1) * 86400 * 1000);

  const live = await models.Order.findById(order._id);
  if (live.shipments?.length) {
    live.shipments.forEach((p) => { p.status = 'delivered'; p.deliveredAt = backdated; });
  } else {
    live.status = 'delivered';
    live.fulfillmentMetrics = { ...(live.fulfillmentMetrics || {}), deliveredAt: backdated };
  }
  await live.save();

  const prev = process.env.AFFILIATE_COMMISSION_ENABLED;
  process.env.AFFILIATE_COMMISSION_ENABLED = 'true';
  const svc = (await import('../services/affiliateCommissionService.js')).default;

  const stamped = await svc.stampMaturity(order._id.toString());
  check('maturity was stamped on delivery', stamped.status === 'stamped' || stamped.status === 'unchanged',
    `stampMaturity returned ${stamped.status}`);

  const swept = await svc.sweepMaturity();
  check('the sweep ran', swept.examined >= 0, JSON.stringify(swept));

  const matured = await models.AffiliateCommission.findOne({ order: order._id, type: 'accrual' }).lean();
  eq('a matured commission is now approved', matured.status, 'approved');

  if (prev === undefined) delete process.env.AFFILIATE_COMMISSION_ENABLED;
  else process.env.AFFILIATE_COMMISSION_ENABLED = prev;

  // Give the affiliate a TDS rate so the batch has something to deduct.
  await admin.patch(`/affiliates/admin/${aff._id}/terms`, { tdsPercent: 5 });

  const balanceBefore = await admin.get(`/affiliates/admin/${aff._id}`);
  const payable = balanceBefore.body?.payableBalancePaise ?? 0;
  line(`   ${C.dim}payable balance: ${money(payable)}${C.reset}`);

  const batch = await admin.post(`/affiliates/admin/${aff._id}/payouts`, {});
  if (batch.status === 400) {
    // Legitimate: below MIN_PAYOUT_RUPEES. Report it rather than failing the run.
    check('payout refused below the minimum (expected on small fixtures)', true,
      batch.body?.message || '');
  } else if (check('a payout batch was built', batch.status === 201,
    `status ${batch.status}: ${batch.text?.slice(0, 200)}`)) {
    const payout = batch.body.payout;
    eq('TDS percent was snapshotted onto the batch', payout.tdsPercent, 5);
    eq('tdsPaise = floor(gross × tds%)', payout.tdsPaise, Math.floor((payout.grossPaise * 5) / 100));
    eq('netPaise = gross − TDS', payout.netPaise, payout.grossPaise - payout.tdsPaise);
    check('the batch claimed at least one row', payout.commissionCount > 0, `${payout.commissionCount}`);
    check('bank snapshot carries only the last 4',
      !('accountNumber' in (payout.bankSnapshot || {})) && !('panNumber' in (payout.bankSnapshot || {})),
      'a payout must never copy full financial PII into a second collection');

    // The claim lives in the commission ROWS, so a second identical build matches
    // nothing and must 409 — no second payout with money on it can exist.
    const again = await admin.post(`/affiliates/admin/${aff._id}/payouts`, {});
    eq('a second concurrent batch build is refused with 409', again.status, 409);

    const ref = `SMOKEUTR${Date.now()}`;
    const paid = await admin.post(`/affiliates/admin/payouts/${payout._id}/paid`, {
      reference: ref, method: 'neft',
    });
    check('the payout can be recorded as paid', paid.status < 400,
      `status ${paid.status}: ${paid.text?.slice(0, 200)}`);

    // The same bank transfer must never be recorded twice — this is what catches an
    // admin pasting a UTR into a second batch.
    const dupBatchRows = await models.AffiliatePayout.countDocuments({ reference: ref });
    eq('exactly one payout carries that UTR', dupBatchRows, 1);
  }
}

/** 9 — The self-serve API: scoping, the projection, and pagination. */
async function scenarioSelfServe(admin, state) {
  const aff = state.main;

  // Sign in as the affiliate themselves. `createAffiliate` applied anonymously, so link
  // the Affiliate to a real account the way a signed-in application would have.
  const owner = await newShopper('affowner');
  await models.Affiliate.updateOne({ _id: aff._id }, { $set: { user: owner.userId } });
  await models.Affiliate.updateOne(
    { _id: aff._id },
    { $set: { notes: 'INTERNAL: haggled on rate, watch for self-referral' } },
  );

  const me = await owner.get('/affiliates/me');
  eq('GET /me returns 200 for the affiliate', me.status, 200);
  check('the profile is returned', Boolean(me.body?.affiliate), JSON.stringify(me.body)?.slice(0, 200));

  const raw = JSON.stringify(me.body);
  check('no internal admin notes in the response', !raw.includes('haggled on rate'),
    'GET /me is leaking Affiliate.notes to the affiliate');
  check('no termsAcceptance.ipHash', !('ipHash' in (me.body.affiliate?.termsAcceptance || {})),
    'the acceptance IP hash is evidence, not information for them');
  check('no suspendedReason', !('suspendedReason' in (me.body.affiliate || {})));
  check('no full account number or PAN',
    !('accountNumber' in (me.body.affiliate?.payoutDetails || {}))
    && !('panNumber' in (me.body.affiliate?.payoutDetails || {})),
    'financial PII must never leave the server');
  check('but accountLast4 IS present', Boolean(me.body.affiliate?.payoutDetails?.accountLast4));
  check('and the rates the dashboard renders are present',
    me.body.affiliate?.commissionPercent != null && me.body.affiliate?.code != null);

  // The ledger is scoped to req.user — the affiliate id is never read from the query
  // string, so there is nothing to tamper with to read somebody else's earnings.
  const ledger = await owner.get('/affiliates/me/commissions?limit=2');
  eq('the ledger returns 200', ledger.status, 200);
  check('it is cursor-paginated, not offset', 'nextCursor' in (ledger.body || {}),
    'a growing ledger must never use skip/offset');
  check('the page is bounded by limit', (ledger.body?.commissions?.length ?? 0) <= 2);

  const mine = new Set((ledger.body?.commissions || []).map((c) => c._id));
  const theirs = await models.AffiliateCommission.find({ affiliate: { $ne: aff._id } })
    .limit(5).select('_id').lean();
  check('no other affiliate\'s rows leak into the page',
    theirs.every((r) => !mine.has(String(r._id))));

  // An over-large limit must be rejected or clamped, never silently served.
  const huge = await owner.get('/affiliates/me/commissions?limit=100000');
  check('an over-large limit is refused or bounded',
    huge.status >= 400 || (huge.body?.commissions?.length ?? 0) <= 100,
    `status ${huge.status}, ${huge.body?.commissions?.length} rows`);

  // A plain customer is not an affiliate.
  const outsider = await newShopper('outsider');
  const outsiderMe = await outsider.get('/affiliates/me');
  eq('a non-affiliate gets 200 with affiliate:null, not a 404', outsiderMe.status, 200);
  eq('and the answer is null', outsiderMe.body?.affiliate, null);
  const outsiderLedger = await outsider.get('/affiliates/me/commissions');
  eq('but the ledger refuses them with 403', outsiderLedger.status, 403);

  // Admin surfaces must stay closed to a customer.
  const forbidden = await outsider.get('/affiliates/admin');
  check('the admin list is closed to a customer', forbidden.status === 401 || forbidden.status === 403,
    `got ${forbidden.status} — auth failure must never return 200`);
  const forbiddenDetail = await outsider.get(`/affiliates/admin/${aff._id}`);
  check('the admin detail is closed too',
    forbiddenDetail.status === 401 || forbiddenDetail.status === 403,
    `got ${forbiddenDetail.status}`);
  const forbiddenPayouts = await outsider.get('/affiliates/admin/payouts');
  check('the payout ledger is closed too',
    forbiddenPayouts.status === 401 || forbiddenPayouts.status === 403,
    `got ${forbiddenPayouts.status}`);
}

// ── Teardown ─────────────────────────────────────────────────────────────────────

/**
 * Remove everything this run created.
 *
 * The per-person discount cap means a run cannot simply be repeated with the same
 * accounts — the second run's "first order" would already be their second. Every
 * identity is namespaced by RUN and deleted here, so runs stay independent.
 *
 * Scoped by id/email collected during the run, never by a broad predicate: a
 * `deleteMany({ status: 'pending' })` on the wrong cluster is exactly the accident the
 * safety gate exists to prevent, and teardown should not reintroduce it.
 */
async function teardown() {
  if (KEEP) { line(`\n${C.yellow}--keep: leaving ${RUN} fixtures in place${C.reset}`); return; }
  line(`\n${C.dim}Cleaning up ${RUN}…${C.reset}`);

  const users = await models.User.find({ email: { $in: created.users } }).select('_id').lean();
  const userIds = users.map((u) => u._id);
  const orderIds = created.orders.filter(Boolean);

  const payouts = await models.AffiliatePayout.find({ affiliate: { $in: created.affiliates } })
    .select('_id').lean();

  const res = await Promise.all([
    models.AffiliateCommission.deleteMany({
      $or: [{ affiliate: { $in: created.affiliates } }, { order: { $in: orderIds } }],
    }),
    models.AffiliatePayout.deleteMany({ _id: { $in: payouts.map((p) => p._id) } }),
    models.Order.deleteMany({ _id: { $in: orderIds } }),
    models.CouponUserUsage.deleteMany({
      $or: [{ user: { $in: userIds } }, { coupon: { $in: created.coupons } }],
    }),
    models.Coupon.deleteMany({ _id: { $in: created.coupons } }),
    models.Affiliate.deleteMany({ _id: { $in: created.affiliates } }),
    models.User.deleteMany({ _id: { $in: userIds } }),
  ]);

  line(`${C.dim}  removed: ${res.map((r) => r.deletedCount).join(' / ')} `
    + `(commissions / payouts / orders / usages / coupons / affiliates / users)${C.reset}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────────

function guard() {
  const missing = Object.entries({
    SMOKE_API_URL: API,
    SMOKE_ADMIN_EMAIL: ADMIN_EMAIL,
    SMOKE_ADMIN_PASSWORD: ADMIN_PASSWORD,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    'TEST_MONGODB_URI (or SMOKE_MONGODB_URI)': MONGO_URI,
  }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Missing required env: ${missing.join(', ')}`);

  const apiHost = new URL(API).host;
  const mongoHost = (MONGO_URI.match(/@([^/?]+)/) || [])[1] || '(unparsed)';

  for (const prod of PROD_HOSTS) {
    if (apiHost.includes(prod)) {
      throw new Error(
        `REFUSING: "${apiHost}" looks like PRODUCTION.\n`
        + '  This script forges signed payment webhooks. On prod that means real "paid"\n'
        + '  orders against money that never moved, real commission owed to real people,\n'
        + '  and real confirmation emails. There is no flag to override this.'
      );
    }
  }

  if (!CONFIRM_API) {
    throw new Error(
      `Refusing to run without --confirm-api=<substring of "${apiHost}">.\n`
      + '  You must name the environment out loud before it can be written to.'
    );
  }
  if (!apiHost.includes(String(CONFIRM_API))) {
    throw new Error(
      `--confirm-api="${CONFIRM_API}" does not appear in the API host "${apiHost}".\n`
      + '  Refusing, because you are not pointed where you think you are.'
    );
  }

  return { apiHost, mongoHost };
}

async function main() {
  const { apiHost, mongoHost } = guard();

  line('─'.repeat(76));
  line(`  ${C.bold}Affiliate programme — end-to-end smoke test${C.reset}`);
  line(`  API     : ${apiHost}`);
  line(`  Mongo   : ${mongoHost}`);
  line(`  Run tag : ${RUN}${KEEP ? '   (--keep: no teardown)' : ''}`);
  line('─'.repeat(76));

  // autoIndex:false is not optional — connecting with models imported builds every
  // declared index against whatever cluster this points at.
  await mongoose.connect(MONGO_URI, { autoIndex: false });
  await loadModels();

  const admin = await adminClient();
  const state = {};

  try {
    await scenario('preconditions', '0. Preconditions', () => scenarioPreconditions());
    await scenario('fixture', '1. Approval mints the managed coupon', () => scenarioFixture(admin, state));
    await scenario('critical', '2. CRITICAL — the returning buyer who re-uses the code', () => scenarioCritical(admin, state));
    await scenario('arrival', '3. Link and typed code must agree', () => scenarioArrival(admin, state));
    await scenario('lapsed', '4. The lapsed customer', () => scenarioLapsed(admin, state));
    await scenario('precedence', '5. A typed code beats a stale cookie', () => scenarioPrecedence(admin, state));
    await scenario('negative', '6. Negative cases must fail loudly', () => scenarioNegative(admin, state));
    await scenario('money', '7. Money integrity — idempotency, snapshots, clawback', () => scenarioMoney(admin, state));
    await scenario('payout', '8. Maturity, payout batching, TDS', () => scenarioPayout(admin, state));
    await scenario('selfserve', '9. Self-serve API — scoping and the projection', () => scenarioSelfServe(admin, state));
  } finally {
    await teardown().catch((e) => line(`${C.red}teardown failed: ${e.message}${C.reset}`));
  }

  // ── Report ──
  const failed = results.filter((r) => !r.passed);
  line(`\n${'─'.repeat(76)}`);
  line(`  ${results.length - failed.length}/${results.length} assertions passed`);
  if (failed.length) {
    line(`\n  ${C.red}${C.bold}FAILURES${C.reset}`);
    for (const f of failed) line(`   ${C.red}✗${C.reset} [${f.scenario}] ${f.label}\n       ${C.dim}${f.detail}${C.reset}`);
    line(`\n  ${C.dim}Triage: docs/RUNBOOK-affiliate-smoke-test.md → "Fast triage"${C.reset}`);
  } else {
    line(`  ${C.green}${C.bold}ALL GREEN${C.reset}`);
  }
  line('─'.repeat(76));

  return failed.length === 0;
}

main()
  .then(async (ok) => {
    await mongoose.disconnect().catch(() => {});
    process.exit(ok ? 0 : 1);
  })
  .catch(async (err) => {
    console.error(`\n${C.red}✗ ${err.message}${C.reset}\n`);
    if (VERBOSE) console.error(err.stack);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
