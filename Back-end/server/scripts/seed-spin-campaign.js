/**
 * Seed a Spin-to-Win campaign with its goodies and its guaranteed coupon fallback.
 *
 * The engine ships with NO campaign configured — a fresh database has zero SpinCampaign
 * rows, which is why the wheel never appears. This is the one-shot that gives it
 * something to run, so the whole chain (order → spin → goodie on the packing slip →
 * coupon on the next order) can be walked end to end.
 *
 * ── Safety (follows scripts/purge-test-account-data.js) ──────────────────────
 *   • DRY-RUN by default. Prints exactly what it would write and exits. `--apply` writes.
 *   • Idempotent by campaign SLUG. Re-running finds the existing campaign and reports it
 *     rather than creating a second one — two live campaigns would have the wheel pick
 *     whichever Mongo returned first.
 *   • Creates the campaign as `draft`, and DELIBERATELY CANNOT PUBLISH IT. A draft offers
 *     no wheel, so nothing reaches a customer from this script alone. Going live is done
 *     from /admin/spin — see "Why publishing is not a flag here" below.
 *   • `{ autoIndex: false }` on connect. CLAUDE.md: connecting with models imported and
 *     autoIndex on builds every declared index against whatever cluster this points at,
 *     which for the committed .env is PRODUCTION.
 *   • Runs with Redis DISABLED (see the `delete` below), so it never dials a cache host
 *     — which is also why it must not be the thing that publishes.
 *
 * ── Why publishing is not a flag here ────────────────────────────────────────
 * "Which campaign is live" is CACHED, and the ABSENCE of a campaign is cached too
 * (spinService.getLiveCampaignCached wraps it in an envelope precisely so a `null`
 * caches). Right now that cached answer is "no campaign". Flipping status to `live` in
 * Mongo without purging `public:spin:*` would leave the storefront serving the cached
 * "no campaign" until the TTL expired — the wheel simply would not appear, and nothing
 * would look broken.
 *
 * The model's post-save hook does purge that key — but only when a working cache client
 * exists, and this script runs without one. The admin publish endpoint runs on Railway
 * where Redis is reachable, and purges inline before responding. So publishing belongs
 * there. This script still RUNS the publish gate and reports it, so you learn about a
 * misconfiguration now rather than from a red toast later.
 *
 * ── Rollback ─────────────────────────────────────────────────────────────────
 * Nothing here touches orders, money, products or Elasticsearch — it only inserts into
 * `spincampaigns` and `spinprizes`. To undo, before anyone has spun:
 *
 *     node --import=dotenv/config scripts/seed-spin-campaign.js --rollback --apply
 *
 * which deletes the campaign and its prizes BUT REFUSES if any SpinResult references it
 * — those rows are the audit trail for physical stock that left the building, and
 * deleting their campaign orphans every winner. To stop a live campaign instead, set its
 * status to `off` in the admin panel: instant, reversible, and keeps the history.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *     npm run seed-spin-campaign                      # dry run, shows the plan
 *     npm run seed-spin-campaign -- --apply           # create as DRAFT
 *     npm run seed-spin-campaign -- --slug diwali-2026 --days 30 --apply
 *     npm run seed-spin-campaign -- --rollback --apply
 */

/*
  ⚠️ MUST come before the imports below, which is why they are dynamic.

  services/redisClient.js constructs its ioredis client at MODULE LOAD, gated on this
  variable, and the import graph reaches it (spinService → cacheService → redisClient).
  A static import would therefore dial the cache host before the first line of this
  script ran — and against an unreachable host that is not a warning but a process kill:
  ioredis flushes its pending queue with an uncaught "Connection is closed."

  This repo has shipped that exact bug twice in test files (crmOfflineJourney,
  orderStatusNotificationEnqueue). A seed script needs no cache, so the fix is to make
  sure no client is ever built.
*/
delete process.env.REDIS_URL;

const mongoose = (await import('mongoose')).default;
const SpinCampaign = (await import('../models/SpinCampaign.js')).default;
const SpinPrize = (await import('../models/SpinPrize.js')).default;
const SpinResult = (await import('../models/SpinResult.js')).default;
const spinService = (await import('../services/spinService.js')).default;
const { SPIN_STATUS } = await import('../config/spin.js');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const APPLY = has('--apply');
const ROLLBACK = has('--rollback');
const SLUG = String(val('--slug', 'launch-spin')).toLowerCase();
const DAYS = Number(val('--days', 30));
const GOODIE_RATE = Number(val('--goodie-rate', 20));

