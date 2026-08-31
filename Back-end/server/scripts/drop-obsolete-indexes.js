/**
 * Drop indexes proven obsolete by $indexStats + document inspection.
 *
 * WHY A DEDICATED SCRIPT AND NOT `audit-index-drift --allow-drop`
 * --------------------------------------------------------------
 * `--allow-drop` removes EVERY index that is not in a schema. That set contains
 * indexes real traffic depends on (`products.isActive_1_stock_1` at 3,495 ops,
 * `users.role_1` at 741). Those have now been DECLARED in their schemas instead.
 * What remains here is an explicit allow-list: each entry names the evidence that
 * justifies dropping it, so this is reviewable rather than a blanket sweep.
 *
 * ── The evidence rules ──────────────────────────────────────────────────────
 * An index qualifies only if BOTH hold:
 *   1. `ops = 0` over a 162h $indexStats window, AND
 *   2. a structural reason it can never be needed — a hot superset/prefix exists,
 *      or it indexes a field path present in ZERO documents.
 *
 * ⚠️ `ops = 0` ALONE IS NEVER ENOUGH. $indexStats counts QUERY usage and does not
 * count unique-constraint enforcement on writes. `payments.gatewayPaymentId_1`
 * reads 0 ops and is the serialization point that makes webhook processing
 * idempotent; dropping it on that number would break the money path. No unique
 * index appears below.
 *
 * Usage:
 *   node scripts/drop-obsolete-indexes.js            # DRY RUN (default)
 *   node scripts/drop-obsolete-indexes.js --apply
 *
 * Rollback: every index is recreatable from the `recreate` spec printed for each
 * entry; `audit-index-drift --apply` rebuilds anything still declared in a schema.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const APPLY = process.argv.includes('--apply');

/** @type {{collection:string,index:string,reason:string,recreate:string}[]} */
const DOOMED = [
  {
    collection: 'products', index: 'brand_1',
    reason: 'ops=0; strict prefix of brand_1_isActive_1_createdAt_-1 (25,456 ops)',
    recreate: 'db.products.createIndex({ brand: 1 })',
  },
  {
    collection: 'products', index: 'isFeatured_1',
    reason: 'ops=0; superseded by isActive_1_isFeatured_1 — Product.js line 266 already '
          + 'says this index "replaces single-field isFeatured index"',
    recreate: 'db.products.createIndex({ isFeatured: 1 })',
  },
  {
    collection: 'products', index: 'createdAt_-1',
    reason: 'ops=0; partial{isActive:true} duplicate of isActive_1_createdAt_-1, which serves the listing',
    recreate: 'db.products.createIndex({ createdAt: -1 }, { partialFilterExpression: { isActive: true } })',
  },
  {
    collection: 'vehicles', index: 'make_1_model_1_year_1',
    reason: 'ops=0; its own prefix make_1_model_1 carries 20,408 ops — nothing queries by year',
    recreate: 'db.vehicles.createIndex({ make: 1, model: 1, year: 1 })',
  },
  {
    collection: 'auditlogs', index: 'action_1',
    reason: 'ops=0; strict prefix of the schema-declared action_1_createdAt_-1',
    recreate: 'db.auditlogs.createIndex({ action: 1 })',
  },
  {
    collection: 'orders', index: 'payment.razorpayOrderId_1',
    reason: 'indexes a PHANTOM PATH — `payment.razorpayOrderId` exists in 0 of 1,580 orders. '
          + 'The real field is top-level `razorpayOrderId` (97 docs). This index has always been empty.',
    recreate: 'db.orders.createIndex({ "payment.razorpayOrderId": 1 })',
  },
  {
    collection: 'orders', index: 'return_request_per_order',
    reason: 'ops=0; key {_id:1,"returnRequest.status":1} — leads with _id (already unique, so the '
          + 'compound adds nothing) and `returnRequest.status` exists in 0 docs after the phantom '
          + 'subdoc cleanup. NOT unique despite the name; the real constraint is '
          + 'ReturnRequest.unique_inflight_return_per_order_product.',
    recreate: 'db.orders.createIndex({ _id: 1, "returnRequest.status": 1 }, { name: "return_request_per_order" })',
  },
  {
    collection: 'products', index: 'name_text_description_text_tags_text_brand_text',
    reason: 'ops=0 over 162h — $text search is not exercised in production (Elasticsearch serves '
          + 'search). Largest dead index at 1.7MB. The schema declares a 3-field replacement '
          + '(name/tags/brand, dropping `description` to shrink the index); MongoDB permits only ONE '
          + 'text index per collection, so the old one must go before the new one can build.',
    recreate: 'db.products.createIndex({ name: "text", description: "text", tags: "text", brand: "text" })',
    followUp: 'node scripts/audit-index-drift.js --apply   # builds the 3-field schema version',
  },
];

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI (or MONGO_URI) not set');

  // autoIndex MUST be false — this script imports no models, but the flag stays so a
  // future import cannot silently rebuild every schema index against production.
  await mongoose.connect(uri, { autoIndex: false });
  const db = mongoose.connection.db;

  console.log(`\n=== Drop obsolete indexes — ${APPLY ? 'APPLY' : 'DRY RUN'} ===\n`);

  let dropped = 0;
  let missing = 0;

  for (const entry of DOOMED) {
    const { collection, index, reason, recreate } = entry;
    const live = await db.collection(collection).listIndexes().toArray().catch(() => []);
    const found = live.find((i) => i.name === index);

    if (!found) {
      // Idempotent: a re-run after a successful apply lands here, which is fine.
      console.log(`  – ${collection}.${index} — already absent`);
      missing += 1;
      continue;
    }

    // Defence in depth: refuse to drop a unique index even if one were listed above.
    if (found.unique) {
      console.error(`  ✗ REFUSING ${collection}.${index} — index is UNIQUE (constraint, not a query aid)`);
      continue;
    }

    console.log(`  ${APPLY ? '✓ dropping' : '• would drop'} ${collection}.${index}`);
    console.log(`      why     : ${reason}`);
    console.log(`      rollback: ${recreate}`);
    if (entry.followUp) console.log(`      THEN    : ${entry.followUp}`);

    if (APPLY) {
      await db.collection(collection).dropIndex(index);
      dropped += 1;
    }
  }

  console.log(
    `\n${APPLY ? `Dropped ${dropped}` : `${DOOMED.length - missing} would be dropped`}`
    + `${missing ? ` (${missing} already absent)` : ''}.`
  );
  if (!APPLY) console.log('Re-run with --apply to execute.\n');
  else console.log('Run `npm run audit-index-drift` to confirm EXTRA is now clear.\n');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('\n✗ Drop failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
