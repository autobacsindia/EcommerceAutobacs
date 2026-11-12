/**
 * Roav Points backtest — READ-ONLY. What would the last N months have paid?
 *
 * Runs the real points code (services/incentives/) over real sales orders, in
 * memory. Writes NOTHING: no ledger rows, no rule seed, no month docs. Connects
 * with { autoIndex: false } so merely connecting builds no index either.
 *
 * Prints per person per month: orders, returned orders, points, slab, payout;
 * and the company cost per month and in total. Prints salesperson names only —
 * never customer names, phones, emails or addresses.
 *
 * Usage (from Back-end/server):
 *   node scripts/backtest-incentives.js                 # last 3 finished months, default rules
 *   node scripts/backtest-incentives.js --months=3 --rules=db   # rules saved in the DB, if any
 *   node scripts/backtest-incentives.js --include-current        # also the month in progress
 *
 * Production ONLY with the owner's OK, and only through Railway (no local .env):
 *   railway run --service <backend> node scripts/backtest-incentives.js
 *
 * Simplifications vs the live ledger (stated in the output too):
 *   - a reversal is counted in the month the order was paid (live: the month it
 *     happens, or the current month if that one is locked);
 *   - special-sourcing flags are read if any exist; there were none before this tool.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import * as repo from '../repositories/incentiveRepository.js';
import { INCENTIVE_DEFAULT_RULES } from '../config/incentiveDefaults.js';
import { desiredEarnRows, loadBatchContext, lineGoneFractions } from '../services/incentives/ledgerService.js';
import { monthResult, roundHalfAway, bracketPoints } from '../services/incentives/pointsMath.js';
import { ratingsByEarner, rankStatements } from '../services/incentives/monthService.js';
import { monthOf, addMonths, monthRange } from '../services/incentives/months.js';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};
const MONTHS = Math.min(Math.max(Number(arg('months', 3)) || 3, 1), 12);
const RULES_FROM = arg('rules', 'defaults');
const INCLUDE_CURRENT = process.argv.includes('--include-current');

const inr = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function rulesFor(month) {
  if (RULES_FROM !== 'db') return { version: 0, rules: INCENTIVE_DEFAULT_RULES };
  const row = await repo.ruleForMonth(month);
  return row ? { version: row.version, rules: row.rules } : { version: 0, rules: INCENTIVE_DEFAULT_RULES };
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  await mongoose.connect(uri, { autoIndex: false });
  const host = (() => { try { return new URL(uri.replace('mongodb+srv://', 'https://')).host; } catch { return '?'; } })();
  console.log(`Roav Points backtest (read-only) — cluster ${host}, rules: ${RULES_FROM}`);

  const current = monthOf(new Date());
  const last = INCLUDE_CURRENT ? current : addMonths(current, -1);
  const months = Array.from({ length: MONTHS }, (_, i) => addMonths(last, -(MONTHS - 1 - i)));
  const { start } = monthRange(months[0]);
  const { end } = monthRange(months[months.length - 1]);

  const ctxBase = {
    getRules: rulesFor,
    months: { landing: async (m) => m, get: async () => 'open' },
    now: new Date(),
    cache: { users: new Map(), reps: new Map() },
    ignoreStartMonth: true, // the backtest looks at months before the scheme started
  };

  // per month → earnerKey → totals
  const book = new Map(months.map((m) => [m, new Map()]));
  const seen = { orders: 0, verified: 0, unverifiedPaid: 0, noSeller: 0 };
  let after = null;
  for (;;) {
    const orders = await repo.salesOrdersPage({ from: start, to: end, after, limit: 300 });
    if (!orders.length) break;
    const b = await loadBatchContext(orders);
    for (const order of orders) {
      seen.orders += 1;
      const k = String(order._id);
      const ctx = { ...ctxBase, payments: b.payments.get(k) || [], transfers: b.transfers.get(k) || [], flag: b.flags.get(k) || null };
      const { proof, rows } = await desiredEarnRows(order, ctx);
      if (!proof.verified) { seen.unverifiedPaid += 1; continue; }
      if (!rows.length) { seen.noSeller += 1; continue; }
      seen.verified += 1;
      const month = rows[0].month;
      if (!book.has(month)) continue;
      const { rules } = await rulesFor(month);
      const gone = lineGoneFractions(order, b.returns.get(k) || [], proof.paidAt, rules);
      for (const r of rows) {
        let f = 0;
        if (gone.whole) f = 1;
        else if (r.lineId) f = gone.fractions.get(r.lineId)?.f || 0;
        else if (gone.allLinesGone) f = 1;
        const keep = (x) => x - (f >= 1 ? x : roundHalfAway(x * f));
        const t = book.get(month).get(r.earnerKey) || { name: r.earnerName, centi: 0, flatCenti: 0, orders: new Set(), returned: new Set() };
        t.centi += keep(r.centi); t.flatCenti += keep(r.flatCenti);
        t.orders.add(k); // every paid order counts, even one too small for the +200
        if (f > 0 && !gone.whole) t.returned.add(k);
        if (f > 0 && gone.whole && order.status !== 'cancelled') t.returned.add(k);
        book.get(month).set(r.earnerKey, t);
      }
    }
    after = orders[orders.length - 1];
    if (orders.length < 300) break;
  }

  let grand = 0;
  for (const month of months) {
    const { rules } = await rulesFor(month);
    const ratings = await ratingsByEarner(month).catch(() => new Map());
    const people = [...book.get(month)].map(([key, t]) => {
      const rating = ratings.get(key) || { count: 0, avg: null };
      return {
        key, name: t.name || key, orders: t.orders.size, returnedOrders: t.returned.size, ratingAvg: rating.avg,
        ...monthResult({ centi: t.centi, flatCenti: t.flatCenti, orders: t.orders.size, returnedOrders: t.returned.size, ratingCount: rating.count, ratingAvg: rating.avg }, rules),
      };
    }).sort(rankStatements);
    const cost = people.reduce((a, p) => a + p.payoutPaise, 0);
    grand += cost;
    console.log(`\n── ${month} ──────────────────────────────`);
    if (!people.length) console.log('  (no verified-paid sales orders)');
    for (const p of people) {
      console.log(`  ${p.name.padEnd(22).slice(0, 22)} orders ${String(p.orders).padStart(3)}  returned ${String(p.returnedOrders).padStart(2)}  `
        + `points ${String(p.finalPoints).padStart(7)}  slab ${(p.slab || '—').padEnd(8)}  `
        + `×ret ${p.returnFactor} ×rating ${p.ratingFactor}  pay ${inr(p.payoutPaise)}`
        + (p.next ? `  (${p.next.pointsToGo} to ${p.next.name})` : ''));
    }
    if (people[0]?.finalPoints > 0) console.log(`  Champion: ${people[0].name} — ${people[0].finalPoints} pts, ${inr(people[0].payoutPaise)}`);
    console.log(`  Company cost ${month}: ${inr(cost)}`);
  }
  console.log(`\nTOTAL company cost over ${months.length} month(s): ${inr(grand)}`);
  console.log(`Orders seen ${seen.orders}; counted ${seen.verified}; marked paid but NOT covered by verified payment records ${seen.unverifiedPaid}; no seller ${seen.noSeller}.`);
  const ex = bracketPoints(500000, INCENTIVE_DEFAULT_RULES).points;
  console.log(`Formula check: a ₹5,00,000 (ex-GST) order with no discount = ${ex.toFixed(1)} → ${Math.round(ex)} pts + 200 per order (the PDF example shows 10,549).`);
  console.log('Simplification: reversals are counted in the month the order was paid.');
}

main()
  .catch((err) => { console.error('Backtest failed:', err.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
