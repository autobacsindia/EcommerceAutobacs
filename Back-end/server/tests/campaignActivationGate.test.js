/**
 * The activation gate — a campaign that is PUBLIC but not ADVERTISED.
 *
 * The /festive QR offer has no allowlist: anyone holding the printed card may have it.
 * What it must NOT do is reach people who never held one. A customer who registers
 * through the ordinary sign-up form has not been given this offer, and must not see it
 * on product cards, in the cart, on the ribbon — and above all must not be charged the
 * discounted price if they type the coupon code they read off someone else's screen.
 *
 * That last clause is why the gate lives in campaignService.evaluate() rather than in
 * the UI. These tests exist to hold it there:
 *
 *   1. the gate refuses a non-activated customer, and the refusal reaches PRICING, not
 *      merely the badge — the tamper case;
 *   2. it is OFF by default, so every campaign that predates the flag is untouched;
 *   3. activation is idempotent, campaign-scoped, and cannot enrol a stranger into an
 *      allowlist campaign;
 *   4. an UNVERIFIED customer can still activate. This is the subtle one: they scan,
 *      register, and get sent to their inbox. If activation had to wait for
 *      confirmation they would need to find their way back to a page with no link
 *      anywhere on the site, and the ones who did not would silently never get the
 *      offer they were holding a card for.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { useTransactionalDb } from './helpers/replicaSet.js';

import Product from '../models/Product.js';
import User from '../models/User.js';
import Coupon from '../models/Coupon.js';
import Campaign from '../models/Campaign.js';
import CampaignMember from '../models/CampaignMember.js';
import CampaignProductTier from '../models/CampaignProductTier.js';

import campaignService from '../services/campaignService.js';
import pricingService from '../services/pricingService.js';
import { CAMPAIGN_STATUS, CAMPAIGN_AUDIENCE, CAMPAIGN_REASON } from '../config/campaign.js';

jest.setTimeout(120000);

let seq = 0;

const seedProduct = (price = 10000) => Product.create({
  name: `Prod ${++seq}`, slug: `prod-gate-${seq}`, description: 'Test product',
  price, stock: 'in', brand: 'B', isActive: true,
});

const seedUser = ({ isVerified = true } = {}) =>
  User.create({ name: 'U', email: `gate${++seq}${Date.now()}@x.com`, passwordHash: 'x', isVerified });

const PRODUCT_TIERS = [
  { code: 'thanos', label: 'Thanos', percent: 8 },
  { code: 'ismpor', label: 'Ismpor', percent: 4, isDefault: true },
];

/**
 * A live, public, product-tier campaign — the shape /festive actually runs in.
 *
 * Created LIVE rather than draft-then-published because every test here is about a
 * running offer, and `requireActivation` defaults to false so each test states the
 * gate it means to exercise.
 */
async function seedCampaign({ code, ...overrides } = {}) {
  const couponCode = code || `GATE${++seq}${Date.now()}`.slice(0, 20).toUpperCase();
  const campaign = await Campaign.create({
    slug: `festive-gate-${++seq}`,
    name: 'Festive Gate',
    status: CAMPAIGN_STATUS.LIVE,
    audience: CAMPAIGN_AUDIENCE.EVERYONE,
    requireVerifiedEmail: true,
    endsAt: new Date(Date.now() + 30 * 864e5),
    maxRedemptions: 500,
    productTiers: PRODUCT_TIERS,
    tiers: [],
    couponCode,
    landingPath: '/festive',
    ...overrides,
  });
  await Coupon.create({
    code: couponCode, type: 'percentage', value: 0, visibility: 'hidden',
    usageLimitPerUser: 1, isActive: true, campaign: campaign._id,
  });
  return campaign;
}

