/**
 * Create (or bring back in line) the Hilux owners' card coupon, HILUX5000.
 *
 * The printed thank-you card QR (the old Onam card, `/onam`) now lands on
 * `/hilux-owners`, which hands the shopper this code. The rules, agreed with the
 * owner on 2026-11-26:
 *
 *   - flat ₹5,000 off                         type 'fixed', value 5000
 *   - only on Toyota Hilux / Revo / Travo parts appliesTo.vehicles (live tags)
 *   - those parts must add up to ₹25,000+     minCartValue 25000 (eligible subset)
 *   - once per customer account               usageLimitPerUser 1 (needs sign-in)
 *   - one shared code, no global cap          usageLimit null
 *   - no expiry                               expiresAt null — switch off in admin
 *   - not listed on the cart's offers list    visibility 'hidden'
 *
 * Money is still decided by pricingService at quote AND at checkout; this script
 * only writes the rule document.
 *
 * ── Safety ───────────────────────────────────────────────────────────────────
 *   - DRY RUN by default: prints the target cluster, resolved vehicles and the
 *     exact document it would write. `--apply` writes.
 *   - Idempotent: keyed on the unique code. Re-running updates the same document
 *     to the rules above; it never creates a second coupon and never touches
 *     usedCount (redemptions already made stay counted).
 *   - Refuses to run if any vehicle slug does not resolve, so the coupon can never
 *     be saved with a narrower scope than intended.
 *   - `autoIndex: false` so connecting never builds indexes on prod.
 *
 * ── Usage (from Back-end/server, a folder with NO .env) ──────────────────────
 *   railway run node scripts/create-hilux-owner-coupon.js           # dry run
 *   railway run node scripts/create-hilux-owner-coupon.js --apply   # write
 *
 * ── Rollback ─────────────────────────────────────────────────────────────────
 *   Admin → Coupons → HILUX5000 → turn "Active" off (stops new uses at once; past
 *   orders keep their discount). Or, if it was just created and never used:
 *   db.coupons.deleteOne({ code: 'HILUX5000', usedCount: 0 })
 */
import mongoose from 'mongoose';
import Coupon from '../models/Coupon.js';
import Vehicle from '../models/Vehicle.js';

export const HILUX_COUPON_CODE = 'HILUX5000';
export const HILUX_VEHICLE_SLUGS = ['toyota-hilux', 'toyota-hilux-revo', 'toyota-hilux-travo'];

/** The rule document, given the resolved vehicle ids. Pure, so it is unit-tested. */
export function buildHiluxCoupon(vehicleIds) {
  return {
    code: HILUX_COUPON_CODE,
    description: 'Hilux owners card — ₹5,000 off Toyota Hilux / Revo / Travo parts (min ₹25,000), once per customer',
    type: 'fixed',
    value: 5000,
    maxDiscountAmount: null,
    visibility: 'hidden',
    minCartValue: 25000,
    maxCartValue: null,
    startsAt: null,
    expiresAt: null,
    firstOrderOnly: false,
    appliesTo: { categories: [], brandSlugs: [], products: [], vehicles: vehicleIds },
    usageLimit: null,
    usageLimitPerUser: 1,
    isActive: true,
  };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGO_URI is not set — run through `railway run`');

  await mongoose.connect(uri, { autoIndex: false });
  const { host, name } = mongoose.connection;
  console.log(`Target: ${host} / ${name}   mode: ${apply ? 'APPLY' : 'dry run'}`);

  const vehicles = await Vehicle.find({ slug: { $in: HILUX_VEHICLE_SLUGS } }).select('slug make model').lean();
  const found = new Set(vehicles.map((v) => v.slug));
  const missing = HILUX_VEHICLE_SLUGS.filter((s) => !found.has(s));
  if (missing.length) throw new Error(`Vehicle slug(s) not found: ${missing.join(', ')} — nothing written`);
  vehicles.forEach((v) => console.log(`  vehicle ${v.slug}  (${v.make} ${v.model})  ${v._id}`));

  const doc = buildHiluxCoupon(vehicles.map((v) => v._id));
  const existing = await Coupon.findOne({ code: HILUX_COUPON_CODE }).lean();
  console.log(existing
    ? `Existing ${HILUX_COUPON_CODE} found (usedCount ${existing.usedCount}) — will UPDATE its rules`
    : `No ${HILUX_COUPON_CODE} yet — will CREATE it`);
  console.log(JSON.stringify(doc, null, 2));

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to save.');
    return;
  }
  const saved = await Coupon.findOneAndUpdate(
    { code: HILUX_COUPON_CODE },
    { $set: doc },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean();
  console.log(`\nSaved ${saved.code} (${saved._id}). Rollback: switch it off in Admin → Coupons.`);
}

// Run only when executed directly, so the test can import buildHiluxCoupon.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((err) => { console.error(err.message || err); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}
