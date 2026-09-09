/**
 * Affiliate data layer — the guarantees the rest of the program is built on.
 *
 * These are the cases a manual click-through cannot reach: the idempotency guard only
 * fires on a duplicate write, the BSON null-ordering trap only shows up once an
 * undelivered order exists alongside a delivered one, and a PII leak looks like a
 * perfectly normal JSON response until someone reads it closely.
 *
 * The unique guards live in config/db.js (never on the schemas — see models/
 * AffiliateCommission.js), so this suite BUILDS them first. Asserting against a
 * database that never built the index would pass while production has no guard at all.
 */

import { readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import mongoose from 'mongoose';
import Affiliate from '../models/Affiliate.js';
import AffiliateCommission from '../models/AffiliateCommission.js';
import AffiliatePayout from '../models/AffiliatePayout.js';
import affiliateRepository from '../repositories/affiliateRepository.js';
import affiliateCommissionRepository from '../repositories/affiliateCommissionRepository.js';
import { COMMISSION_STATUS, COMMISSION_TYPE, PAYOUT_STATUS } from '../config/affiliate.js';
import { isEncrypted } from '../utils/fieldEncryption.js';
import { ensureCriticalIndexes } from '../config/db.js';

const oid = () => new mongoose.Types.ObjectId();

const makeAffiliate = (overrides = {}) =>
  Affiliate.create({
    code: 'RAHUL10',
    name: 'Rahul',
    email: 'rahul@example.com',
    commissionPercent: 10,
    discountPercent: 5,
    ...overrides,
  });

const accrual = (overrides = {}) => ({
  affiliate: oid(),
  order: oid(),
  type: COMMISSION_TYPE.ACCRUAL,
  amountPaise: 41200,
  basePaise: 412000,
  percent: 10,
  ...overrides,
});

const MODELS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'models');

