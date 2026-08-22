/**
 * Admin tooling for a PRODUCT-TIER campaign: the calculator, and editing the ladder.
 *
 * Both exist because the admin screen was built for the cart-value ladder and told an
 * operator two untrue things about a product-tier campaign: that it pays ₹0 (the old
 * calculator resolving an empty `tiers` array), and that its ladder was safe to edit
 * freely (renaming a tier code strands every product assigned to it).
 *
 * The rule these pin down: a tier's CODE is an identifier, its label and percent are
 * cosmetic. Get that backwards and products drop to the default rate in silence.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { useTransactionalDb } from './helpers/replicaSet.js';

import Product from '../models/Product.js';
import Coupon from '../models/Coupon.js';
import Campaign from '../models/Campaign.js';
import CampaignProductTier from '../models/CampaignProductTier.js';

import campaignService from '../services/campaignService.js';
import campaignProductTierService from '../services/campaignProductTierService.js';
import { CAMPAIGN_STATUS, CAMPAIGN_AUDIENCE } from '../config/campaign.js';

jest.setTimeout(120000);

let seq = 0;

const PRODUCT_TIERS = [
  { code: 'bronkz', label: 'Bronkz', percent: 3 },
  { code: 'sora',   label: 'Sora',   percent: 5 },
  { code: 'thanos', label: 'Thanos', percent: 8 },
  { code: 'ismpor', label: 'Ismpor', percent: 4, isDefault: true },
];

const seedProduct = (name, price, onSale = false) => Product.create({
  name, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++seq}`,
  description: 'Test product', price, stock: 'in', brand: 'B', isActive: true,
  ...(onSale ? { originalPrice: price * 2 } : {}),
});

async function seedCampaign(overrides = {}) {
  const code = `LADDER${++seq}`;
  const campaign = await Campaign.create({
    slug: `ladder-${seq}`, name: 'Ladder', status: CAMPAIGN_STATUS.DRAFT,
    audience: CAMPAIGN_AUDIENCE.EVERYONE, endsAt: new Date(Date.now() + 30 * 864e5),
    maxRedemptions: 200, productTiers: PRODUCT_TIERS, tiers: [], couponCode: code,
    ...overrides,
  });
  await Coupon.create({
    code, type: 'percentage', value: 0, visibility: 'hidden',
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
describe('editing the product ladder', () => {
  it('allows a label and percentage change on a tier that has products', async () => {
    const campaign = await seedCampaign();
    const product = await seedProduct('Thing', 10000);
    await CampaignProductTier.create({
      campaign: campaign._id, product: product._id, tierCode: 'thanos',
    });

    // The code is untouched, so every assignment still resolves. This must stay easy —
    // changing a rate is the ordinary reason to open this screen.
    const updated = await campaignService.update(campaign._id, {
      productTiers: PRODUCT_TIERS.map(t =>
        t.code === 'thanos' ? { ...t, label: 'Thanos Prime', percent: 9 } : t),
    });

    const thanos = updated.productTiers.find(t => t.code === 'thanos');
    expect(thanos.percent).toBe(9);
    expect(thanos.label).toBe('Thanos Prime');
  });

  it('REFUSES to remove a tier that still has products assigned', async () => {
    const campaign = await seedCampaign();
    const product = await seedProduct('Thing', 10000);
    await CampaignProductTier.create({
      campaign: campaign._id, product: product._id, tierCode: 'thanos',
    });

    // Silently dropping those products from 8% to the 4% default is the failure this
    // prevents — no error, no warning, and nothing in the ladder to reveal it.
    await expect(campaignService.update(campaign._id, {
      productTiers: PRODUCT_TIERS.filter(t => t.code !== 'thanos'),
    })).rejects.toThrow(/thanos.*1 product/i);
  });

  it('REFUSES to rename a code that still has products assigned', async () => {
    const campaign = await seedCampaign();
    const product = await seedProduct('Thing', 10000);
    await CampaignProductTier.create({
      campaign: campaign._id, product: product._id, tierCode: 'thanos',
    });

    // A rename is a remove-and-add as far as the assignment rows are concerned.
    await expect(campaignService.update(campaign._id, {
      productTiers: PRODUCT_TIERS.map(t => t.code === 'thanos' ? { ...t, code: 'thanos2' } : t),
    })).rejects.toThrow(/thanos/i);
  });

  it('allows removing a tier once nothing is assigned to it', async () => {
    const campaign = await seedCampaign();
    const updated = await campaignService.update(campaign._id, {
      productTiers: PRODUCT_TIERS.filter(t => t.code !== 'thanos'),
    });
    expect(updated.productTiers.map(t => t.code)).not.toContain('thanos');
  });

  it('still requires exactly one default tier', async () => {
    const campaign = await seedCampaign();
    await expect(campaignService.update(campaign._id, {
      productTiers: PRODUCT_TIERS.map(t => ({ ...t, isDefault: false })),
    })).rejects.toThrow(/default/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the product calculator', () => {
  it('refuses on a campaign that is not priced by product tiers', async () => {
    const campaign = await seedCampaign({
      productTiers: undefined,
      tiers: [{ id: 't', label: 'T', minCartValue: 0, percent: 10, maxDiscount: null }],
    });
    // Better than the old behaviour, which resolved an empty ladder and reported ₹0 —
    // an operator reads that as "the offer pays nothing", not "wrong tool".
    await expect(campaignProductTierService.simulateProducts(campaign._id, { query: 'thing' }))
      .rejects.toThrow(/not priced by product tiers/i);
  });

  it('distinguishes an assigned tier from the unassigned default', async () => {
    const campaign = await seedCampaign();
    const assigned = await seedProduct('Zzqq Assigned', 10000);
    const loose = await seedProduct('Zzqq Loose', 10000);
    await CampaignProductTier.create({
      campaign: campaign._id, product: assigned._id, tierCode: 'thanos',
    });

    const result = await campaignProductTierService.simulateProducts(campaign._id, { query: 'Zzqq' });
    const byId = Object.fromEntries(result.products.map(r => [r.id, r]));

    expect(byId[String(assigned._id)]).toMatchObject({
      tierCode: 'thanos', percent: 8, unassigned: false, savesRupees: 800,
    });
    /*
      The whole point of the tool. In the discount column a product sitting at the
      default because nobody assigned it looks identical to one deliberately left as
      "everything else" — `unassigned` is the only thing that tells them apart, and
      forgetting to assign is the mistake that actually happens.
    */
    expect(byId[String(loose._id)]).toMatchObject({
      tierCode: 'ismpor', percent: 4, unassigned: true, savesRupees: 400,
    });
    expect(result.unassignedCount).toBe(1);
  });

  it('shows the on-sale ceiling, and says it was capped', async () => {
    const campaign = await seedCampaign();
    const onSale = await seedProduct('Wwvv Sale', 10000, true);
    await CampaignProductTier.create({
      campaign: campaign._id, product: onSale._id, tierCode: 'thanos',
    });

    const result = await campaignProductTierService.simulateProducts(campaign._id, { query: 'Wwvv' });
    expect(result.products[0]).toMatchObject({ percent: 2, onSaleCapped: true, savesRupees: 200 });
    expect(result.cappedCount).toBe(1);
  });

  it('multiplies by quantity', async () => {
    const campaign = await seedCampaign();
    const product = await seedProduct('Yyuu Bulk', 10000);
    await CampaignProductTier.create({
      campaign: campaign._id, product: product._id, tierCode: 'thanos',
    });

    const result = await campaignProductTierService.simulateProducts(
      campaign._id, { query: 'Yyuu', quantity: 3 },
    );
    expect(result.products[0]).toMatchObject({ lineRupees: 30000, savesRupees: 2400 });
  });

  it('reports the order cap separately, because per-line figures do not include it', async () => {
    const campaign = await seedCampaign({ maxDiscountPerOrder: 50000 });
    await seedProduct('Ttrr Capped', 10000);
    const result = await campaignProductTierService.simulateProducts(campaign._id, { query: 'Ttrr' });
    // A real cart of these may save LESS than the column sums to; the caller has to be
    // able to say so rather than implying the figures add up.
    expect(result.orderCapRupees).toBe(50000);
  });
});
