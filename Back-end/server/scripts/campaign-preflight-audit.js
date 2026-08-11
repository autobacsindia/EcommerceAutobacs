/**
 * Campaign preflight audit — READ-ONLY.
 *
 * Answers, for every email on a proposed campaign allowlist: does this person have an
 * account, is their email confirmed, must they set a password, and have they actually
 * bought anything. Run it BEFORE any thank-you card goes to print, because the answers
 * decide the landing-page copy: if most invitees have no account, "Log in" is the wrong
 * primary button and "Claim your reward" is the right one.
 *
 * Why it matters beyond copy: campaign eligibility requires a CONFIRMED email
 * (config/campaign.js), since registration creates accounts with isVerified:false and
 * login does not gate on it. Anyone here who is unverified will be sent through the
 * claim-link path — that is fine, but you need to know how many before you commit copy
 * and print.
 *
 * Order matching deliberately checks BOTH `user` and `guestEmail`: a meaningful number
 * of paid orders were placed by guests and carry no user reference, so keying on the
 * account alone under-reports real customers. Revenue counts `paymentStatus: 'paid'`
 * only — `purchaseCounted` is set on a tiny fraction of orders and is not a revenue flag.
 *
 * Writes NOTHING. Safe against production.
 *
 *   node --import=dotenv/config scripts/campaign-preflight-audit.js \
 *        --in=/path/to/list.csv --out=/path/to/report.csv
 */

import fs from 'fs';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Order from '../models/Order.js';

const arg = (name, fallback = null) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const inPath = arg('in');
const outPath = arg('out');
if (!inPath || !outPath) {
  console.error('Usage: --in=<list.csv> --out=<report.csv>');
  process.exit(1);
}

/** Minimal CSV parse that respects quoted fields containing commas. */
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
  return rows
    .filter(r => r.some(v => v && v.trim()))
    .map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) { console.error('Set MONGO_URI (or MONGODB_URI).'); process.exit(1); }

await mongoose.connect(uri);
const dbName = mongoose.connection.db.databaseName;
console.log(`Connected READ-ONLY to database: ${dbName}\n`);

const rows = parseCsv(fs.readFileSync(inPath, 'utf8'));
const emails = rows.map(r => String(r.email || '').toLowerCase().trim()).filter(Boolean);
console.log(`Auditing ${emails.length} emails from ${inPath}\n`);

// One query per collection rather than per email — 200 sequential round-trips to Atlas
// would take minutes and hammer the pool this runs against.
const users = await User.find({ email: { $in: emails } })
  .select('email name isVerified mustResetPassword isGuest createdAt')
  .lean();
const byEmail = new Map(users.map(u => [String(u.email).toLowerCase(), u]));

const userIds = users.map(u => u._id);
const orders = await Order.find({
  paymentStatus: 'paid',
  $or: [{ user: { $in: userIds } }, { guestEmail: { $in: emails } }],
}).select('user guestEmail totalAmount createdAt').lean();

// Fold orders onto the email, from either the account or the guest address.
const idToEmail = new Map(users.map(u => [String(u._id), String(u.email).toLowerCase()]));
const stats = new Map();
for (const o of orders) {
  const key = o.user ? idToEmail.get(String(o.user)) : String(o.guestEmail || '').toLowerCase();
  if (!key) continue;
  const s = stats.get(key) || { orders: 0, spend: 0, last: null };
  s.orders += 1;
  s.spend += Number(o.totalAmount) || 0;
  if (!s.last || o.createdAt > s.last) s.last = o.createdAt;
  stats.set(key, s);
}

const out = [];
const tally = {
  total: emails.length, hasAccount: 0, verified: 0, needsPassword: 0,
  guestAccount: 0, noAccount: 0, hasPaidOrder: 0, eligibleToday: 0,
};

for (const r of rows) {
  const email = String(r.email || '').toLowerCase().trim();
  const u = byEmail.get(email);
  const s = stats.get(email) || { orders: 0, spend: 0, last: null };

  if (u) tally.hasAccount++; else tally.noAccount++;
  if (u?.isVerified) tally.verified++;
  if (u?.mustResetPassword) tally.needsPassword++;
  if (u?.isGuest) tally.guestAccount++;
  if (s.orders > 0) tally.hasPaidOrder++;

  // Would this person get the discount if the campaign went live right now?
  const eligibleToday = !!(u && u.isVerified);
  if (eligibleToday) tally.eligibleToday++;

  // What the landing page will actually have to do for them.
  const path = !u ? 'CREATE ACCOUNT'
    : !u.isVerified ? 'CLAIM LINK (confirm email)'
    : u.mustResetPassword ? 'CLAIM LINK (set password)'
    : 'LOG IN';

  out.push({
    name: r.name || u?.name || '',
    email,
    account: u ? 'yes' : 'no',
    verified: u ? (u.isVerified ? 'yes' : 'no') : '',
    must_set_password: u ? (u.mustResetPassword ? 'yes' : 'no') : '',
    guest_account: u ? (u.isGuest ? 'yes' : 'no') : '',
    paid_orders: s.orders,
    paid_spend_inr: Math.round(s.spend),
    last_paid_order: s.last ? new Date(s.last).toISOString().slice(0, 10) : '',
    eligible_today: eligibleToday ? 'yes' : 'no',
    landing_path: path,
    source_in_sheet: r.source || '',
  });
}

const cols = Object.keys(out[0]);
fs.writeFileSync(outPath, [cols.join(','), ...out.map(o => cols.map(c => csvCell(o[c])).join(','))].join('\n') + '\n');

const pct = (n) => `${Math.round((n / tally.total) * 100)}%`;
console.log('─'.repeat(58));
console.log(`  Emails audited              ${tally.total}`);
console.log(`  Have an account             ${tally.hasAccount}  (${pct(tally.hasAccount)})`);
console.log(`  No account at all           ${tally.noAccount}  (${pct(tally.noAccount)})`);
console.log(`  Email confirmed             ${tally.verified}  (${pct(tally.verified)})`);
console.log(`  Must set a password         ${tally.needsPassword}`);
console.log(`  Guest-only account          ${tally.guestAccount}`);
console.log(`  Have a PAID order on record ${tally.hasPaidOrder}  (${pct(tally.hasPaidOrder)})`);
console.log('─'.repeat(58));
console.log(`  ELIGIBLE IF LIVE TODAY      ${tally.eligibleToday}  (${pct(tally.eligibleToday)})`);
console.log(`  Would need the claim path   ${tally.total - tally.eligibleToday}  (${pct(tally.total - tally.eligibleToday)})`);
console.log('─'.repeat(58));
console.log(`\nReport written to ${outPath}`);

await mongoose.disconnect();
