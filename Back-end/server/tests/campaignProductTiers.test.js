/**
 * Product-tier authoring — the HTTP surface and the assignment semantics.
 *
 * The pure resolution maths is covered in productTiers.test.js. What is under test here
 * is everything that only shows up once real products, a real campaign and real
 * concurrency are involved:
 *
 *   - the admin boundary (a signed-in shopper must never reach a pricing control);
 *   - the typo guard — the `cbmcup` case, where one transposed letter matched 928 of
 *     938 products and would have flattened every tier to 3%;
 *   - order-independent overlap: committing Thanos then Bronkz must give the same
 *     answer as Bronkz then Thanos;
 *   - idempotency, because an operator WILL click commit twice.
 */

import { jest } from '@jest/globals';
import request from 'supertest';
import { app } from '../app.js';
import User from '../models/User.js';
import Campaign from '../models/Campaign.js';
import Product from '../models/Product.js';
import CampaignProductTier from '../models/CampaignProductTier.js';
import { CAMPAIGN_STATUS, CAMPAIGN_AUDIENCE } from '../config/campaign.js';
import { generateTokenPair } from '../utils/sessionManager.js';

jest.setTimeout(60000);

let seq = 0;
const auth = (user) => `Bearer ${generateTokenPair(user, '127.0.0.1', 'jest').accessToken}`;

const seedUser = async (role = 'admin') =>
  User.create({ name: 'U', email: `tier${++seq}${Date.now()}@x.com`, passwordHash: 'x', role, isVerified: true });

/** The live ladder: Bronkz 3% < Ismpor 4% (default) < Sora 5% < Thanos 8%. */
const LADDER = [
  { code: 'bronkz', label: 'Bronkz', percent: 3, matchQueries: ['zzproman'] },
  { code: 'sora', label: 'Sora', percent: 5, matchQueries: ['zzauxbeam'] },
  { code: 'thanos', label: 'Thanos', percent: 8, matchQueries: ['zzprofender'] },
  { code: 'ismpor', label: 'Ismpor', percent: 4, isDefault: true },
];

const seedCampaign = (overrides = {}) => Campaign.create({
  slug: `tier-camp-${++seq}-${Date.now()}`,
  name: 'Tier Test',
  status: CAMPAIGN_STATUS.DRAFT,
  audience: CAMPAIGN_AUDIENCE.LIST,
  couponCode: `TIER${seq}`,
  productTiers: LADDER,
  ...overrides,
});