beforeAll(async () => {
  /*
    Mirror a real boot: every collection exists and its schema indexes are built, THEN
    the explicit safety net runs.

    All models are loaded, not just the three under test, because ensureCriticalIndexes
    wraps ~30 createIndex calls in ONE try/catch — so a failure anywhere above the
    affiliate block skips the affiliate guards entirely and this suite would be
    asserting against a database with no unique index at all, passing for the wrong
    reason. Loading everything also makes THIS suite fail if a future index collision
    is introduced upstream.
  */
  for (const entry of readdirSync(MODELS_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    await import(pathToFileURL(path.join(MODELS_DIR, entry.name)).href);
  }
  for (const model of Object.values(mongoose.models)) {
    await model.createCollection().catch(() => {});
    await model.syncIndexes().catch(() => {});
  }

  const res = await ensureCriticalIndexes();
  expect(res.error?.message ?? null).toBeNull();
  expect(res.ok).toBe(true);
}, 180000);

describe('AffiliateCommission — one accrual per order, forever', () => {
  /*
    THE invariant the whole program rests on. Razorpay retries webhooks; without this
    index a replay pays an affiliate twice for one sale and nothing complains.
  */
  it('rejects a second accrual for the same order', async () => {
    const order = oid();
    await AffiliateCommission.create(accrual({ order }));

    await expect(AffiliateCommission.create(accrual({ order }))).rejects.toMatchObject({
      code: 11000,
    });

    expect(
      await AffiliateCommission.countDocuments({ order, type: COMMISSION_TYPE.ACCRUAL })
    ).toBe(1);
  });

  /*
    The guard is PARTIAL on type:'accrual' for a reason: one order can be partially
    returned several times, and each of those is its own clawback row. A guard that
    keyed on `order` alone would allow the first clawback and silently reject every
    one after it — under-clawing a refunded order and leaving us out of pocket.
  */
  it('allows many clawback rows against the same order', async () => {
    const order = oid();
    await AffiliateCommission.create(accrual({ order }));

    await AffiliateCommission.create(
      accrual({ order, type: COMMISSION_TYPE.CLAWBACK, amountPaise: -1000 })
    );
    await AffiliateCommission.create(
      accrual({ order, type: COMMISSION_TYPE.CLAWBACK, amountPaise: -2000 })
    );

    expect(await AffiliateCommission.countDocuments({ order })).toBe(3);
  });

  it('does not let one order\'s accrual block another order\'s', async () => {
    await AffiliateCommission.create(accrual({ order: oid() }));
    await expect(AffiliateCommission.create(accrual({ order: oid() }))).resolves.toBeDefined();
  });
});

describe('netPaiseForOrder — the clamp that stops a double clawback going negative', () => {
  it('sums accrual and clawbacks', async () => {
    const order = oid();
    await AffiliateCommission.create(accrual({ order, amountPaise: 41200 }));
    await AffiliateCommission.create(
      accrual({ order, type: COMMISSION_TYPE.CLAWBACK, amountPaise: -15000 })
    );

    expect(await affiliateCommissionRepository.netPaiseForOrder(order)).toBe(26200);
  });

  it('excludes void rows — an admin voided them, so they are not owed', async () => {
    const order = oid();
    await AffiliateCommission.create(
      accrual({ order, amountPaise: 41200, status: COMMISSION_STATUS.VOID })
    );

    expect(await affiliateCommissionRepository.netPaiseForOrder(order)).toBe(0);
  });

  it('returns 0 for an order with no commission at all', async () => {
    expect(await affiliateCommissionRepository.netPaiseForOrder(oid())).toBe(0);
  });
});

describe('payableBalancePaise — what a payout batch would claim', () => {
  it('counts only approved, unclaimed rows', async () => {
    const affiliate = oid();
    await AffiliateCommission.create(
      accrual({ affiliate, amountPaise: 10000, status: COMMISSION_STATUS.APPROVED })
    );
    // Pending: matured but not yet approved — not payable.
    await AffiliateCommission.create(
      accrual({ affiliate, amountPaise: 50000, status: COMMISSION_STATUS.PENDING })
    );
    // Already claimed by a batch — payout set, so out of the pool.
    await AffiliateCommission.create(
      accrual({
        affiliate,
        amountPaise: 70000,
        status: COMMISSION_STATUS.PAID,
        payout: oid(),
      })
    );

    expect(await affiliateCommissionRepository.payableBalancePaise(affiliate)).toBe(10000);
  });

  /*
    The debt case. A refund landing AFTER the money was paid out writes a negative
    approved row rather than rewriting the immutable `paid` row — so it must net off
    the next batch automatically, with no special code path.
  */
  it('nets a post-payout clawback debt off the next balance', async () => {
    const affiliate = oid();
    await AffiliateCommission.create(
      accrual({ affiliate, amountPaise: 30000, status: COMMISSION_STATUS.APPROVED })
    );
    await AffiliateCommission.create(
      accrual({
        affiliate,
        type: COMMISSION_TYPE.CLAWBACK,
        amountPaise: -12000,
        status: COMMISSION_STATUS.APPROVED,
      })
    );

    expect(await affiliateCommissionRepository.payableBalancePaise(affiliate)).toBe(18000);
  });

  it('goes negative when the debt exceeds what is owed, so the batch builder can refuse', async () => {
    const affiliate = oid();
    await AffiliateCommission.create(
      accrual({
        affiliate,
        type: COMMISSION_TYPE.CLAWBACK,
        amountPaise: -5000,
        status: COMMISSION_STATUS.APPROVED,
      })
    );

    expect(await affiliateCommissionRepository.payableBalancePaise(affiliate)).toBe(-5000);
  });
});

describe('findMaturable — the BSON null-ordering trap', () => {
  /*
    ⚠️ THE bug this test exists for.

    In BSON sort order null sorts BELOW Date, so `{ maturesAt: { $lte: now } }` on its
    own matches every un-stamped row — that is, every order that was paid but never
    delivered. Without the `$ne: null` limb the 4am sweep would approve commissions on
    orders that never shipped, and the only evidence would be money leaving the bank.
  */
  it('never returns a row whose maturity date was never stamped', async () => {
    await AffiliateCommission.create(
      accrual({ status: COMMISSION_STATUS.PENDING, maturesAt: null })
    );

    const rows = await affiliateCommissionRepository.findMaturable(new Date());
    expect(rows).toEqual([]);
  });

  it('returns a pending row whose window has closed', async () => {
    const order = oid();
    await AffiliateCommission.create(
      accrual({
        order,
        status: COMMISSION_STATUS.PENDING,
        maturesAt: new Date(Date.now() - 1000),
      })
    );

    const rows = await affiliateCommissionRepository.findMaturable(new Date());
    expect(rows).toHaveLength(1);
    expect(String(rows[0].order)).toBe(String(order));
  });

  it('does not return a row whose window is still open', async () => {
    await AffiliateCommission.create(
      accrual({
        status: COMMISSION_STATUS.PENDING,
        maturesAt: new Date(Date.now() + 60_000),
      })
    );

    expect(await affiliateCommissionRepository.findMaturable(new Date())).toEqual([]);
  });

  it('ignores rows that are no longer pending', async () => {
    await AffiliateCommission.create(
      accrual({
        status: COMMISSION_STATUS.REVERSED,
        maturesAt: new Date(Date.now() - 1000),
      })
    );

    expect(await affiliateCommissionRepository.findMaturable(new Date())).toEqual([]);
  });

  it('bounds the batch', async () => {
    const past = new Date(Date.now() - 1000);
    for (let i = 0; i < 5; i += 1) {
      await AffiliateCommission.create(
        accrual({ status: COMMISSION_STATUS.PENDING, maturesAt: past })
      );
    }

    expect(await affiliateCommissionRepository.findMaturable(new Date(), 2)).toHaveLength(2);
  });
});

describe('approveOnce — the CAS that stops a reversed row being resurrected', () => {
  it('transitions a pending row exactly once', async () => {
    const row = await AffiliateCommission.create(
      accrual({ status: COMMISSION_STATUS.PENDING })
    );

    expect(await affiliateCommissionRepository.approveOnce(row._id)).toBe(true);
    // Second call: the row is no longer pending, so the guard refuses.
    expect(await affiliateCommissionRepository.approveOnce(row._id)).toBe(false);

    const fresh = await AffiliateCommission.findById(row._id);
    expect(fresh.status).toBe(COMMISSION_STATUS.APPROVED);
    expect(fresh.approvedAt).toBeTruthy();
  });

  /*
    The race the guard is for: a clawback reverses the row between the sweep reading it
    and writing it. Approving anyway would make a fully refunded order payable.
  */
  it('refuses to approve a row a concurrent clawback already reversed', async () => {
    const row = await AffiliateCommission.create(
      accrual({ status: COMMISSION_STATUS.REVERSED })
    );

    expect(await affiliateCommissionRepository.approveOnce(row._id)).toBe(false);
    expect((await AffiliateCommission.findById(row._id)).status).toBe(
      COMMISSION_STATUS.REVERSED
    );
  });
});

describe('stampMaturity — a re-run must not push a due date forward', () => {
  it('stamps an unstamped pending accrual', async () => {
    const order = oid();
    await AffiliateCommission.create(accrual({ order, maturesAt: null }));

    const when = new Date('2026-09-20T00:00:00.000Z');
    expect(await affiliateCommissionRepository.stampMaturity(order, when)).toBe(true);

    const row = await affiliateCommissionRepository.findAccrual(order);
    expect(row.maturesAt.toISOString()).toBe(when.toISOString());
  });

  /*
    A re-delivered parcel or a retried job must not delay a payment that is already
    due. The guard is `maturesAt: null`, so the first stamp wins permanently.
  */
  it('refuses to overwrite an existing maturity date', async () => {
    const order = oid();
    const original = new Date('2026-09-20T00:00:00.000Z');
    await AffiliateCommission.create(accrual({ order, maturesAt: original }));

    expect(
      await affiliateCommissionRepository.stampMaturity(order, new Date('2026-12-01T00:00:00.000Z'))
    ).toBe(false);

    const row = await affiliateCommissionRepository.findAccrual(order);
    expect(row.maturesAt.toISOString()).toBe(original.toISOString());
  });
});

describe('Affiliate — financial PII never rides along on an ordinary read', () => {
  const withBank = {
    payoutDetails: {
      accountHolderName: 'Rahul Nair',
      accountNumber: '123456789012',
      accountLast4: '9012',
      ifsc: 'HDFC0001234',
      panNumber: 'ABCDE1234F',
    },
  };

  it('omits accountNumber and panNumber from a normal find', async () => {
    await makeAffiliate(withBank);

    const found = await Affiliate.findOne({ code: 'RAHUL10' });
    expect(found.payoutDetails.accountNumber).toBeUndefined();
    expect(found.payoutDetails.panNumber).toBeUndefined();
    // The non-sensitive parts are still there — this is a projection, not a wipe.
    expect(found.payoutDetails.accountLast4).toBe('9012');
    expect(found.payoutDetails.ifsc).toBe('HDFC0001234');
  });

  it('omits them from the admin list', async () => {
    await makeAffiliate(withBank);

    const [row] = await affiliateRepository.findPage({ limit: 10 });
    expect(row.payoutDetails.accountNumber).toBeUndefined();
    expect(row.payoutDetails.panNumber).toBeUndefined();
  });

  /*
    Two separate protections, and the test has to distinguish them:
      - `select: false` keeps the fields out of ordinary reads;
      - encryption means that even a read which DOES select them yields ciphertext.
    Only `readPayoutSecrets` decrypts, and it is the single sanctioned reader.
  */
  it('returns ciphertext from findForPayout, and plaintext only from readPayoutSecrets', async () => {
    const created = await makeAffiliate(withBank);

    const forPayout = await affiliateRepository.findForPayout(created._id);
    expect(isEncrypted(forPayout.payoutDetails.accountNumber)).toBe(true);
    expect(isEncrypted(forPayout.payoutDetails.panNumber)).toBe(true);

    const secrets = await affiliateRepository.readPayoutSecrets(created._id);
    expect(secrets.accountNumber).toBe('123456789012');
    expect(secrets.panNumber).toBe('ABCDE1234F');
    // The non-sensitive parts come through unchanged.
    expect(secrets.accountLast4).toBe('9012');
    expect(secrets.ifsc).toBe('HDFC0001234');
  });

  it('never writes the plaintext to the collection at all', async () => {
    const created = await makeAffiliate(withBank);

    const raw = await mongoose.connection.db
      .collection('affiliates')
      .findOne({ _id: created._id });

    expect(JSON.stringify(raw)).not.toContain('123456789012');
    expect(JSON.stringify(raw)).not.toContain('ABCDE1234F');
  });

  /*
    findForPayout deliberately returns a HYDRATED document, not `.lean()`, so this
    toJSON transform still runs if the object ever reaches a response body. A lean
    object has no toJSON and would serialise the bank details verbatim.
  */
  it('strips them again on serialisation, even after findForPayout selected them', async () => {
    const created = await makeAffiliate(withBank);
    const forPayout = await affiliateRepository.findForPayout(created._id);

    const json = JSON.parse(JSON.stringify(forPayout));
    expect(json.payoutDetails.accountNumber).toBeUndefined();
    expect(json.payoutDetails.panNumber).toBeUndefined();
    expect(json.payoutDetails.accountLast4).toBe('9012');
  });

  it('purges them on rejection, leaving the application record behind', async () => {
    const created = await makeAffiliate(withBank);

    expect(await affiliateRepository.purgePayoutSecrets(created._id)).toBe(true);

    const raw = await mongoose.connection.db
      .collection('affiliates')
      .findOne({ _id: created._id });

    // $unset, not null — an absent field cannot be decrypted or half-cleared, and reads
    // as unambiguously gone in a database dump.
    expect('accountNumber' in (raw.payoutDetails || {})).toBe(false);
    expect('panNumber' in (raw.payoutDetails || {})).toBe(false);
    expect(raw.email).toBe('rahul@example.com');
  });
});

describe('Affiliate.user — sparse uniqueness with no null default', () => {
  /*
    The regression the index-drift guard caught during implementation. With
    `default: null` on the field, sparse would index every null and the SECOND
    account-less application would be rejected with a duplicate-key error — invisible
    until a real second applicant arrived.
  */
  it('allows many affiliates with no linked user account', async () => {
    await makeAffiliate({ code: 'AAA111', email: 'a@example.com' });
    await makeAffiliate({ code: 'BBB222', email: 'b@example.com' });

    expect(await Affiliate.countDocuments({})).toBe(2);
    // The path must be genuinely ABSENT, not null — that is what sparse skips.
    const raw = await mongoose.connection.db
      .collection('affiliates')
      .findOne({ code: 'AAA111' });
    expect('user' in raw).toBe(false);
  });

  it('still allows only one affiliate per linked user', async () => {
    const user = oid();
    await makeAffiliate({ code: 'AAA111', email: 'a@example.com', user });

    await expect(
      makeAffiliate({ code: 'BBB222', email: 'b@example.com', user })
    ).rejects.toMatchObject({ code: 11000 });
  });
});

describe('findByCode — the code arrives from a URL and a cookie, so it is validated first', () => {
  beforeEach(async () => {
    await makeAffiliate({ code: 'RAHUL10' });
  });

  it('matches case-insensitively and ignores surrounding whitespace', async () => {
    expect(await affiliateRepository.findByCode('  rahul10 ')).not.toBeNull();
  });

  it.each([
    ['empty', ''],
    ['null', null],
    ['undefined', undefined],
    ['too short', 'AB'],
    ['illegal characters', 'RAHUL<script>'],
    ['starts with a separator', '-RAHUL'],
    ['a mongo operator object', { $ne: null }],
  ])('refuses %s without touching the database', async (_label, input) => {
    expect(await affiliateRepository.findByCode(input)).toBeNull();
  });

  it('does not match an over-long string that merely starts with a real code', async () => {
    expect(await affiliateRepository.findByCode(`RAHUL10${'X'.repeat(40)}`)).toBeNull();
  });

  it('honours activeOnly so a suspended affiliate cannot attribute', async () => {
    expect(await affiliateRepository.findByCode('RAHUL10', { activeOnly: true })).toBeNull();

    await Affiliate.updateOne({ code: 'RAHUL10' }, { $set: { status: 'active' } });
    expect(await affiliateRepository.findByCode('RAHUL10', { activeOnly: true })).not.toBeNull();
  });
});

describe('AffiliatePayout — one bank reference, one payout', () => {
  it('rejects the same UTR recorded against a second payout', async () => {
    const base = {
      affiliate: oid(),
      grossPaise: 10000,
      netPaise: 10000,
      status: PAYOUT_STATUS.PAID,
      reference: 'UTR123456',
    };
    await AffiliatePayout.create(base);

    await expect(
      AffiliatePayout.create({ ...base, affiliate: oid() })
    ).rejects.toMatchObject({ code: 11000 });
  });

  /*
    Partial on $type:'string' — otherwise every draft awaiting a transfer would share
    a null reference and only one draft could exist at a time.
  */
  it('allows many drafts that have no reference yet', async () => {
    const draft = { affiliate: oid(), grossPaise: 1, netPaise: 1 };
    await AffiliatePayout.create(draft);
    await AffiliatePayout.create({ ...draft, affiliate: oid() });

    expect(await AffiliatePayout.countDocuments({})).toBe(2);
  });
});
