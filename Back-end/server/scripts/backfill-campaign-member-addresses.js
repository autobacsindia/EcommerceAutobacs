/**
 * Backfill postal details onto an existing campaign allowlist.
 *
 * WHY THIS EXISTS
 * ---------------
 * The 2026 festive allowlist was imported from a twelve-column operations sheet by a
 * mapping that read three columns — email, name, review flag — and silently discarded
 * the rest. Delivery Address, Pincode, State and Phone were all present in the source
 * and all thrown away, with nothing reporting it. The importer now carries them
 * (campaignService.importMembers / campaignMemberRepository.bulkUpsert); this restores
 * what the earlier run dropped, from the same sheet.
 *
 * SAFETY
 *   - dry run by default; --apply to write;
 *   - matches on EMAIL only, so it cannot attach one person's address to another;
 *   - only ever SETS postal fields. It never touches name, status, claimedAt,
 *     redeemedAt, discountRupees or reviewNote, so a claim or a redemption that landed
 *     since the import cannot be reset by a backfill;
 *   - --overwrite is required to replace an address a member already has, because the
 *     stored one may have been corrected by hand since;
 *   - autoIndex:false — the local .env points at PRODUCTION, and merely connecting
 *     would otherwise build every declared index against it.
 *
 * ROLLBACK
 *   The script prints an $unset command covering exactly the documents it wrote. These
 *   are additive fields, so unsetting them returns the collection to its prior state.
 *
 * Usage:
 *   node --import=dotenv/config scripts/backfill-campaign-member-addresses.js \
 *        --slug=festive-2026 --in="/path/to/Autobacs_Contactable_Customers.csv"
 *   …then re-run with --apply
 */

import mongoose from 'mongoose';
import fs from 'fs';
import Campaign from '../models/Campaign.js';
import CampaignMember from '../models/CampaignMember.js';

const arg = (name) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const APPLY = process.argv.includes('--apply');
const OVERWRITE = process.argv.includes('--overwrite');
const SLUG = arg('slug');
const IN = arg('in');

if (!SLUG || !IN) {
  console.error('Usage: --slug=<campaign-slug> --in=<list.csv> [--apply] [--overwrite]');
  process.exit(1);
}

/** Minimal RFC4180 reader — delivery addresses are quoted and full of commas. */
function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
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

// Header names drift between exports of the same sheet; match case-insensitively
// across the known aliases rather than pinning one spelling.
const pick = (row, ...keys) => {
  for (const k of keys) {
    const hit = Object.keys(row).find(h => h.toLowerCase().trim() === k.toLowerCase());
    if (hit && String(row[hit]).trim()) return String(row[hit]).trim();
  }
  return null;
};

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) { console.error('MONGODB_URI (or MONGO_URI) not set'); process.exit(1); }
await mongoose.connect(uri, { autoIndex: false });
console.log(`Database: ${mongoose.connection.db.databaseName}`);
console.log(APPLY ? '\n*** APPLY MODE — writing changes ***\n'
                  : '\n--- DRY RUN — nothing will be written (pass --apply) ---\n');

const campaign = await Campaign.findOne({ slug: SLUG });
if (!campaign) { console.error(`No campaign with slug "${SLUG}"`); process.exit(1); }

const source = parseCsv(fs.readFileSync(IN, 'utf8'));
const byEmail = new Map();
for (const r of source) {
  const email = String(pick(r, 'email') || '').toLowerCase().trim();
  if (email) byEmail.set(email, r);
}

const members = await CampaignMember.find({ campaign: campaign._id }).lean();
const ops = [];
let willSet = 0, alreadyHad = 0, noSourceRow = 0, sourceHasNoAddress = 0;
const unmatched = [];

for (const m of members) {
  const row = byEmail.get(m.email);
  if (!row) { noSourceRow++; unmatched.push(m.email); continue; }

  const address = pick(row, 'address', 'Delivery Address');
  const pincode = pick(row, 'pincode', 'Pincode');
  const state = pick(row, 'state', 'State');
  const phone = pick(row, 'phone', 'Phone');
  if (!address && !pincode && !state && !phone) { sourceHasNoAddress++; continue; }

  if (m.address && !OVERWRITE) { alreadyHad++; continue; }

  const $set = {};
  if (address) $set.address = address;
  if (pincode) $set.pincode = pincode;
  if (state) $set.state = state;
  if (phone) $set.phone = phone;
  if (Object.keys($set).length === 0) continue;

  willSet++;
  // Filtered on _id AND email: the email is the key the address was matched on, so
  // re-asserting it means a document that changed under us cannot be written to.
  ops.push({ updateOne: { filter: { _id: m._id, email: m.email }, update: { $set } } });
}

console.log(`campaign            : ${campaign.slug} (${campaign.name})`);
console.log(`members             : ${members.length}`);
console.log(`source rows         : ${source.length}`);
console.log(`will set details on : ${willSet}`);
console.log(`already had one     : ${alreadyHad}${OVERWRITE ? '' : '  (pass --overwrite to replace)'}`);
console.log(`no row in the sheet : ${noSourceRow}`);
console.log(`sheet row is blank  : ${sourceHasNoAddress}`);
if (unmatched.length) {
  console.log('\nmembers with no matching row in the sheet:');
  unmatched.forEach(e => console.log(`  ${e}`));
}

if (!APPLY) {
  console.log('\nDry run complete. Re-run with --apply to write.\n');
  await mongoose.disconnect();
  process.exit(0);
}

if (ops.length === 0) {
  console.log('\nNothing to write.\n');
  await mongoose.disconnect();
  process.exit(0);
}

const res = await CampaignMember.bulkWrite(ops, { ordered: false });
console.log(`\n✓ updated ${res.modifiedCount || 0} member(s)`);
console.log('\nROLLBACK — removes exactly the fields this script writes:');
console.log(`  db.campaignmembers.updateMany(`);
console.log(`    { campaign: ObjectId("${campaign._id}") },`);
console.log(`    { $unset: { address: "", pincode: "", state: "", phone: "" } }`);
console.log(`  )\n`);

await mongoose.disconnect();
