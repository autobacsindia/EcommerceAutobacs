/**
 * Reconfigure the /festive campaign as a PUBLIC, per-product-tier offer.
 * DRY RUN BY DEFAULT.
 *
 * This is the QR card going from invitation-only to open. It changes three things on
 * an EXISTING campaign and creates nothing new:
 *
 *   1. audience  list → everyone   (the printed card is public; there is no allowlist)
 *   2. pricing   cart-value tiers → the per-product ladder (Bronkz/Sora/Thanos/Ismpor)
 *   3. a redemption cap, which an 'everyone' campaign must have before it can go live
 *
 * The CampaignMember allowlist is deliberately LEFT IN PLACE. An 'everyone' audience
 * never reads it, so it costs nothing, and it is the record of who the 191 cards went
 * to — deleting it to tidy up would throw away the only copy.
 *
 * Every write goes through campaignService, NOT straight to Mongo, so the engine's own
 * guards run: the two ladders cannot both be set, the managed coupon must still be
 * hidden/linked/one-per-user, and an 'everyone' campaign cannot go live uncapped.
 * A raw update would bypass all of that and fail later, in a customer's cart.
 *
 * WHAT THIS SCRIPT DOES NOT DO: assign products to tiers. That is deliberate. Tier
 * membership is authored in the admin panel from a search query, PREVIEWED, and then
 * committed — because a fuzzy query is the wrong thing to decide a price with. See
 * utils/productTiers.js on the `cbmcup`/`comeup` typo that matched 928 products.
 * Until products are assigned, every line falls to the Ismpor default.
 *
 *   # inspect (writes nothing)
 *   node --import=dotenv/config scripts/configure-festive-public-offer.js \
 *        --max-redemptions=500 --ends=2026-09-30
 *
 *   # write it — campaign stays in its current status
 *   node --import=dotenv/config scripts/configure-festive-public-offer.js \
 *        --max-redemptions=500 --ends=2026-09-30 --apply
 *
 *   # go live, once the tier assignments look right in admin
 *   node --import=dotenv/config scripts/configure-festive-public-offer.js --live --apply
 */

import mongoose from 'mongoose';
import campaignService from '../services/campaignService.js';
import campaignRepository from '../repositories/campaignRepository.js';
import CampaignProductTier from '../models/CampaignProductTier.js';
import { CAMPAIGN_STATUS, CAMPAIGN_AUDIENCE } from '../config/campaign.js';
import { istEndOfDay, formatDateTimeIST } from '../utils/datetime.js';

/** The "everything else" rate, for warning copy. */
const defaultOf = (c) => (c.productTiers || []).find(t => t.isDefault)?.percent ?? '?';

const arg = (n, d = null) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const flag = (n) => process.argv.includes(`--${n}`);
const die = (m) => { console.error(`✗ ${m}`); process.exit(1); };

const APPLY  = flag('apply');
const SLUG   = arg('slug', 'festive-2026');
const ENDS   = arg('ends');
const CAP    = arg('max-redemptions') ? parseInt(arg('max-redemptions'), 10) : null;
const LIVE   = flag('live');
const REVERT = flag('revert-to-list');

/**
 * The agreed ladder. Percentages are the offer; the codes are stable keys that the
 * CampaignProductTier rows point at, so renaming a LABEL is safe but renaming a CODE
 * orphans every assignment already committed against it.
 *
 * Exactly one tier is the default, and it is EXCLUDED from the lowest-wins comparison
 * at assignment time — otherwise 4% would beat 5% and 8% every time and those tiers
 * would silently never pay out (utils/productTiers.js).
 */
