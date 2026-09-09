/**
 * Affiliate programme — test-environment drive-through.
 *
 * Two things in this flow cannot be tested by clicking:
 *
 *   1. Commission matures only after delivery PLUS the 4-day return window. Nobody is
 *      going to wait four days to find out whether the sweep works.
 *   2. The maturation sweep is a 4am cron. There is no button for it.
 *
 * So this script backdates an order's delivery and runs the sweep on demand, then prints
 * the ledger. It is a TEST HARNESS, not an operations tool.
 *
 * ── SAFETY ───────────────────────────────────────────────────────────────────
 * This script BACKDATES ORDER DELIVERY DATES. Run against production it would falsify
 * fulfilment records and could make commissions payable that are not. The committed
 * `.env` in this repo points at PRODUCTION Mongo (see CLAUDE.md), so "I ran it locally"
 * is NOT a safeguard — that is exactly how it would happen.
 *
 * Guards, in order:
 *   • READ-ONLY by default. `--status` prints and exits. Writes need `--mature`.
 *   • Any write requires `--confirm-cluster=<substring>` which MUST appear in the
 *     resolved database host. You cannot write to a cluster you did not name out loud.
 *   • Refuses outright when NODE_ENV=production.
 *   • `{ autoIndex: false }` on connect — connecting with models imported and autoIndex
 *     on builds every declared index against whatever cluster this points at.
 *   • Redis disabled, so it never dials a cache host.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────
 *   # Where am I pointed, and what does the ledger look like?
 *   node --import=dotenv/config scripts/affiliate-test-drive.js --status
 *   node --import=dotenv/config scripts/affiliate-test-drive.js --status --code=RAHUL10
 *
 *   # Make one order's commission due, then run the sweep.
 *   node --import=dotenv/config scripts/affiliate-test-drive.js \
 *     --mature=<orderId> --confirm-cluster=autobacstest
 *
 * On Railway:  railway run node scripts/affiliate-test-drive.js --status
 */

import mongoose from 'mongoose';

// Never let a cache client be constructed by an imported module.
delete process.env.REDIS_URL;
delete process.env.QUEUE_REDIS_URL;

const args = process.argv.slice(2);
const flag = (name) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};

const wantStatus = Boolean(flag('status'));
const matureOrderId = flag('mature');
const confirmCluster = flag('confirm-cluster');
const code = flag('code');

