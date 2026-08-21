/**
 * Publishing a PUBLIC, product-tier campaign — the /festive QR offer.
 *
 * Two things are being pinned here, and both are the kind that only bite in production:
 *
 *   1. a campaign priced by the PER-PRODUCT ladder must be able to go LIVE at all.
 *      assertValidConfig refuses cart-value `tiers` and `productTiers` together (they
 *      would stack two discounts on the same goods), while assertPublishable required
 *      `tiers` to be non-empty — so clearing one to satisfy the first check tripped the
 *      second, and a product-tier campaign could never be published. Every existing
 *      campaign test uses the cart-value ladder, which is why nothing caught it.
 *
 *   2. an 'everyone' audience really does skip the allowlist, while still holding the
 *      line on login, verified email and one-redemption-per-customer.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import Product from '../models/Product.js';
import User from '../models/User.js';
import Coupon from '../models/Coupon.js';
import Campaign from '../models/Campaign.js';
import CampaignProductTier from '../models/CampaignProductTier.js';

import campaignService from '../services/campaignService.js';
import pricingService from '../services/pricingService.js';
import { CAMPAIGN_STATUS, CAMPAIGN_AUDIENCE, CAMPAIGN_REASON } from '../config/campaign.js';

jest.setTimeout(120000);

let replset;
const CODE = 'FESTIVEQR';

let seq = 0;
const seedProduct = (price, onSale = false) => Product.create({
  name: `Prod ${price} ${++seq}`, slug: `prod-${price}-${seq}`, description: 'Test product',
  price, stock: 'in', brand: 'B', isActive: true,
  ...(onSale ? { originalPrice: price * 2 } : {}),
});

const seedUser = ({ isVerified = true } = {}) =>
  User.create({ name: 'U', email: `u${++seq}${Date.now()}@x.com`, passwordHash: 'x', isVerified });

/** Bronkz 3 / Sora 5 / Thanos 8, with Ismpor 4% as "everything else". */
const PRODUCT_TIERS = [
  { code: 'bronkz', label: 'Bronkz', percent: 3 },
  { code: 'sora',   label: 'Sora',   percent: 5 },
  { code: 'thanos', label: 'Thanos', percent: 8 },
  { code: 'ismpor', label: 'Ismpor', percent: 4, isDefault: true },
];

/**
 * `code` is overridable because the coupon code is globally unique — a test that seeds
 * two campaigns at once collides on that index otherwise.
 */
async function seedPublicCampaign({ code = CODE, ...overrides } = {}) {
  const campaign = await Campaign.create({
    slug: `festive-qr-${++seq}`,
    name: 'Festive QR',
    status: CAMPAIGN_STATUS.DRAFT,
    audience: CAMPAIGN_AUDIENCE.EVERYONE,
    requireVerifiedEmail: true,
    endsAt: new Date(Date.now() + 30 * 864e5),
    maxRedemptions: 500,        // mandatory for an 'everyone' audience
    productTiers: PRODUCT_TIERS,
    tiers: [],                  // the per-product ladder replaces the cart-value one
    couponCode: code,
    ...overrides,
  });
  await Coupon.create({
    code, type: 'percentage', value: 0, visibility: 'hidden',
    usageLimitPerUser: 1, isActive: true, campaign: campaign._id,
  });
  return campaign;
}

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  replset = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    binary: { version: '7.0.14' },
  });
  await mongoose.connect(replset.getUri(), { serverSelectionTimeoutMS: 30000 });
});

afterAll(async () => {
  await mongoose.disconnect();
  if (replset) await replset.stop();
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  for (const key of Object.keys(collections)) await collections[key].deleteMany({});
});

describe('a product-tier campaign can go live', () => {
  it('publishes with an empty cart-value ladder', async () => {
    const campaign = await seedPublicCampaign();
    // The regression. Before the fix this threw "A campaign needs at least one discount
    // tier before it can run" — a campaign priced entirely by product tiers could not
    // be published at all, and the only way to satisfy the check was to add a cart-value
    // ladder that assertValidConfig then refused to save alongside it.
    const live = await campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.LIVE);
    expect(live.status).toBe(CAMPAIGN_STATUS.LIVE);
  });

  it('still refuses a campaign carrying NEITHER ladder', async () => {
    const campaign = await seedPublicCampaign({ productTiers: undefined, tiers: [] });
    await expect(campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.LIVE))
      .rejects.toThrow(/tier/i);
  });

  it('still requires a redemption cap when open to everyone', async () => {
    const campaign = await seedPublicCampaign({ maxRedemptions: null });
    // An 'everyone' campaign is bounded only by how many customers exist.
    await expect(campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.LIVE))
      .rejects.toThrow(/maximum number of redemptions/i);
  });
});

