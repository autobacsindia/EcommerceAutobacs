/**
 * Seed the festival campaign — DRY RUN BY DEFAULT.
 *
 * Creates (or updates) three things, idempotently:
 *   1. the Campaign document — tiers, caps, dates, audience, status;
 *   2. its managed Coupon — hidden, one use per customer, pointing back at the campaign;
 *   3. the CampaignMember allowlist, imported from a CSV of confirmed-email customers.
 *
 * Re-running is safe: the campaign and coupon are upserted by their stable keys and the
 * member import upserts by {campaign, email}, so a corrected list can be re-imported
 * without wiping anyone's claim or redemption history.
 *
 * It deliberately seeds the campaign as DRAFT. A draft applies to nobody, so a mistake
 * here cannot discount an order. Going live is a separate, explicit act (the admin
 * status switch, or --status=testing to reach only the tester emails first).
 *
 *   # inspect what would happen (writes nothing)
 *   node --import=dotenv/config scripts/seed-festive-campaign.js --in=list.csv
 *
 *   # actually write it
 *   node --import=dotenv/config scripts/seed-festive-campaign.js --in=list.csv --apply \
 *        --ends=2026-11-05 --max-redemptions=191
 */

import fs from 'fs';
import mongoose from 'mongoose';
import Campaign from '../models/Campaign.js';
import Coupon from '../models/Coupon.js';
import CampaignMember from '../models/CampaignMember.js';
import { CAMPAIGN_STATUS, CAMPAIGN_AUDIENCE, CAMPAIGN_MEMBER_STATUS } from '../config/campaign.js';
import { resolveTier, validateTiers, assertMonotonic, TIER_RESOLUTION } from '../utils/campaignTiers.js';
import { toPaise } from '../utils/money.js';
import { istStartOfDay, istEndOfDay, formatDateTimeIST } from '../utils/datetime.js';

const arg = (n, d = null) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const flag = (n) => process.argv.includes(`--${n}`);

const APPLY = flag('apply');
const SLUG = arg('slug', 'festive-2026');
const CODE = arg('code', 'FESTIVE2026').toUpperCase();
const IN = arg('in');
const STARTS = arg('starts');
const ENDS = arg('ends');
const MAX_REDEMPTIONS = arg('max-redemptions') ? parseInt(arg('max-redemptions'), 10) : null;
const STATUS = arg('status', CAMPAIGN_STATUS.DRAFT);
const TESTERS = (arg('testers', '') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

if (!IN) { console.error('Missing --in=<list.csv>'); process.exit(1); }
if (!Object.values(CAMPAIGN_STATUS).includes(STATUS)) {
  console.error(`--status must be one of: ${Object.values(CAMPAIGN_STATUS).join(', ')}`);
  process.exit(1);
}

/**
 * The agreed ladder: 20% up to a ₹20,000 cap, or 10% uncapped once the cart passes
 * ₹1 lakh, resolved BEST-for-customer so the saving never falls as the cart grows.
 * `maxDiscountPerOrder` bounds the uncapped upper tier — 10% of an ₹8 lakh cart would
 * otherwise be ₹80,000 to a single customer.
 */
const TIERS = [
  { id: 'festive20', label: 'Festive 20', minCartValue: 0, percent: 20, maxDiscount: 20000 },
  { id: 'grand10', label: 'Grand 10', minCartValue: 100000, percent: 10, maxDiscount: null },
];
const MAX_DISCOUNT_PER_ORDER = 50000;

const config = {
  slug: SLUG,
  name: 'Festive 2026 — Thank You Reward',
  description: 'Private thank-you offer for invited customers, distributed by QR on a printed card.',
  status: STATUS,
  audience: CAMPAIGN_AUDIENCE.LIST,
  requireVerifiedEmail: true,
  testerEmails: TESTERS,
  // IST day boundaries, not UTC midnight: a bare `--ends=2026-09-05` parsed as UTC
  // would close the offer at 05:30 IST and lose the whole of the last trading day.
  startsAt: STARTS ? istStartOfDay(STARTS) : null,
  endsAt: ENDS ? istEndOfDay(ENDS) : null,
  tiers: TIERS,
  resolution: TIER_RESOLUTION.BEST,
  maxDiscountPerOrder: MAX_DISCOUNT_PER_ORDER,
  couponCode: CODE,
  allowKarmaStacking: false,
  maxRedemptions: MAX_REDEMPTIONS,
  landingPath: '/festive',
};

// ── Validate the ladder before touching the database ──────────────────────────
const errors = validateTiers(config);
if (errors.length) { console.error('Invalid tier ladder:\n  ' + errors.join('\n  ')); process.exit(1); }
const mono = assertMonotonic(config);
if (!mono.ok) { console.error('Tier ladder contains a discount cliff. Refusing to seed.'); process.exit(1); }

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map(h => h.trim());
  return rows.filter(r => r.some(v => v && v.trim()))
    .map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) { console.error('Set MONGO_URI.'); process.exit(1); }
