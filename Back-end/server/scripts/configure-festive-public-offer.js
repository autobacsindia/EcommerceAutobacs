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
 *   # prove it on the real site, for named testers only, before anyone else can see it
 *   node --import=dotenv/config scripts/configure-festive-public-offer.js \
 *        --testing=you@autobacsindia.com --apply
 *
 *   # go live, once the tier assignments look right in admin
 *   node --import=dotenv/config scripts/configure-festive-public-offer.js --live --apply
 *
 *   # restrict the offer to customers who came through the printed card, and back again
 *   node --import=dotenv/config scripts/configure-festive-public-offer.js --activation-gate=on  --apply
 *   node --import=dotenv/config scripts/configure-festive-public-offer.js --activation-gate=off --apply
 */

import mongoose from 'mongoose';
import campaignService from '../services/campaignService.js';
import Coupon from '../models/Coupon.js';
import campaignRepository from '../repositories/campaignRepository.js';
import CampaignProductTier from '../models/CampaignProductTier.js';
import CampaignMember from '../models/CampaignMember.js';
import { CAMPAIGN_STATUS, CAMPAIGN_AUDIENCE } from '../config/campaign.js';
import { istEndOfDay, formatDateTimeIST } from '../utils/datetime.js';

/** The "everything else" rate, for warning copy. */
const defaultOf = (c) => (c.productTiers || []).find(t => t.isDefault)?.percent ?? '?';

const die = (m) => { console.error(`✗ ${m}`); process.exit(1); };

/**
 * Read a `--name=value` argument.
 *
 * Refuses the space-separated form outright instead of ignoring it, because ignoring it
 * here is genuinely dangerous. Every `--name=value` option selects a MODE, and each mode
 * returns early; a value that silently parses as null does not just lose its own
 * argument, it falls through to the bottom of the script — the full reconfiguration,
 * which rewrites the tier ladder, the cap and the end date on a LIVE campaign. So
 * `--activation-gate on` would have flipped no gate and rewritten the offer instead.
 *
 * Safe against the `flag()` options (--apply, --live, --revert-to-list, --create, --test)
 * because no name is read both ways.
 */