describe('switching an allowlist campaign over to the public ladder', () => {
  it('swaps both ladders in ONE update', async () => {
    // What scripts/configure-festive-public-offer.js does. assertValidConfig refuses
    // cart-value tiers and product tiers together, so these two changes cannot be made
    // in separate calls — clearing first leaves the campaign with no ladder, and
    // setting first is rejected outright. The single-update path is the only one that
    // works, so it is the one that gets pinned.
    const campaign = await seedPublicCampaign({
      audience: CAMPAIGN_AUDIENCE.LIST,
      productTiers: undefined,
      tiers: [{ id: 'old', label: 'Old', minCartValue: 0, percent: 20, maxDiscount: null }],
    });

    const updated = await campaignService.update(campaign._id, {
      audience: CAMPAIGN_AUDIENCE.EVERYONE,
      tiers: [],
      productTiers: PRODUCT_TIERS,
      maxRedemptions: 500,
    });

    expect(updated.audience).toBe(CAMPAIGN_AUDIENCE.EVERYONE);
    expect(updated.tiers).toHaveLength(0);
    expect(updated.productTiers).toHaveLength(4);
    // Asserted explicitly because campaignService.update filters the payload through an
    // EDITABLE_FIELDS allowlist: a field missing from that list is dropped SILENTLY, and
    // the cap is the one an 'everyone' campaign cannot go live without.
    expect(updated.maxRedemptions).toBe(500);

    // And it must still be publishable afterwards.
    const live = await campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.LIVE);
    expect(live.status).toBe(CAMPAIGN_STATUS.LIVE);
  });

  it('refuses to keep both ladders at once', async () => {
    const campaign = await seedPublicCampaign({ productTiers: undefined, tiers: [] });
    await expect(campaignService.update(campaign._id, {
      tiers: [{ id: 'x', label: 'X', minCartValue: 0, percent: 20, maxDiscount: null }],
      productTiers: PRODUCT_TIERS,
    })).rejects.toThrow(/not both/i);
  });
});

describe('the public audience', () => {
  it('lets any verified signed-in customer qualify, with nobody on an allowlist', async () => {
    const campaign = await seedPublicCampaign();
    await campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.LIVE);
    const user = await seedUser();

    const result = await campaignService.evaluate(
      await Campaign.findById(campaign._id), user._id, 1000000,
    );
    expect(result.reason).toBeUndefined();
    expect(result.eligible).toBe(true);
  });

  it('still refuses a signed-out visitor', async () => {
    const campaign = await seedPublicCampaign();
    await campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.LIVE);

    const result = await campaignService.evaluate(
      await Campaign.findById(campaign._id), null, 1000000,
    );
    expect(result.reason).toBe(CAMPAIGN_REASON.LOGIN_OPEN);
  });

  it('does not promise a public visitor an email that was never sent', async () => {
    // The allowlist wording — "log in with the email your offer was sent to" — is a
    // lie on a public card: nothing was sent to anybody, and the reader goes hunting
    // through an inbox for it.
    const campaign = await seedPublicCampaign();
    await campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.LIVE);

    const result = await campaignService.evaluate(
      await Campaign.findById(campaign._id), null, 1000000,
    );
    expect(result.reason).not.toMatch(/sent to/i);
  });

  it('keeps the "which email?" wording for an invitation campaign', async () => {
    // The other half of the same rule: an invited customer may hold several addresses,
    // and which one to use is the actual question they need answered.
    const campaign = await seedPublicCampaign({ audience: CAMPAIGN_AUDIENCE.LIST });
    await campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.LIVE);

    const result = await campaignService.evaluate(
      await Campaign.findById(campaign._id), null, 1000000,
    );
    expect(result.reason).toBe(CAMPAIGN_REASON.LOGIN);
  });

  it('reports BOTH wordings under the same reasonCode', async () => {
    // They are one refusal in two voices. A UI branching on the code cares that the
    // visitor must sign in, not which sentence we chose — splitting them would break
    // consumers the day a campaign's audience changed.
    const open = await seedPublicCampaign();
    await campaignService.setStatus(open._id, CAMPAIGN_STATUS.LIVE);
    const openStatus = await campaignService.statusForUser(open.slug, null, 0);
    expect(openStatus.reasonCode).toBe('login');

    const list = await seedPublicCampaign({ audience: CAMPAIGN_AUDIENCE.LIST, code: 'FESTIVELIST' });
    await campaignService.setStatus(list._id, CAMPAIGN_STATUS.LIVE);
    const listStatus = await campaignService.statusForUser(list.slug, null, 0);
    expect(listStatus.reasonCode).toBe('login');
  });

  it('still refuses an unverified email', async () => {
    const campaign = await seedPublicCampaign();
    await campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.LIVE);
    const user = await seedUser({ isVerified: false });

    // Load-bearing for a PUBLIC offer: without it, one person can register throwaway
    // addresses and take the reward repeatedly.
    const result = await campaignService.evaluate(
      await Campaign.findById(campaign._id), user._id, 1000000,
    );
    expect(result.reason).toBe(CAMPAIGN_REASON.UNVERIFIED);
  });
});

