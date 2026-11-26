/**
 * Courier tracking sync — run it by hand.
 *
 *   npm run courier-sync                              # DRY RUN: asks the couriers, writes nothing,
 *                                                     #          prints what it WOULD change
 *   npm run courier-sync -- --apply                   # write courierSync + mark courier-delivered
 *                                                     #   parcels delivered (customer is notified!)
 *   npm run courier-sync -- --awb R1002402870 --carrier DTDC   # look up ONE AWB, print the
 *                                                     #   courier's answer; reads no orders, writes nothing
 *   railway run npm run courier-sync                  # against production variables
 *
 * Without --apply nothing is written. With --apply, a parcel the courier reports as
 * delivered goes through the normal "delivered" path — the customer gets the usual
 * delivered email / WhatsApp, once. Staff can undo it in the team panel; the sync
 * then leaves that parcel alone.
 *
 * Rollback for --apply: each delivered parcel is listed below; undo it from the team
 * panel (Operations → order → parcel → "Undo delivered"). courierSync fields are
 * staff-only notes and need no rollback.
 *
 * Connects with { autoIndex: false } — it must never build indexes on the cluster.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const argValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const AWB = argValue('--awb');
const CARRIER = (argValue('--carrier') || '').toUpperCase();

let exitCode = 0;

if (AWB) {
  // Single lookup: no database at all.
  const { resolveTracker, defaultTrackers } = await import('../services/courier/index.js');
  const route = resolveTracker({ trackingNumber: AWB, carrier: { code: CARRIER } }, { trackers: defaultTrackers() });
  if (route.skip) {
    console.error(`❌ No tracker for carrier '${CARRIER || '(none)'}': ${route.skip}. Set DTDC_TRACKING_* or COURIER_SYNC_SHIPROCKET_CARRIERS + SHIPROCKET_API_*.`);
    exitCode = 1;
  } else {
    try {
      const r = await route.tracker.track({ trackingNumber: AWB });
      console.log(`✅ ${route.tracker.name}: ${r.status} · last scan ${r.lastScanAt?.toISOString() || '—'}${r.deliveredAt ? ` · delivered ${r.deliveredAt.toISOString()}` : ''}`);
      for (const ev of r.events.slice(0, 10)) console.log(`   ${ev.at.toISOString()}  ${ev.status}  ${ev.location}`);
    } catch (err) {
      console.error(`❌ ${err.code || 'ERROR'}: ${err.message}`);
      exitCode = 1;
    }
  }
} else {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI (or MONGO_URI) not set.');
    process.exit(1);
  }
  await mongoose.connect(uri, { autoIndex: false });
  const { runCourierSync } = await import('../services/courier/courierSyncService.js');

  console.log(APPLY ? '⚠️  APPLY — writing courierSync and marking courier-delivered parcels delivered.\n' : 'DRY RUN — nothing will be written. Add --apply to write.\n');
  try {
    const s = await runCourierSync({ apply: APPLY, log: (line) => console.log(line) });
    console.log('\n── Summary ──');
    console.log(`orders scanned ${s.ordersScanned} · parcels in transit ${s.parcelsSeen} · checked ${s.checked} · errors ${s.errors}`);
    console.log(`skipped: ${Object.entries(s.skipped).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    console.log(`in-transit parcels by carrier: ${Object.entries(s.byCarrier).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`);
    console.log(`no scan for ${process.env.COURIER_SYNC_NO_MOVEMENT_HOURS || 48}h+: ${s.noMovement}`);
    const deliver = s.changes.filter((c) => c.markDelivered);
    console.log(`${APPLY ? 'marked delivered' : 'WOULD mark delivered'}: ${APPLY ? s.delivered : deliver.length}`);
    for (const c of deliver) {
      console.log(`   order ${c.orderId} parcel ${c.sequence} (${c.carrier} ${c.awb})${c.outcome ? ` → ${c.outcome}` : ''}`);
    }
    if (s.errors) exitCode = 2;
  } catch (err) {
    console.error(`❌ ${err.message}`);
    exitCode = 1;
  }
  // Let fire-and-forget email / WhatsApp enqueues flush before closing connections.
  if (APPLY) await new Promise((r) => setTimeout(r, 2000));
  const { closeQueues } = await import('../queue/queues.js');
  await closeQueues().catch(() => {});
  await mongoose.disconnect().catch(() => {});
}

const { getRedisClient } = await import('../services/redisClient.js');
await getRedisClient()?.quit().catch(() => {});
process.exit(exitCode);