const PRODUCT_TIERS = [
  { code: 'bronkz', label: 'Bronkz', percent: 3 },
  { code: 'sora',   label: 'Sora',   percent: 5 },
  { code: 'thanos', label: 'Thanos', percent: 8 },
  { code: 'ismpor', label: 'Ismpor', percent: 4, isDefault: true },
];

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) die('MONGODB_URI is not set.');

  // MANDATORY: autoIndex defaults to true, and this script imports models through the
  // service layer. Merely connecting would build every declared index against whatever
  // cluster the env points at — which for a local .env in this repo is PRODUCTION.
  await mongoose.connect(uri, { autoIndex: false });
  console.log(`Connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  console.log(APPLY ? '\n*** APPLY MODE — this WILL write ***\n' : '\n--- DRY RUN — nothing will be written (pass --apply) ---\n');

  const campaign = await campaignRepository.findBySlug(SLUG);
  if (!campaign) die(`No campaign with slug "${SLUG}".`);

  const before = {
    audience: campaign.audience,
    status: campaign.status,
    cartTiers: campaign.tiers?.length || 0,
    productTiers: campaign.productTiers?.length || 0,
    maxRedemptions: campaign.maxRedemptions,
    redeemedCount: campaign.redeemedCount || 0,
    endsAt: campaign.endsAt,
  };

  console.log(`Campaign "${campaign.name}" [${campaign.slug}]`);
  console.log(`   status          ${before.status}`);
  console.log(`   audience        ${before.audience}`);
  console.log(`   cart tiers      ${before.cartTiers}`);
  console.log(`   product tiers   ${before.productTiers}`);
  console.log(`   cap             ${before.maxRedemptions ?? 'none'}  (redeemed ${before.redeemedCount})`);
  console.log(`   ends            ${before.endsAt ? formatDateTimeIST(before.endsAt) : 'not set'}`);

  /*
    How many products are actually ASSIGNED to each tier.

    The single most important number before going live, and the one the config alone
    cannot tell you: an unassigned product is not an error, it silently takes the
    default tier. So a campaign with a perfect ladder and zero assignments is fully
    valid, passes every gate, and quietly charges the default rate on the entire
    catalogue — including the products meant to earn the top rate.
  */
  if (campaign.productTiers?.length) {
    const counts = await CampaignProductTier.aggregate([
      { $match: { campaign: campaign._id } },
      { $group: { _id: '$tierCode', n: { $sum: 1 } } },
    ]);
    const byCode = Object.fromEntries(counts.map(c => [c._id, c.n]));
    const assigned = counts.reduce((sum, c) => sum + c.n, 0);

    console.log('\nTIER ASSIGNMENTS:');
    for (const t of campaign.productTiers) {
      if (t.isDefault) {
        console.log(`   ${String(t.percent).padStart(3)}%  ${t.label.padEnd(8)} everything not listed above`);
      } else {
        const n = byCode[t.code] || 0;
        console.log(`   ${String(t.percent).padStart(3)}%  ${t.label.padEnd(8)} ${n} product(s)${n === 0 ? '   ⚠ NONE ASSIGNED' : ''}`);
      }
    }
    if (assigned === 0) {
      console.log('\n⚠  NO products are assigned to any tier. Going live now would charge the');
      console.log(`   ${defaultOf(campaign)}% default on the ENTIRE catalogue — including the products`);
      console.log('   meant to earn the top rate. Assign tiers in admin first.');
    }
  }

  /*
    Will `--live` actually succeed?

    Asked here, on every run, because assertPublishable checks things this script never
    touches — that the managed coupon exists, is linked back to THIS campaign, is hidden,
    and carries a per-user limit of 1. Discovering one of those is wrong after spending
    an afternoon assigning products to tiers is a miserable way to find out, so the same
    gate is run read-only up front. It is the real function, not a copy of its rules:
    a reimplementation here would drift from the one that actually decides.
  */
  try {
    await campaignService.assertPublishable({
      ...(campaign.toObject ? campaign.toObject() : campaign),
      status: CAMPAIGN_STATUS.LIVE,
    });
    console.log('\n✓ Go-live preflight passes — --live would succeed.');
  } catch (err) {
    console.log(`\n⚠  Go-live preflight FAILS: ${err.message}`);
    console.log('   Fix this before assigning tiers, or --live will refuse.');
  }

  if (REVERT) {
    // The way back. Restoring the cart-value ladder is NOT this script's job — that
    // configuration is whatever it was before, and guessing at it would be worse than
    // making an operator state it.
    console.log(`\nREVERT: audience → ${CAMPAIGN_AUDIENCE.LIST}, status → ${CAMPAIGN_STATUS.OFF}`);
    if (APPLY) {
      await campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.OFF);
      await campaignService.update(campaign._id, { audience: CAMPAIGN_AUDIENCE.LIST });
      console.log('✓ Reverted to the allowlist audience and switched OFF.');
      console.log('  The cart-value tier ladder was NOT restored — set it in admin.');
    }
    await mongoose.disconnect();
    return;
  }

  if (LIVE) {
    console.log(`\nGO LIVE: status ${before.status} → ${CAMPAIGN_STATUS.LIVE}`);
    if (!APPLY) {
      console.log('\n--- DRY RUN — nothing written. Re-run with --apply. ---');
      await mongoose.disconnect();
      return;
    }
    // setStatus runs assertPublishable, which is what refuses an uncapped 'everyone'
    // campaign, a mislinked coupon, or a campaign with no ladder at all.
    const live = await campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.LIVE);
    console.log(`\n✓ ${live.slug} is LIVE. Anyone who scans the card can now redeem once.`);
    console.log(`  Kill switch:  node --import=dotenv/config scripts/configure-festive-public-offer.js --revert-to-list --apply`);
    await mongoose.disconnect();
    return;
  }

  // ── The reconfiguration ────────────────────────────────────────────────────
  const cap = CAP ?? before.maxRedemptions;
  if (cap == null) {
    die('An "everyone" campaign must have a redemption cap. Pass --max-redemptions=<n>.');
  }
  const endsAt = ENDS ? istEndOfDay(ENDS) : before.endsAt;
  if (!endsAt) die('This campaign has no end date. Pass --ends=YYYY-MM-DD.');

  const update = {
    audience: CAMPAIGN_AUDIENCE.EVERYONE,
    // Cleared in the SAME update as productTiers is set. assertValidConfig refuses both
    // ladders together, so clearing it in a separate call would leave a window in which
    // the campaign is invalid — and, worse, an update that set productTiers while the
    // cart tiers were still populated would simply be rejected.
    tiers: [],
    productTiers: PRODUCT_TIERS,
    maxRedemptions: cap,
    endsAt,
  };

  console.log('\nCHANGES:');
  console.log(`   audience        ${before.audience} → ${update.audience}`);
  console.log(`   cart tiers      ${before.cartTiers} → 0  (replaced by the product ladder)`);
  console.log(`   product tiers   ${before.productTiers} → ${PRODUCT_TIERS.length}`);
  for (const t of PRODUCT_TIERS) {
    console.log(`                      ${String(t.percent).padStart(2)}%  ${t.label}${t.isDefault ? '   ← everything else' : ''}`);
  }
  console.log(`   cap             ${before.maxRedemptions ?? 'none'} → ${cap}`);
  console.log(`   ends            ${before.endsAt ? formatDateTimeIST(before.endsAt) : 'not set'} → ${formatDateTimeIST(endsAt)}`);
  console.log(`   status          ${before.status}  (unchanged — use --live when ready)`);

  /*
    Print the cart-value ladder about to be cleared, in full.

    `--revert-to-list` restores the audience and the off switch, but it cannot restore
    this: the tiers are overwritten in place and nothing else holds a copy. Rather than
    let an operator discover that during a rollback, the configuration they are
    destroying is printed here, at the moment they can still copy it. It is three lines
    of output against an unrecoverable loss.
  */
  if (before.cartTiers > 0) {
    console.log('\n⚠  The cart-value ladder below will be CLEARED and is NOT recoverable');
    console.log('   by --revert-to-list. Copy it if this campaign might ever need it back:');
    for (const t of campaign.tiers) {
      console.log(`     { id: '${t.id}', label: ${t.label ? `'${t.label}'` : 'null'}, ` +
                  `minCartValue: ${t.minCartValue}, percent: ${t.percent}, ` +
                  `maxDiscount: ${t.maxDiscount ?? 'null'} }`);
    }
    console.log(`     resolution: '${campaign.resolution}', maxDiscountPerOrder: ${campaign.maxDiscountPerOrder ?? 'null'}`);
  }

  if (before.redeemedCount > cap) {
    console.log(`\n⚠  ${before.redeemedCount} redemptions have already been taken, which is ` +
                `above the new cap of ${cap}. The offer will read as exhausted immediately.`);
  }

  if (!APPLY) {
    console.log('\n--- DRY RUN — nothing written. Re-run with --apply. ---');
    await mongoose.disconnect();
    return;
  }

  await campaignService.update(campaign._id, update);
  console.log('\n✓ Reconfigured.');
  console.log('\nNEXT, in this order:');
  console.log('  1. Admin → Campaigns → Festive → Product tiers.');
  console.log('     For each tier, paste the search query, REVIEW the matched products,');
  console.log('     deselect anything the query dragged in, then commit.');
  console.log('     Anything left unassigned earns the Ismpor default automatically.');
  console.log('  2. Re-run this script with --live --apply.');
  console.log('  3. Scan the printed QR on a real phone and confirm the discount lands.');
  console.log('\nRollback:  --revert-to-list --apply   (audience back to the allowlist, status OFF)');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('\n✗ Failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