/**
 * The prize ladder.
 *
 * The FLOOR prize is a coupon, deliberately: it is the guaranteed win, it must have
 * unlimited stock, and a coupon is the only kind that can be handed out without limit
 * without anyone picking anything off a shelf. Everything else is a real goodie with
 * real integer stock.
 *
 * `minOrderValuePaise` on the expensive items is margin protection — a ₹499 order must
 * not be able to win a ₹3,000 dashcam.
 */
const FLOOR_PRIZE = {
  name: '₹200 off your next order',
  shortLabel: '₹200 OFF',
  kind: 'coupon',
  couponType: 'fixed',
  couponValue: 200,
  couponMinCartValue: 1000,   // a ₹200 coupon on a ₹250 cart is not a business
  couponValidDays: 30,
  couponPrefix: 'SPIN',
  isFloorPrize: true,
  stockTotal: null,           // unlimited — required of the floor prize
  stockRemaining: null,
  minOrderValuePaise: 0,      // required: every order must be able to win it
};

const GOODIES = [
  { name: 'Microfibre Cleaning Cloth', shortLabel: 'CLOTH',   sku: 'GOODIE-MF-01',   stockTotal: 200, minOrderValuePaise: 0 },
  { name: 'Car Air Freshener',        shortLabel: 'FRESHNER', sku: 'GOODIE-AF-01',   stockTotal: 150, minOrderValuePaise: 0 },
  { name: 'Dashboard Phone Mount',    shortLabel: 'MOUNT',    sku: 'GOODIE-MNT-01',  stockTotal: 40,  minOrderValuePaise: 200000 },  // ₹2,000+
  { name: 'Tyre Inflator',            shortLabel: 'INFLATOR', sku: 'GOODIE-INF-01',  stockTotal: 10,  minOrderValuePaise: 500000 },  // ₹5,000+
];