beforeAll(async () => {
  await useTransactionalDb();
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  for (const key of Object.keys(collections)) await collections[key].deleteMany({});
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the gate is off unless a campaign asks for it', () => {
  it('leaves an ordinary public campaign completely unchanged', async () => {
    const campaign = await seedCampaign();
    const user = await seedUser();

    expect(campaign.requireActivation).toBe(false);

    const result = await campaignService.evaluate(campaign, user._id, 100000);
    expect(result.eligible).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('will not let anyone activate an UNGATED campaign', async () => {
    /*
      The endpoint is open to any signed-in customer, so the "only the landing page calls
      this" reasoning is a statement about our own client, not a control. Without a check
      on the server, anyone could POST it at an ordinary site-wide sale and write member
      rows that campaign never reads — turning its roster, and every funnel count drawn
      from it, into noise.

      A no-op returning the true status rather than an error: on an ungated campaign the
      honest answer to "give me this offer" is "you already have it", and erroring would
      also turn an operator switching the gate OFF into a visible failure for whoever
      happened to be on the page.
    */
    const campaign = await seedCampaign();
    const user = await seedUser();

    const status = await campaignService.activate(campaign.slug, user._id);

    expect(status.eligible).toBe(true);
    expect(status.requiresActivation).toBe(false);
    expect(await CampaignMember.countDocuments({ campaign: campaign._id })).toBe(0);
  });

  it('creates no member row for an ungated campaign', async () => {
    // The lookup is skipped entirely when no gate needs it, and nothing writes a roster
    // for a campaign that never reads one. Pinned because the obvious implementation —
    // always fetch, always upsert — quietly fills CampaignMember for every public sale.
    const campaign = await seedCampaign();
    const user = await seedUser();

    await campaignService.statusForUser(campaign.slug, user._id, 0);

    expect(await CampaignMember.countDocuments({ campaign: campaign._id })).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a gated campaign refuses a customer who never came through the card', () => {
  it('refuses with not_activated', async () => {
    const campaign = await seedCampaign({ requireActivation: true });
    const user = await seedUser();

    const result = await campaignService.evaluate(campaign, user._id, 100000);
    expect(result.eligible).toBeUndefined();
    expect(result.reason).toBe(CAMPAIGN_REASON.NOT_ACTIVATED);
  });

  it('publishes not_activated + activated:false, and withholds the coupon code', async () => {
    const campaign = await seedCampaign({ requireActivation: true });
    const user = await seedUser();

    const status = await campaignService.statusForUser(campaign.slug, user._id, 100000);

    expect(status.eligible).toBe(false);
    expect(status.reasonCode).toBe('not_activated');
    expect(status.requiresActivation).toBe(true);
    expect(status.activated).toBe(false);
    // The code is the offer. Publishing it to someone who cannot use it hands them the
    // one thing they would need to try.
    expect(status.couponCode).toBeNull();
  });

  it('REFUSES TO PRICE the discount when the code is supplied by hand', async () => {
    /*
      The test this whole file exists for.

      Hiding the badges is presentation; a customer who reads the code off a friend's
      screen and types it into the promo box is the real case. If the gate lived only in
      the UI they would be charged the discounted price and nothing would notice.
    */
    const campaign = await seedCampaign({ requireActivation: true });
    const user = await seedUser();
    const product = await seedProduct(10000);

    const quote = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1 }],
      couponCode: campaign.couponCode,
      userId: user._id,
    });

    expect(quote.couponDiscount).toBe(0);
    expect(quote.couponError).toBe(CAMPAIGN_REASON.NOT_ACTIVATED);
    // Tagged so the cart can drop a coupon that was never theirs instead of parking a
    // permanent error under the promo box.
    expect(quote.couponErrorCode).toBe('campaign');
    // The bill is the full one.
    expect(quote.subtotal).toBe(10000);
  });

  it('HARD-FAILS at order creation, not just in the quote', async () => {
    /*
      The quote reports a refusal so a cart can explain itself inline; it does not stop
      anything on its own. The checkout guard is what turns that into a 400, and it is
      the last gate before money moves — a client that ignored the quote and posted the
      order anyway has to be refused here.
    */
    const campaign = await seedCampaign({ requireActivation: true });
    const user = await seedUser();
    const product = await seedProduct(10000);

    const quote = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1 }],
      couponCode: campaign.couponCode,
      userId: user._id,
    });

    expect(() => pricingService.assertCouponApplied(quote, campaign.couponCode))
      .toThrow(CAMPAIGN_REASON.NOT_ACTIVATED);
  });

  it('prices the discount once the customer has activated', async () => {
    const campaign = await seedCampaign({ requireActivation: true });
    const user = await seedUser();
    const product = await seedProduct(10000);

    await campaignService.activate(campaign.slug, user._id);

    const quote = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1 }],
      couponCode: campaign.couponCode,
      userId: user._id,
    });

    // No tier assignment, so the Ismpor default (4%) applies to the line.
    expect(quote.couponError).toBeNull();
    expect(quote.couponDiscount).toBe(400);
  });

  it('still refuses an activated customer whose email is unconfirmed', async () => {
    // The two gates are orthogonal, and activation must not become a way around
    // verification — that check is what proves control of the mailbox the
    // once-per-customer limit is keyed on.
    const campaign = await seedCampaign({ requireActivation: true });
    const user = await seedUser({ isVerified: false });

    await campaignService.activate(campaign.slug, user._id);

    const result = await campaignService.evaluate(campaign, user._id, 100000);
    expect(result.reason).toBe(CAMPAIGN_REASON.UNVERIFIED);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('activation', () => {
  it('records the customer and flips them to eligible', async () => {
    const campaign = await seedCampaign({ requireActivation: true });
    const user = await seedUser();

    const status = await campaignService.activate(campaign.slug, user._id);

    expect(status.activated).toBe(true);
    expect(status.eligible).toBe(true);
    expect(status.couponCode).toBe(campaign.couponCode);

    const member = await CampaignMember.findOne({ campaign: campaign._id });
    expect(member.activatedAt).toBeTruthy();
    expect(member.source).toBe('self');
    expect(String(member.user)).toBe(String(user._id));
  });

  it('is idempotent — twice yields ONE row and the ORIGINAL timestamp', async () => {
    // The landing page fires this on every visit, so a second call must be a no-op
    // rather than a second row (the unique index would reject it) or a rewritten
    // history.
    const campaign = await seedCampaign({ requireActivation: true });
    const user = await seedUser();

    await campaignService.activate(campaign.slug, user._id);
    const first = await CampaignMember.findOne({ campaign: campaign._id });

    await campaignService.activate(campaign.slug, user._id);

    expect(await CampaignMember.countDocuments({ campaign: campaign._id })).toBe(1);
    const second = await CampaignMember.findOne({ campaign: campaign._id });
    expect(second.activatedAt.getTime()).toBe(first.activatedAt.getTime());
  });

  it('survives concurrent calls from two tabs', async () => {
    // Both tabs see "not activated" and race to upsert against the unique
    // {campaign, email} index. The loser must recover, not surface a duplicate-key
    // error to someone who did nothing wrong.
    const campaign = await seedCampaign({ requireActivation: true });
    const user = await seedUser();

    const results = await Promise.all([
      campaignService.activate(campaign.slug, user._id),
      campaignService.activate(campaign.slug, user._id),
    ]);

    expect(results.every(r => r.activated === true)).toBe(true);
    expect(await CampaignMember.countDocuments({ campaign: campaign._id })).toBe(1);
  });

  it('lets an UNVERIFIED customer activate', async () => {
    /*
      The funnel case. They scan the card, register, and are sent to their inbox before
      the campaign has any record of them. Refusing activation here would mean the only
      way back is a page reachable exclusively from a printed card — so confirming their
      email from the inbox would leave them eligible for nothing.
    */
    const campaign = await seedCampaign({ requireActivation: true });
    const user = await seedUser({ isVerified: false });

    const status = await campaignService.activate(campaign.slug, user._id);

    expect(status.activated).toBe(true);
    // Still not eligible — verification is a separate gate and stays shut.
    expect(status.eligible).toBe(false);
    expect(status.reasonCode).toBe('unverified');

    // ...and the moment they confirm, the offer is simply theirs, with no second visit.
    await User.updateOne({ _id: user._id }, { $set: { isVerified: true } });
    const after = await campaignService.statusForUser(campaign.slug, user._id, 100000);
    expect(after.eligible).toBe(true);
  });

  it('is scoped to ONE campaign', async () => {
    const a = await seedCampaign({ requireActivation: true });
    const b = await seedCampaign({ requireActivation: true });
    const user = await seedUser();

    await campaignService.activate(a.slug, user._id);

    expect((await campaignService.statusForUser(a.slug, user._id, 0)).eligible).toBe(true);
    expect((await campaignService.statusForUser(b.slug, user._id, 0)).reasonCode).toBe('not_activated');
  });

  it('refuses to activate a campaign that is switched off', async () => {
    const campaign = await seedCampaign({ requireActivation: true, status: CAMPAIGN_STATUS.OFF });
    const user = await seedUser();

    await expect(campaignService.activate(campaign.slug, user._id))
      .rejects.toThrow(CAMPAIGN_REASON.INACTIVE);
    expect(await CampaignMember.countDocuments({ campaign: campaign._id })).toBe(0);
  });

  it('refuses to activate a campaign that has ended', async () => {
    const campaign = await seedCampaign({
      requireActivation: true,
      endsAt: new Date(Date.now() - 864e5),
    });
    const user = await seedUser();

    await expect(campaignService.activate(campaign.slug, user._id))
      .rejects.toThrow(CAMPAIGN_REASON.ENDED);
  });

  it('refuses to activate a campaign that has been fully claimed', async () => {
    const campaign = await seedCampaign({
      requireActivation: true,
      maxRedemptions: 2,
      redeemedCount: 2,
    });
    const user = await seedUser();

    await expect(campaignService.activate(campaign.slug, user._id))
      .rejects.toThrow(CAMPAIGN_REASON.EXHAUSTED);
  });

  it('404s on a campaign that does not exist', async () => {
    const user = await seedUser();
    await expect(campaignService.activate('no-such-campaign', user._id))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('does not error at a customer who already spent the offer', async () => {
    // They activated properly and redeemed. Reopening their card is not a mistake, and
    // erroring at them for it would read as the site being broken.
    const campaign = await seedCampaign({ requireActivation: true });
    const user = await seedUser();
    await campaignService.activate(campaign.slug, user._id);

    const coupon = await Coupon.findOne({ code: campaign.couponCode });
    await mongoose.connection.collection('couponuserusages').insertOne({
      coupon: coupon._id, user: user._id, count: 1,
    });

    const status = await campaignService.activate(campaign.slug, user._id);
    expect(status.reasonCode).toBe('already_used');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the allowlist boundary holds', () => {
  it('will NOT enrol a stranger into an allowlist campaign', async () => {
    /*
      A forwarded card must not become a way onto a list somebody was posted. For an
      audience of 'list' the roster is the boundary, and activation may only stamp a row
      that an operator already imported.
    */
    const campaign = await seedCampaign({
      requireActivation: true,
      audience: CAMPAIGN_AUDIENCE.LIST,
    });
    const stranger = await seedUser();

    await expect(campaignService.activate(campaign.slug, stranger._id))
      .rejects.toThrow(CAMPAIGN_REASON.NOT_INVITED);
    expect(await CampaignMember.countDocuments({ campaign: campaign._id })).toBe(0);
  });

  it('keeps source=invited for a row created by the REAL import path', async () => {
    /*
      Pins the import path explicitly, because it is the one that writes through
      bulkWrite rather than the model and the two could plausibly differ. Measured, not
      assumed: Mongoose does apply `setDefaultsOnInsert` to a bulkWrite upsert, so an
      import performed TODAY does stamp `source: 'invited'`. This test exists so that
      stays true — if a future Mongoose release changes that default, or someone adds
      `setDefaultsOnInsert: false`, imported cards would start being relabelled as
      walk-ins and only this test would notice.

      The rows that were genuinely at risk are the ones already on the cluster, written
      before the field existed. That is the test below.
    */
    const campaign = await seedCampaign({
      requireActivation: true,
      audience: CAMPAIGN_AUDIENCE.LIST,
    });
    const user = await seedUser();
    await campaignService.importMembers(campaign._id, [
      { email: user.email, name: 'Posted a card' },
    ]);

    const raw = await mongoose.connection.collection('campaignmembers')
      .findOne({ campaign: campaign._id });
    expect(raw.source).toBe('invited');

    await campaignService.activate(campaign.slug, user._id);

    const member = await CampaignMember.findOne({ campaign: campaign._id });
    expect(member.source).toBe('invited');
    expect(member.activatedAt).toBeTruthy();
  });

  it('keeps source=invited for a LEGACY row that predates the field', async () => {
    /*
      THE regression. Every CampaignMember on the production cluster was written before
      `source` existed, so those documents have no such field — including all 191 posted
      festive cards.

      Activation inferred the value with `$ifNull(source, 'self')`, which would have
      relabelled each of those invitees as a walk-in the first time they scanned their
      own card, destroying the only signal that separates "we posted them a card" from
      "they found one". Inserted raw here, with no `source` key, because that is exactly
      the shape of the rows in production.
    */
    const campaign = await seedCampaign({
      requireActivation: true,
      audience: CAMPAIGN_AUDIENCE.LIST,
    });
    const user = await seedUser();
    await mongoose.connection.collection('campaignmembers').insertOne({
      campaign: campaign._id,
      email: user.email,
      status: 'invited',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await campaignService.activate(campaign.slug, user._id);

    const member = await CampaignMember.findOne({ campaign: campaign._id });
    expect(member.source).toBe('invited');
  });

  it('stamps an existing invite without demoting it to a self-activation', async () => {
    const campaign = await seedCampaign({
      requireActivation: true,
      audience: CAMPAIGN_AUDIENCE.LIST,
    });
    const user = await seedUser();
    await CampaignMember.create({ campaign: campaign._id, email: user.email, name: 'Invited' });

    const status = await campaignService.activate(campaign.slug, user._id);

    expect(status.eligible).toBe(true);
    const member = await CampaignMember.findOne({ campaign: campaign._id });
    expect(member.activatedAt).toBeTruthy();
    // Being posted a card and finding one are different facts; the funnel counts read
    // differently for each, so an import must never be relabelled by a scan.
    expect(member.source).toBe('invited');
  });

  it('an invited customer who never scanned is still refused while the gate is on', async () => {
    // The gate reads `activatedAt`, not the existence of a row — otherwise an allowlist
    // campaign, which has a row for every invitee, would satisfy it for free and the
    // flag would be a no-op on exactly the campaigns that also asked for it.
    const campaign = await seedCampaign({
      requireActivation: true,
      audience: CAMPAIGN_AUDIENCE.LIST,
    });
    const user = await seedUser();
    await CampaignMember.create({ campaign: campaign._id, email: user.email });

    const result = await campaignService.evaluate(campaign, user._id, 100000);
    expect(result.reason).toBe(CAMPAIGN_REASON.NOT_ACTIVATED);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the operator switch', () => {
  it('turns the gate on and off through the ordinary update path', async () => {
    // requireActivation must survive campaignService.update's EDITABLE_FIELDS allowlist.
    // A field missing from that list is dropped SILENTLY, so the script would report
    // success and change nothing — which is how the gate would appear not to work at all.
    const campaign = await seedCampaign();
    const user = await seedUser();

    const on = await campaignService.update(campaign._id, { requireActivation: true });
    expect(on.requireActivation).toBe(true);
    expect((await campaignService.statusForUser(campaign.slug, user._id, 0)).reasonCode)
      .toBe('not_activated');

    const off = await campaignService.update(campaign._id, { requireActivation: false });
    expect(off.requireActivation).toBe(false);
    expect((await campaignService.statusForUser(campaign.slug, user._id, 0)).eligible).toBe(true);
  });

  it('an activation survives the gate being switched off and on again', async () => {
    // The rollback path. Turning the gate off must not discard who came through the
    // card, or switching it back on would silently strip everyone who had already
    // activated.
    const campaign = await seedCampaign({ requireActivation: true });
    const user = await seedUser();
    await campaignService.activate(campaign.slug, user._id);

    await campaignService.update(campaign._id, { requireActivation: false });
    await campaignService.update(campaign._id, { requireActivation: true });

    expect((await campaignService.statusForUser(campaign.slug, user._id, 0)).eligible).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the refusal is labelled so the cart can act on it', () => {
  /*
    The cart drops a campaign coupon that stopped being the customer's, so they are not
    left with a permanent red error under a promo box they never typed into. It decides
    that from `couponErrorCode`, and getting the labelling wrong is worse than not
    having it — see the NO_TIER case below.
  */

  it('labels an eligibility refusal so the cart drops the coupon', async () => {
    const campaign = await seedCampaign({ requireActivation: true });
    const user = await seedUser();
    const product = await seedProduct(10000);

    const quote = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1 }],
      couponCode: campaign.couponCode,
      userId: user._id,
    });

    expect(quote.couponErrorCode).toBe('campaign');
  });

  it('leaves "add more to unlock" UNLABELLED, or the cart would loop', async () => {
    /*
      The subtle one. Here the customer IS eligible — their cart simply has not reached a
      rung of the cart-value ladder. If this were labelled a campaign refusal, the cart
      would drop the coupon while the auto-apply, which keys on eligibility, put it
      straight back: an apply/remove loop for as long as the basket sat below the
      threshold.
    */
    const campaign = await seedCampaign({
      requireActivation: true,
      productTiers: undefined,
      tiers: [{ id: 'big', label: 'Big', minCartValue: 100000, percent: 10, maxDiscount: null }],
    });
    const user = await seedUser();
    await campaignService.activate(campaign.slug, user._id);
    const product = await seedProduct(1000);   // far below the rung

    const quote = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1 }],
      couponCode: campaign.couponCode,
      userId: user._id,
    });

    expect(quote.couponError).toBe(CAMPAIGN_REASON.NO_TIER);
    expect(quote.couponErrorCode).toBeNull();
  });

  it('leaves an ORDINARY coupon rejection unlabelled', async () => {
    // The customer chose that code themselves. Silently deleting someone's coupon is
    // worse than showing them why it did not work.
    const user = await seedUser();
    const product = await seedProduct(1000);
    await Coupon.create({
      code: 'PLAINMIN', type: 'percentage', value: 10,
      minCartValue: 50000, isActive: true,
    });

    const quote = await pricingService.computeQuote({
      items: [{ product: product._id, quantity: 1 }],
      couponCode: 'PLAINMIN',
      userId: user._id,
    });

    expect(quote.couponError).toBeTruthy();
    expect(quote.couponErrorCode).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('product rates stay identity-free', () => {
  it('publishes the ladder regardless of who is asking', async () => {
    /*
      Deliberate, and worth pinning so nobody "fixes" it later: the rates endpoint
      answers what the CATALOGUE offers, not what a given shopper gets, which is what
      keeps it cacheable and free of per-user data. The landing page needs it to
      advertise the offer to a visitor who has not signed in yet.

      Hiding the badge is the CLIENT's job (useCampaignBadgeVisible, keyed on
      eligibility); refusing the money is evaluate()'s, tested above. Neither depends on
      this response being secret.
    */
    const campaign = await seedCampaign({ requireActivation: true });
    const product = await seedProduct(10000);
    await CampaignProductTier.create({
      campaign: campaign._id, product: product._id, tierCode: 'thanos',
    });

    const rates = await campaignService.productRates(campaign.slug, [String(product._id)]);
    expect(rates.rates[String(product._id)].percent).toBe(8);
  });
});