await mongoose.connect(uri);
console.log(`Database: ${mongoose.connection.db.databaseName}`);
console.log(APPLY ? '\n*** APPLY MODE — writing changes ***\n' : '\n--- DRY RUN — nothing will be written (pass --apply to write) ---\n');

// ── The allowlist ─────────────────────────────────────────────────────────────
const rows = parseCsv(fs.readFileSync(IN, 'utf8'));
const seen = new Set();
const members = [];
const rejected = [];
for (const r of rows) {
  const email = String(r.email || '').toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) { rejected.push([r.email, 'invalid email']); continue; }
  if (seen.has(email)) { rejected.push([email, 'duplicate row']); continue; }
  seen.add(email);
  members.push({ email, name: r.name || null, reviewNote: r.review_flag || null });
}

console.log(`Campaign      : ${config.slug}  (status: ${config.status})`);
console.log(`Coupon        : ${CODE}  (hidden, 1 use per customer)`);
console.log(`Landing       : ${config.landingPath}`);
// Printed in IST because that is the window the operator and the customer experience;
// the stored value is UTC, as it should be.
console.log(`Opens  (IST)  : ${config.startsAt ? formatDateTimeIST(config.startsAt) : 'immediately'}`);
console.log(`Closes (IST)  : ${config.endsAt ? formatDateTimeIST(config.endsAt) : 'NOT SET'}`);
console.log(`Redemption cap: ${config.maxRedemptions ?? 'none'}`);
console.log(`Allowlist     : ${members.length} accepted, ${rejected.length} rejected`);
for (const [e, why] of rejected) console.log(`   rejected: ${e} (${why})`);

console.log('\nWhat a cart would earn:');
for (const rupees of [25000, 50000, 100000, 150000, 200000, 300000, 800000]) {
  const t = resolveTier(config, toPaise(rupees));
  console.log(`   Rs ${rupees.toLocaleString('en-IN').padStart(9)}  ->  Rs ${((t?.discountPaise || 0) / 100).toLocaleString('en-IN').padStart(8)}  ${t?.label || '-'}`);
}

const worstCase = (config.maxRedemptions ?? members.length) * MAX_DISCOUNT_PER_ORDER;
console.log(`\nMaximum exposure: Rs ${worstCase.toLocaleString('en-IN')} ` +
            `(${config.maxRedemptions ?? members.length} redemptions x Rs ${MAX_DISCOUNT_PER_ORDER.toLocaleString('en-IN')} ceiling)`);

if (!config.endsAt) console.log('\nNOTE: no end date set. The campaign cannot go live without one.');
if (config.status !== CAMPAIGN_STATUS.DRAFT) {
  console.log(`\nWARNING: seeding with status "${config.status}", not draft.`);
}

if (!APPLY) {
  console.log('\nDry run complete. Nothing was written.');
  await mongoose.disconnect();
  process.exit(0);
}

// ── Write ─────────────────────────────────────────────────────────────────────
const campaign = await Campaign.findOneAndUpdate(
  { slug: config.slug }, { $set: config }, { upsert: true, new: true, setDefaultsOnInsert: true },
);
console.log(`✓ Campaign ${campaign._id}`);

// The managed coupon. `value: 0` is intentional and never charged — the percentage is
// resolved from the campaign's tier ladder at pricing time. Hidden visibility keeps it
// out of the public offers list; usageLimitPerUser is the atomic once-per-customer gate.
await Coupon.findOneAndUpdate(
  { code: CODE },
  {
    $set: {
      code: CODE, type: 'percentage', value: 0, isActive: true, visibility: 'hidden',
      usageLimitPerUser: 1, campaign: campaign._id,
      description: `${config.name} (managed by campaign ${config.slug} — do not edit here)`,
    },
  },
  { upsert: true, new: true, setDefaultsOnInsert: true },
);
console.log(`✓ Coupon ${CODE}`);

const ops = members.map(m => ({
  updateOne: {
    filter: { campaign: campaign._id, email: m.email },
    update: {
      $set: { name: m.name, reviewNote: m.reviewNote },
      $setOnInsert: { campaign: campaign._id, email: m.email, status: CAMPAIGN_MEMBER_STATUS.INVITED },
    },
    upsert: true,
  },
}));
const res = await CampaignMember.bulkWrite(ops, { ordered: false });
console.log(`✓ Allowlist: ${res.upsertedCount || 0} added, ${res.modifiedCount || 0} updated, ` +
            `${await CampaignMember.countDocuments({ campaign: campaign._id })} total`);

// State the real consequence of the status it ended up in. Saying "applies to nobody"
// unconditionally would tell an operator a LIVE campaign was inert.
const consequence = {
  [CAMPAIGN_STATUS.DRAFT]: 'it applies to nobody until you switch it on',
  [CAMPAIGN_STATUS.OFF]: 'it applies to nobody',
  [CAMPAIGN_STATUS.TESTING]: `it applies ONLY to the tester emails (${config.testerEmails.length} listed)`,
  [CAMPAIGN_STATUS.LIVE]: 'IT IS LIVE — eligible customers can redeem right now',
}[campaign.status];
console.log(`\nDone. Campaign is "${campaign.status}" — ${consequence}.`);
await mongoose.disconnect();