const line = (s = '') => console.log(s);
const money = (paise) => `₹${(paise / 100).toFixed(2)}`;

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run with NODE_ENV=production. This script backdates delivery dates.');
  }

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGO_URI is not set.');

  // Show WHERE before doing anything, so a wrong target is visible immediately.
  const host = (uri.match(/@([^/?]+)/) || [])[1] || '(unparsed host)';
  const dbName = (uri.match(/\/([^/?]+)(\?|$)/) || [])[1] || '(default db)';

  await mongoose.connect(uri, { autoIndex: false });

  line('─'.repeat(72));
  line(`  cluster : ${host}`);
  line(`  database: ${dbName}`);
  line('─'.repeat(72));

  const { default: Affiliate } = await import('../models/Affiliate.js');
  const { default: AffiliateCommission } = await import('../models/AffiliateCommission.js');
  const { default: Order } = await import('../models/Order.js');

  // ── Writes: gated on naming the cluster ────────────────────────────────────
  if (matureOrderId) {
    if (!confirmCluster) {
      throw new Error(
        'Writing requires --confirm-cluster=<substring of the host printed above>. '
        + 'This exists so a production cluster cannot be written to by accident.'
      );
    }
    if (!host.includes(String(confirmCluster))) {
      throw new Error(
        `--confirm-cluster="${confirmCluster}" does not appear in the host "${host}". `
        + 'Refusing, because you are not pointed where you think you are.'
      );
    }

    const order = await Order.findById(matureOrderId);
    if (!order) throw new Error(`Order ${matureOrderId} not found.`);
    if (!order.affiliate?.affiliate) {
      throw new Error('That order carries no affiliate attribution — nothing would mature.');
    }

    const { RETURN_WINDOW_DAYS } = await import('../config/returnPolicy.js');
    // One day past the window, so the boundary is unambiguous.
    const backdatedTo = new Date(Date.now() - (RETURN_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);

    if (order.shipments?.length) {
      for (const parcel of order.shipments) {
        parcel.status = 'delivered';
        parcel.deliveredAt = backdatedTo;
      }
    } else {
      // A parcel-less (legacy-shaped) order matures off the order-level signal instead.
      order.status = 'delivered';
      order.fulfillmentMetrics = { ...(order.fulfillmentMetrics || {}), deliveredAt: backdatedTo };
    }
    await order.save();
    line(`✓ Backdated delivery to ${backdatedTo.toISOString()} (${RETURN_WINDOW_DAYS + 1} days ago)`);

    const { default: svc } = await import('../services/affiliateCommissionService.js');

    // The service is gated on the kill switch; turn it on for this process only.
    const previous = process.env.AFFILIATE_COMMISSION_ENABLED;
    process.env.AFFILIATE_COMMISSION_ENABLED = 'true';

    const stamped = await svc.stampMaturity(matureOrderId);
    line(`✓ stampMaturity: ${stamped.status}${stamped.maturesAt ? ` (due ${stamped.maturesAt.toISOString()})` : ''}`);

    const swept = await svc.sweepMaturity();
    line(`✓ sweepMaturity: approved ${swept.approved}, skipped ${swept.skipped}, examined ${swept.examined}`);

    if (swept.skipped > 0 && swept.approved === 0) {
      line('  ↳ skipped usually means an in-flight return on the order, which correctly freezes payout.');
    }

    if (previous === undefined) delete process.env.AFFILIATE_COMMISSION_ENABLED;
    else process.env.AFFILIATE_COMMISSION_ENABLED = previous;
    line();
  }

  // ── Status: always printed ─────────────────────────────────────────────────
  if (wantStatus || matureOrderId || (!wantStatus && !matureOrderId)) {
    const query = code ? { code: String(code).toUpperCase() } : {};
    const affiliates = await Affiliate.find(query).sort({ createdAt: -1 }).limit(20).lean();

    if (!affiliates.length) {
      line('No affiliates found. Apply at /affiliates, then approve at /admin/affiliates.');
    }

    for (const a of affiliates) {
      const rows = await AffiliateCommission.find({ affiliate: a._id }).sort({ createdAt: 1 }).lean();
      const payable = rows
        .filter((r) => r.status === 'approved' && r.payout === null)
        .reduce((s, r) => s + r.amountPaise, 0);

      line(`${a.code || '(no code)'}  ${a.name}  <${a.email}>`);
      line(`  status ${a.status} · commission ${a.commissionPercent}% · buyer discount ${a.discountPercent}%`);
      line(`  terms  ${a.termsAcceptance?.version || '(none recorded)'}`);
      line(`  bank   ${a.payoutDetails?.accountLast4 ? `••••${a.payoutDetails.accountLast4} ${a.payoutDetails.ifsc || ''}` : '(none on file)'}`);
      // Proves encryption without printing anything sensitive.
      line(`  PII    accountNumber ${a.payoutDetails?.accountNumber === undefined ? 'not selected (select:false) ✓' : 'VISIBLE — investigate'}`);
      line(`  payable now: ${money(payable)}  ·  ledger rows: ${rows.length}`);

      for (const r of rows) {
        line(`    ${r.type.padEnd(8)} ${String(money(r.amountPaise)).padStart(12)}  ${r.status.padEnd(9)}`
          + `  matures ${r.maturesAt ? r.maturesAt.toISOString().slice(0, 10) : '—'}`
          + `  ${r.note || ''}`);
      }
      line();
    }
  }
}

main()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(`\n✗ ${err.message}\n`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