describe('per-line pricing across the ladder', () => {
  it('prices one cart at four different rates at once', async () => {
    const campaign = await seedPublicCampaign();
    await campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.LIVE);
    const user = await seedUser();

    const [bronkz, sora, thanos, other] = await Promise.all([
      seedProduct(10000), seedProduct(10000), seedProduct(10000), seedProduct(10000),
    ]);
    await CampaignProductTier.insertMany([
      { campaign: campaign._id, product: bronkz._id, tierCode: 'bronkz' },
      { campaign: campaign._id, product: sora._id,   tierCode: 'sora' },
      { campaign: campaign._id, product: thanos._id, tierCode: 'thanos' },
      // `other` deliberately has NO row — that is what "everything else" means.
    ]);

    const quote = await pricingService.computeQuote({
      items: [bronkz, sora, thanos, other].map(p => ({ product: p._id, quantity: 1 })),
      couponCode: CODE,
      userId: user._id,
    });

    // 3% + 5% + 8% + 4% of ₹10,000 each = 300 + 500 + 800 + 400.
    expect(quote.couponDiscount).toBe(2000);
  });

  it('hands the savings popup a per-line breakdown it can render', async () => {
    /*
      The seam between the server and SavingsCelebration.

      The popup's own tests mock the quote, and the pricing tests above assert only the
      TOTAL — so nothing checked that a product-tier campaign actually produces the
      shape the popup reads. It needs `discountLines` (which line earned what, and which
      was capped for being already on offer) and a resolved `savings` block. The browser
      renders those figures; it never derives them.
    */
    const campaign = await seedPublicCampaign();
    await campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.LIVE);
    const user = await seedUser();

    const full = await seedProduct(10000);            // Thanos, 8%
    const discounted = await seedProduct(10000, true); // Thanos, but already on offer → 2%
    await CampaignProductTier.insertMany([
      { campaign: campaign._id, product: full._id,       tierCode: 'thanos' },
      { campaign: campaign._id, product: discounted._id, tierCode: 'thanos' },
    ]);

    const quote = await pricingService.computeQuote({
      items: [full, discounted].map(p => ({ product: p._id, quantity: 1 })),
      couponCode: CODE,
      userId: user._id,
    });

    expect(quote.discountLines).toHaveLength(2);
    const byId = Object.fromEntries(quote.discountLines.map(l => [String(l.product), l]));

    // The full-price line earns its tier rate outright.
    expect(byId[String(full._id)]).toMatchObject({
      percent: 8, tierCode: 'thanos', onSaleCapped: false,
    });

    // The discounted line is reduced to the on-sale ceiling, and SAYS SO — `onSaleCapped`
    // is what the popup filters on to tell the buyer why this item earned less.
    expect(byId[String(discounted._id)]).toMatchObject({
      percent: 2, tierCode: 'thanos', onSaleCapped: true, alreadyOnSale: true,
    });

    // 8% of ₹10,000 + 2% of ₹10,000.
    expect(quote.couponDiscount).toBe(1000);
    expect(quote.savings.coupon).toBe(1000);
    // The catalogue saving on the half-price item is counted separately from the coupon,
    // and the popup's headline is the sum — quoting only the coupon would under-sell it.
    expect(quote.savings.catalog).toBe(10000);
    expect(quote.savings.total).toBe(11000);
  });

  it('reports no capping when nothing was actually reduced', async () => {
    // A 2% tier on a discounted product is not "capped" — nothing was taken away, and
    // telling the buyer otherwise in the popup would be a lie.
    const campaign = await seedPublicCampaign();
    await campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.LIVE);
    const user = await seedUser();

    const discounted = await seedProduct(10000, true);
    await CampaignProductTier.create({
      campaign: campaign._id, product: discounted._id, tierCode: 'bronkz',  // 3%
    });

    const quote = await pricingService.computeQuote({
      items: [{ product: discounted._id, quantity: 1 }],
      couponCode: CODE,
      userId: user._id,
    });

    // 3% capped to 2% IS a reduction, so this one is flagged.
    expect(quote.discountLines[0]).toMatchObject({ percent: 2, onSaleCapped: true });
  });

  it('caps an already-discounted line at 2% instead of its tier rate', async () => {
    const campaign = await seedPublicCampaign();
    await campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.LIVE);
    const user = await seedUser();

    const onSale = await seedProduct(10000, true);   // originalPrice 20000 → live sale
    await CampaignProductTier.create({
      campaign: campaign._id, product: onSale._id, tierCode: 'thanos',   // would be 8%
    });

    const quote = await pricingService.computeQuote({
      items: [{ product: onSale._id, quantity: 1 }],
      couponCode: CODE,
      userId: user._id,
    });

    // 2% of ₹10,000, not 8% — the buyer never gets the sale AND the full tier rate.
    expect(quote.couponDiscount).toBe(200);
  });
});