const arg = (n, d = null) => {
  if (process.argv.includes(`--${n}`)) {
    die(`--${n} needs a value: write --${n}=<value>, not --${n} <value>.`);
  }
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const flag = (n) => process.argv.includes(`--${n}`);

const APPLY  = flag('apply');
const SLUG   = arg('slug', 'festive-2026');
const ENDS   = arg('ends');
const CAP    = arg('max-redemptions') ? parseInt(arg('max-redemptions'), 10) : null;
const LIVE   = flag('live');
const TESTERS = arg('testing');   // comma-separated emails
const REVERT = flag('revert-to-list');
const CREATE = flag('create');
const USE_TEST = flag('test');
const CODE   = arg('code', 'FESTIVE2026').toUpperCase();
// 'on' | 'off' — the activation gate, flipped on its own. See the GATE block below.
// Validated at parse time so a typo cannot fall through to a different mode.
const GATE   = arg('activation-gate');
if (GATE !== null && GATE !== 'on' && GATE !== 'off') {
  die(`--activation-gate must be "on" or "off" (got "${GATE}").`);
}

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
  /*
    Which database. `--test` is an explicit opt-in to the test tier rather than something
    inferred, because the two are configured in the same session and the difference
    between them is "real customers" and "nobody".
  */
  let uri = USE_TEST
    ? process.env.TEST_MONGODB_URI
    : (process.env.MONGODB_URI || process.env.MONGO_URI);

  if (!uri) {
    die(USE_TEST
      ? 'TEST_MONGODB_URI is not set in .env.'
      : 'MONGODB_URI is not set.');
  }

  /*
    A connection string with no database in its path makes Mongoose quietly use one
    called `test` — so the script would appear to work, report success, and write the
    campaign somewhere nothing reads. The test cluster's URI is the one that tends to
    arrive in this shape. Append the database rather than failing: the intent is never
    ambiguous, and a hard error here would just be a puzzle.
  */
  if (!/mongodb(\+srv)?:\/\/[^/]+\/[^?]+/.test(uri)) {
    const [base, qs] = uri.split('?');
    uri = `${base.replace(/\/$/, '')}/autobacs${qs ? `?${qs}` : ''}`;
    console.log('ℹ  No database in the connection string — using /autobacs.');
  }

  // MANDATORY: autoIndex defaults to true, and this script imports models through the
  // service layer. Merely connecting would build every declared index against whatever
  // cluster the env points at — which for a local .env in this repo is PRODUCTION.
  await mongoose.connect(uri, { autoIndex: false });

  /*
    Say WHICH cluster this is, loudly, before anything else.

    This campaign is configured in two places — the test tier for rehearsing the customer
    journey, production for the assignments that actually charge people — so the same
    command gets run against two databases on the same afternoon. The host string alone
    is easy to skim past at the top of a wall of output; the word PRODUCTION is not.
  */
  const host = mongoose.connection.host || '';
  const isProd = /nrdity|cluster0/i.test(host);
  const banner = isProd ? '⛔ PRODUCTION — real customers' : '🧪 TEST TIER — safe to experiment';
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  ${banner}`);
  console.log(`  ${host}/${mongoose.connection.name}`);
  console.log(`${'═'.repeat(64)}`);
  console.log(APPLY ? '\n*** APPLY MODE — this WILL write ***\n' : '\n--- DRY RUN — nothing will be written (pass --apply) ---\n');

  let campaign = await campaignRepository.findBySlug(SLUG);

  /*
    Create it if it is missing — the path that matters on the TEST tier.

    The test database is a snapshot, so a campaign created on production afterwards
    simply is not there. Without this, rehearsing the offer on test would mean seeding a
    campaign with one script and then converting it with this one, and the intermediate
    state is an invitation-only cart-value offer that nobody wants. One command instead.

    Created as DRAFT, which applies to nobody, so this can never switch anything on by
    accident. The managed coupon is created alongside and linked back, because the
    go-live check refuses a campaign whose coupon is missing or unlinked.
  */
  if (!campaign) {
    if (!CREATE) {
      die(`No campaign with slug "${SLUG}". Pass --create to make one ` +
          `(intended for the test tier, where the snapshot predates it).`);
    }
    if (!ENDS) die('--create needs an end date, e.g. --ends=2026-08-31');
    if (CAP == null) die('--create needs a cap, e.g. --max-redemptions=200');

    console.log(`\nCREATE campaign "${SLUG}" + coupon ${CODE} (as draft)`);
    if (!APPLY) {
      console.log('\n--- DRY RUN — nothing written. Re-run with --apply. ---');
      await mongoose.disconnect();
      return;
    }

    campaign = await campaignService.create({
      slug: SLUG,
      name: 'Festive 2026 — Thank You Reward',
      description: 'Public thank-you offer, distributed by QR on a printed card.',
      status: CAMPAIGN_STATUS.DRAFT,
      audience: CAMPAIGN_AUDIENCE.EVERYONE,
      requireVerifiedEmail: true,
      endsAt: istEndOfDay(ENDS),
      maxRedemptions: CAP,
      productTiers: PRODUCT_TIERS,
      tiers: [],
      couponCode: CODE,
      landingPath: '/festive',
    });

    // Upserted, not created outright: a re-run after a half-finished attempt must not
    // trip the unique index on `code` and leave the campaign with no coupon.
    await Coupon.findOneAndUpdate(
      { code: CODE },
      {
        $set: { campaign: campaign._id, visibility: 'hidden', usageLimitPerUser: 1, isActive: true },
        $setOnInsert: { code: CODE, type: 'percentage', value: 0 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    console.log(`✓ Created. Now assign products to tiers in admin, then re-run with --live --apply.`);
    await mongoose.disconnect();
    return;
  }

  const before = {
    audience: campaign.audience,
    status: campaign.status,
    cartTiers: campaign.tiers?.length || 0,
    productTiers: campaign.productTiers?.length || 0,
    maxRedemptions: campaign.maxRedemptions,
    redeemedCount: campaign.redeemedCount || 0,
    endsAt: campaign.endsAt,
    requireActivation: !!campaign.requireActivation,
  };

  /*
    How many customers have actually come through the card.

    Printed before the gate is flipped because it is the one number that says what
    turning it on will COST: with the gate on, this is the entire audience. Zero here
    and a live campaign means switching on would take the offer away from everyone at
    once, which is a thing to know before doing it rather than after.
  */
  const activatedCount = await CampaignMember.countDocuments({
    campaign: campaign._id,
    activatedAt: { $ne: null },
  });

  console.log(`Campaign "${campaign.name}" [${campaign.slug}]`);
  console.log(`   status          ${before.status}`);
  console.log(`   audience        ${before.audience}`);
  console.log(`   cart tiers      ${before.cartTiers}`);
  console.log(`   product tiers   ${before.productTiers}`);
  console.log(`   cap             ${before.maxRedemptions ?? 'none'}  (redeemed ${before.redeemedCount})`);
  console.log(`   activation gate ${before.requireActivation ? 'ON — landing-page visitors only' : 'off — every signed-in customer'}  (${activatedCount} activated)`);
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

  if (GATE !== null) {
    /*
      The activation gate, on its own switch.

      Kept as a standalone mode rather than folded into the main reconfiguration for the
      same reason --live is: this runs against a campaign that is already LIVE and taking
      real money, and the operator flipping one boolean must not also re-apply the tier
      ladder, the cap and the end date as a side effect.

      Order of operations matters and is the house rule: the code that HONOURS this flag
      ships first and is verified in production, and only then is the flag turned on. The
      field defaults to false, so a deploy alone changes nothing for anybody.

      ON:  the offer reaches only customers who activated it from the landing page —
           i.e. who arrived via the printed card. Everyone who signed up through the
           ordinary registration form loses it, including any who can see it today.
      OFF: instant rollback to the open behaviour. No deploy, no data change.
    */
    const on = GATE === 'on';

    console.log(`\nACTIVATION GATE: ${before.requireActivation ? 'on' : 'off'} → ${on ? 'on' : 'off'}`);
    if (on) {
      console.log(`   Only customers who open ${campaign.landingPath || 'the landing page'} while signed in will`);
      console.log('   get this offer. Ordinary sign-ups stop seeing it everywhere: product cards,');
      console.log('   the ribbon, the cart, and the checkout discount itself.');
      console.log(`   ${activatedCount} customer(s) have activated so far.`);
      if (before.redeemedCount > 0) {
        console.log(`   ${before.redeemedCount} redemption(s) already banked — those orders are snapshotted`);
        console.log('   and are NOT affected.');
      }
    } else {
      console.log('   Reverting to the open offer: every signed-in, verified customer gets it again.');
    }

    if (!APPLY) {
      console.log('\n--- DRY RUN — nothing written. Re-run with --apply. ---');
      await mongoose.disconnect();
      return;
    }
    await campaignService.update(campaign._id, { requireActivation: on });
    console.log(`\n✓ Activation gate is ${on ? 'ON' : 'OFF'}.`);
    console.log(`  Rollback:  node --import=dotenv/config scripts/configure-festive-public-offer.js --activation-gate=${on ? 'off' : 'on'} --apply`);
    await mongoose.disconnect();
    return;
  }

  if (TESTERS !== null) {
    /*
      TESTING mode: the offer runs on the real site, with real payment, but applies ONLY
      to the listed addresses. Everyone else sees no discount at all.

      This is the way to prove the money path before customers can reach it. A Vercel
      preview deploy does NOT do the same job: the campaign is a document in the
      production database and a preview frontend still talks to the production API, so
      it sees the same campaign in the same state. Isolation comes from WHO qualifies,
      not from which build is serving the page.
    */
    const emails = TESTERS.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    if (!emails.length) die('--testing needs at least one email, e.g. --testing=you@autobacsindia.com');

    console.log(`\nTESTING MODE: status ${before.status} → ${CAMPAIGN_STATUS.TESTING}`);
    emails.forEach(e => console.log(`   only ${e} will get the discount`));
    if (!APPLY) {
      console.log('\n--- DRY RUN — nothing written. Re-run with --apply. ---');
      await mongoose.disconnect();
      return;
    }
    // testerEmails must be saved BEFORE the status flips: assertPublishable refuses
    // testing mode with an empty tester list, and a half-applied change would leave the
    // campaign in a state it rejects.
    await campaignService.update(campaign._id, { testerEmails: emails });
    await campaignService.setStatus(campaign._id, CAMPAIGN_STATUS.TESTING);
    console.log(`\n✓ Now in TESTING. Sign in as one of those addresses and the discount applies.`);
    console.log(`  Nobody else is affected. Go live with --live --apply when satisfied.`);
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