// Distinctive tokens ("zzproman") so the search matches only what this test seeded,
// never leftovers from a sibling suite sharing the in-memory database.
const seedProduct = (name, extra = {}) => Product.create({
  name, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++seq}`,
  description: `${name} description`,
  price: 1000, stock: 'in', isActive: true, categories: [], ...extra,
});

let admin, shopper, campaign;

beforeEach(async () => {
  admin = await seedUser('admin');
  shopper = await seedUser('customer');
  campaign = await seedCampaign();
});

const url = (id = campaign._id) => `/api/v1/campaigns/${id}/product-tiers`;

describe('auth boundary — pricing controls are admin-only', () => {
  test.each([
    ['GET', (u) => request(app).get(url()).set('Authorization', u)],
    ['POST', (u) => request(app).post(url()).set('Authorization', u).send({ tierCode: 'bronkz', query: 'x' })],
    ['DELETE', (u) => request(app).delete(`${url()}/bronkz`).set('Authorization', u)],
  ])('%s rejects a signed-in shopper with 403', async (_m, call) => {
    await call(auth(shopper)).expect(403);
  });

  test('rejects an anonymous caller with 401', async () => {
    await request(app).get(url()).expect(401);
  });

  test('preview writes nothing even when it is allowed to run', async () => {
    await seedProduct('zzproman Bumper');
    await request(app)
      .get(`${url()}/preview?tierCode=bronkz&query=zzproman`)
      .set('Authorization', auth(admin))
      .expect(200);
    expect(await CampaignProductTier.countDocuments({ campaign: campaign._id })).toBe(0);
  });
});

describe('preview', () => {
  test('reports the matched set, the catalogue share, and on-sale members', async () => {
    await seedProduct('zzproman Bumper');
    await seedProduct('zzproman Roll Bar', { price: 900, originalPrice: 1200 });

    const res = await request(app)
      .get(`${url()}/preview?tierCode=bronkz&query=zzproman`)
      .set('Authorization', auth(admin))
      .expect(200);

    expect(res.body.matched).toBe(2);
    expect(res.body.onSaleCount).toBe(1);
    expect(res.body.catalogueTotal).toBeGreaterThanOrEqual(2);
    expect(res.body.products.every(p => p.resultingTier === 'bronkz')).toBe(true);
    // Per-user/operator state that reflects an admin's own uncommitted work.
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  test('rejects an unknown tier code, naming the ones that exist', async () => {
    const res = await request(app)
      .get(`${url()}/preview?tierCode=nope&query=zzproman`)
      .set('Authorization', auth(admin))
      .expect(400);
    expect(res.body.message).toMatch(/bronkz/);
  });

  test('rejects the DEFAULT tier — its membership is "everything else"', async () => {
    const res = await request(app)
      .get(`${url()}/preview?tierCode=ismpor&query=zzproman`)
      .set('Authorization', auth(admin))
      .expect(400);
    expect(res.body.message).toMatch(/default tier has no membership/i);
  });

  test('requires a non-empty query', async () => {
    await request(app)
      .get(`${url()}/preview?tierCode=bronkz&query=`)
      .set('Authorization', auth(admin))
      .expect(400);
  });
});

describe('commit', () => {
  test('assigns the matched products and is idempotent on a second click', async () => {
    await seedProduct('zzproman Bumper');
    await seedProduct('zzproman Roll Bar');

    const first = await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'bronkz', query: 'zzproman' }).expect(201);
    expect(first.body.assigned).toBe(2);

    const second = await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'bronkz', query: 'zzproman' }).expect(201);
    expect(second.body.assigned).toBe(0);

    // Two clicks, two products — never four rows.
    expect(await CampaignProductTier.countDocuments({ campaign: campaign._id })).toBe(2);
  });

  test('honours a REVIEWED selection over the raw query match', async () => {
    const keep = await seedProduct('zzproman Bumper');
    await seedProduct('zzproman Unwanted');

    await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'bronkz', query: 'zzproman', productIds: [String(keep._id)] })
      .expect(201);

    const rows = await CampaignProductTier.find({ campaign: campaign._id }).lean();
    expect(rows).toHaveLength(1);
    expect(String(rows[0].product)).toBe(String(keep._id));
  });

  test('requires either a selection or a query', async () => {
    await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'bronkz' }).expect(400);
  });

  test('a query matching nothing assigns nothing rather than erroring', async () => {
    const res = await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'bronkz', query: 'zznothingmatchesthis' }).expect(201);
    expect(res.body.assigned).toBe(0);
  });
});

describe('overlap — lowest wins, whichever order the tiers are committed in', () => {
  /** Commit the two tiers in the given order and return the shared product's tier. */
  const commitBoth = async (order) => {
    // One product in both sets: the real case is the Profender Thar/Jimny/Gypsy kits,
    // which match both `profender` (Thanos 8%) and `profender thar` (Bronkz 3%).
    await seedProduct('zzprofender zzproman Thar Lift Kit');
    for (const [tierCode, query] of order) {
      await request(app).post(url()).set('Authorization', auth(admin))
        .send({ tierCode, query }).expect(201);
    }
    return CampaignProductTier.findOne({ campaign: campaign._id }).lean();
  };

  test('Thanos then Bronkz → 3%', async () => {
    const row = await commitBoth([['thanos', 'zzprofender'], ['bronkz', 'zzproman']]);
    expect(row.tierCode).toBe('bronkz');
    expect(row.matchedCodes.sort()).toEqual(['bronkz', 'thanos']);
  });

  test('Bronkz then Thanos → 3% (same answer, opposite order)', async () => {
    const row = await commitBoth([['bronkz', 'zzproman'], ['thanos', 'zzprofender']]);
    expect(row.tierCode).toBe('bronkz');
    expect(row.matchedCodes.sort()).toEqual(['bronkz', 'thanos']);
  });

  test('the response reports how many products the overlap held back', async () => {
    await seedProduct('zzprofender zzproman Thar Lift Kit');
    await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'bronkz', query: 'zzproman' }).expect(201);

    const res = await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'thanos', query: 'zzprofender' }).expect(201);

    // Committed to Thanos, but it stays at Bronkz — the operator is told, not surprised.
    expect(res.body.keptInLowerTier).toBe(1);
  });

  test('preview shows the overlap outcome BEFORE anything is written', async () => {
    await seedProduct('zzprofender zzproman Thar Lift Kit');
    await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'bronkz', query: 'zzproman' }).expect(201);

    const res = await request(app)
      .get(`${url()}/preview?tierCode=thanos&query=zzprofender`)
      .set('Authorization', auth(admin))
      .expect(200);

    expect(res.body.products[0].currentTier).toBe('bronkz');
    expect(res.body.products[0].resultingTier).toBe('bronkz');
    expect(res.body.movedByOverlap).toBe(1);
  });
});

describe('the query is actually honoured', () => {
  test('a product that does not match the query is never assigned', async () => {
    // Regression: SearchService's Mongo fallback reads `search`, not `q`. Passing `q`
    // alone dropped the term whenever Elasticsearch was unavailable and matched the
    // WHOLE catalogue — offering to put every product into one discount tier.
    await seedProduct('zzproman Bumper');
    await seedProduct('zzauxbeam Light Bar');

    const res = await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'bronkz', query: 'zzproman' }).expect(201);

    expect(res.body.assigned).toBe(1);
    const rows = await CampaignProductTier.find({ campaign: campaign._id })
      .populate('product', 'name').lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].product.name).toMatch(/zzproman/);
  });
});

describe('the typo guard — the `cbmcup` case', () => {
  /**
   * The real incident this exists for: the tier spec said `cbmcup`, a typo for `comeup`.
   * `comeup` matched 6 products; `cbmcup` fuzzy-matched 928 of 938. Committed unchecked
   * it would have put the whole catalogue in the 3% tier and, through lowest-wins,
   * dragged the 5% and 8% tiers down with it — silently, with no error anywhere.
   */
  // Above PRODUCT_TIER_BULK_MIN_MATCHES — below that floor the guard deliberately
  // stands down, because on a small catalogue a broad match is not evidence of a typo.
  const SWEEP = 30;
  const seedCatalogue = async (n, token) => {
    for (let i = 0; i < n; i++) await seedProduct(`${token} Widget ${i}`);
  };

  test('refuses a query sweeping up most of the catalogue', async () => {
    await seedCatalogue(SWEEP, 'zzsweep');

    const res = await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'bronkz', query: 'zzsweep' })
      .expect(400);

    expect(res.body.message).toMatch(/implausibly large share|usually a typo/i);
    expect(await CampaignProductTier.countDocuments({ campaign: campaign._id })).toBe(0);
  });

  test('an explicit confirmation gets through — it is a guard, not a ceiling', async () => {
    await seedCatalogue(SWEEP, 'zzsweep');

    const res = await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'bronkz', query: 'zzsweep', confirm: true })
      .expect(201);

    expect(res.body.assigned).toBe(SWEEP);
  });

  test('a REVIEWED selection is never blocked, however large', async () => {
    await seedCatalogue(SWEEP, 'zzsweep');
    const ids = (await Product.find({ name: /zzsweep/ }).select('_id').lean()).map(p => String(p._id));

    // The operator has already looked at these, which is exactly the review the guard
    // exists to force. Blocking here would only teach them to always send confirm:true.
    const res = await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'bronkz', productIds: ids })
      .expect(201);

    expect(res.body.assigned).toBe(SWEEP);
  });

  test('stands down on a SMALL catalogue — 3 of 5 products is not a typo', async () => {
    // Ratio-only, this would be 100% and blocked, making a new store unable to assign
    // any tier at all and training operators to confirm past the guard reflexively.
    await seedCatalogue(3, 'zzsmall');
    const res = await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'bronkz', query: 'zzsmall' })
      .expect(201);
    expect(res.body.assigned).toBe(3);
  });

  test('preview flags it up front so the refusal is never a surprise', async () => {
    await seedCatalogue(SWEEP, 'zzsweep');

    const res = await request(app)
      .get(`${url()}/preview?tierCode=bronkz&query=zzsweep`)
      .set('Authorization', auth(admin))
      .expect(200);

    expect(res.body.requiresConfirmation).toBe(true);
    expect(res.body.warning).toMatch(/typo/i);
    expect(res.body.ratio).toBeGreaterThanOrEqual(0.4);
  });
});

describe('listing and unassignment', () => {
  test('lists assignments with per-tier counts on the first page only', async () => {
    await seedProduct('zzproman Bumper');
    await seedProduct('zzauxbeam Light Bar');
    await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'bronkz', query: 'zzproman' }).expect(201);
    await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'sora', query: 'zzauxbeam' }).expect(201);

    const res = await request(app).get(url()).set('Authorization', auth(admin)).expect(200);
    expect(res.body.counts).toEqual({ bronkz: 1, sora: 1 });
    expect(res.body.rows).toHaveLength(2);

    const filtered = await request(app).get(`${url()}?tierCode=sora`).set('Authorization', auth(admin)).expect(200);
    expect(filtered.body.rows).toHaveLength(1);
  });

  test('walks a keyset cursor without skipping or repeating a row', async () => {
    for (let i = 0; i < 7; i++) await seedProduct(`zzproman Part ${i}`);
    await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'bronkz', query: 'zzproman' }).expect(201);

    const seen = new Set();
    let cursor = null;
    let guard = 0;
    do {
      const res = await request(app)
        .get(`${url()}?limit=3${cursor ? `&cursor=${cursor}` : ''}`)
        .set('Authorization', auth(admin)).expect(200);
      // A repeat here means the cursor is not walking a unique key.
      res.body.rows.forEach(r => {
        const id = String(r.product?._id || r.product);
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      });
      cursor = res.body.nextCursor;
    } while (cursor && ++guard < 20);

    expect(seen.size).toBe(7);
  });

  test('counts are returned only on page one, never re-aggregated while paging', async () => {
    for (let i = 0; i < 4; i++) await seedProduct(`zzproman Part ${i}`);
    await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'bronkz', query: 'zzproman' }).expect(201);

    const first = await request(app).get(`${url()}?limit=2`).set('Authorization', auth(admin)).expect(200);
    expect(first.body.counts).not.toBeNull();
    const next = await request(app).get(`${url()}?limit=2&cursor=${first.body.nextCursor}`)
      .set('Authorization', auth(admin)).expect(200);
    expect(next.body.counts).toBeNull();
  });

  test('unassigning a tier DEMOTES an overlapping product rather than deleting it', async () => {
    await seedProduct('zzprofender zzproman Thar Lift Kit');
    await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'bronkz', query: 'zzproman' }).expect(201);
    await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'thanos', query: 'zzprofender' }).expect(201);

    const res = await request(app).delete(`${url()}/bronkz`).set('Authorization', auth(admin)).expect(200);
    expect(res.body.demoted).toBe(1);
    expect(res.body.removed).toBe(0);

    // Dropping Bronkz must not strip the product of the Thanos membership it also has.
    const row = await CampaignProductTier.findOne({ campaign: campaign._id }).lean();
    expect(row.tierCode).toBe('thanos');
    expect(row.matchedCodes).toEqual(['thanos']);
  });

  test('unassigning the only tier removes the row so the product falls back to default', async () => {
    await seedProduct('zzproman Bumper');
    await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'bronkz', query: 'zzproman' }).expect(201);

    const res = await request(app).delete(`${url()}/bronkz`).set('Authorization', auth(admin)).expect(200);
    expect(res.body.removed).toBe(1);
    expect(await CampaignProductTier.countDocuments({ campaign: campaign._id })).toBe(0);
  });
});

describe('drift — the price of materializing membership', () => {
  test('reports products matching a saved query that carry no assignment', async () => {
    await seedProduct('zzproman Bumper');
    await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'bronkz', query: 'zzproman' }).expect(201);

    // A product added to the catalogue AFTER the assignment ran would otherwise sit in
    // the default tier forever, and nobody would know.
    await seedProduct('zzproman Added Later');

    const res = await request(app).get(`${url()}/drift`).set('Authorization', auth(admin)).expect(200);
    expect(res.body.unassigned).toBe(1);
    expect(res.body.byTier[0].tierCode).toBe('bronkz');
    expect(res.body.byTier[0].missing[0].name).toMatch(/Added Later/);
  });

  test('reports nothing when every match is assigned', async () => {
    await seedProduct('zzproman Bumper');
    await request(app).post(url()).set('Authorization', auth(admin))
      .send({ tierCode: 'bronkz', query: 'zzproman' }).expect(201);

    const res = await request(app).get(`${url()}/drift`).set('Authorization', auth(admin)).expect(200);
    expect(res.body.unassigned).toBe(0);
  });
});

describe('the ladder itself', () => {
  test('refuses to save a ladder with no default tier', async () => {
    const res = await request(app).put(`/api/v1/campaigns/${campaign._id}`)
      .set('Authorization', auth(admin))
      .send({ productTiers: LADDER.filter(t => !t.isDefault) })
      .expect(400);
    expect(res.body.message).toMatch(/default/i);
  });

  test('refuses to run cart-value tiers and product tiers on one campaign', async () => {
    // The two ladders price the same goods on different axes; together they stack.
    const res = await request(app).put(`/api/v1/campaigns/${campaign._id}`)
      .set('Authorization', auth(admin))
      .send({
        tiers: [{ id: 't', label: 'T', minCartValue: 0, percent: 10 }],
        productTiers: LADDER,
      })
      .expect(400);
    expect(res.body.message).toMatch(/either cart-value tiers or product tiers/i);
  });

  test('a campaign that does not exist is a 404, not a 500', async () => {
    await request(app)
      .get(`/api/v1/campaigns/507f1f77bcf86cd799439011/product-tiers`)
      .set('Authorization', auth(admin))
      .expect(404);
  });
});