const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN')}`;

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI is not set — refusing to guess a cluster.');

  // autoIndex OFF: see the header. This is non-negotiable in this repo.
  await mongoose.connect(uri, { autoIndex: false });
  const host = uri.replace(/\/\/[^@]*@/, '//***@').split('/')[2];
  console.log(`\nCluster : ${host}`);
  console.log(`DB      : ${mongoose.connection.db.databaseName}`);
  console.log(`Mode    : ${APPLY ? '\x1b[31mAPPLY (writes)\x1b[0m' : '\x1b[32mDRY RUN (no writes)\x1b[0m'}\n`);

  const existing = await SpinCampaign.findOne({ slug: SLUG });

  // ── Rollback ──────────────────────────────────────────────────────────────
  if (ROLLBACK) {
    if (!existing) { console.log(`No campaign with slug "${SLUG}". Nothing to roll back.`); return; }
    const spins = await SpinResult.countDocuments({ campaign: existing._id });
    if (spins > 0) {
      console.log(`\x1b[31mREFUSING\x1b[0m: ${spins} spin result(s) reference "${SLUG}".`);
      console.log('Those rows are the audit trail for stock that left the building.');
      console.log('Set the campaign status to "off" in the admin panel instead — instant and reversible.');
      return;
    }
    const prizeCount = await SpinPrize.countDocuments({ campaign: existing._id });
    console.log(`Would delete campaign "${SLUG}" and its ${prizeCount} prize(s).`);
    if (!APPLY) { console.log('\nDry run — re-run with --apply to delete.'); return; }
    await SpinPrize.deleteMany({ campaign: existing._id });
    await SpinCampaign.deleteOne({ _id: existing._id });
    console.log('Deleted.');
    return;
  }

  // ── Idempotency ───────────────────────────────────────────────────────────
  if (existing) {
    const prizes = await SpinPrize.find({ campaign: existing._id }).lean();
    console.log(`Campaign "${SLUG}" already exists — nothing to create.`);
    console.log(`  status=${existing.status}  ${existing.startsAt.toISOString()} → ${existing.endsAt.toISOString()}`);
    console.log(`  ${prizes.length} prize(s): ${prizes.map((p) => p.name).join(', ') || 'none'}`);
    console.log('\nEdit it in the admin panel (/admin/spin), or use --slug to seed a different one.');
    console.log('⚠️  To open a NEW window, CLONE the campaign in the admin panel — never edit the dates.');
    console.log('    The per-user cap is scoped to the campaign _id, so date-editing leaves every');
    console.log('    previously-capped customer locked out and the wheel invisible to repeat buyers.');
    return;
  }

  // ── The plan ──────────────────────────────────────────────────────────────
  const now = new Date();
  const endsAt = new Date(now.getTime() + DAYS * 86400000);

  console.log(`Campaign  : ${SLUG}  (draft)`);
  console.log(`Window    : now → ${endsAt.toISOString()}  (${DAYS} days)`);
  console.log(`Goodie win rate: ${GOODIE_RATE}%  — the rest win the floor coupon`);
  console.log(`Per-user cap   : 1 spin per customer (the model default)\n`);
  console.log('Prizes:');
  console.log(`  FLOOR  coupon  "${FLOOR_PRIZE.name}"  ₹${FLOOR_PRIZE.couponValue} off,`
    + ` min cart ₹${FLOOR_PRIZE.couponMinCartValue}, valid ${FLOOR_PRIZE.couponValidDays}d, unlimited stock`);
  for (const g of GOODIES) {
    console.log(`         goodie  "${g.name}"  sku=${g.sku}  stock=${g.stockTotal}`
      + (g.minOrderValuePaise ? `  (orders ${rupees(g.minOrderValuePaise)}+)` : ''));
  }

  if (!APPLY) {
    console.log('\n\x1b[32mDRY RUN\x1b[0m — nothing was written. Re-run with --apply to create.');
    return;
  }

  // ── Write ─────────────────────────────────────────────────────────────────
  // Created as DRAFT: a draft campaign is not live, so no customer sees a wheel until
  // the publish gate has passed and someone deliberately turns it on.
  const campaign = await SpinCampaign.create({
    slug: SLUG,
    name: SLUG.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    status: SPIN_STATUS.DRAFT,
    startsAt: now,
    endsAt,
    goodieWinRatePercent: GOODIE_RATE,
    terms: 'One spin per customer. Prizes subject to availability. '
      + 'Goodies ship with your order; coupons are valid on a future order.',
    // reviewCta stays DISABLED: publishing requires an https URL on an allow-listed
    // Google host, and inventing one here would just fail the gate. Set it in the admin.
    reviewCta: { enabled: false, headline: null, body: null, url: null },
  });
  console.log(`\nCreated campaign ${campaign._id}`);

  await SpinPrize.create({ campaign: campaign._id, ...FLOOR_PRIZE });
  console.log(`  + floor prize  "${FLOOR_PRIZE.name}"`);

  for (const g of GOODIES) {
    await SpinPrize.create({
      campaign: campaign._id,
      kind: 'goodie',
      stockRemaining: g.stockTotal,   // a fresh prize starts full
      ...g,
    });
    console.log(`  + goodie       "${g.name}"`);
  }

  // ── The publish gate ──────────────────────────────────────────────────────
  // Reported whether or not --publish was passed, because a campaign that cannot be
  // published is the single most useful thing to learn right now rather than from a
  // red toast in the admin panel later.
  const errors = await spinService.validateForPublish(campaign._id);
  if (errors.length) {
    console.log('\n\x1b[31mPublish gate: FAILED\x1b[0m');
    errors.forEach((e) => console.log(`  ✗ ${e.field}: ${e.message}`));
    console.log('\nThe campaign was created as a draft. Fix the above in /admin/spin, then publish there.');
    return;
  }
  console.log('\n\x1b[32mPublish gate: PASSED\x1b[0m — this campaign is ready to go live.');
  console.log('\nLeft as a DRAFT on purpose. No customer sees a wheel yet.');
  console.log('Go to /admin/spin → open this campaign → "▶ Publish (go live)".');
  console.log('Publishing there ALSO purges the cached "no campaign is live" answer,');
  console.log('which this script cannot do (it runs without Redis). Publish from Mongo');
  console.log('directly and the wheel stays invisible until the cache TTL expires.');
  console.log('\nBefore publishing, set the Google review CTA in the admin (or leave it off).');
}

main()
  .catch((err) => { console.error('\nFailed:', err.message); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect(); });
