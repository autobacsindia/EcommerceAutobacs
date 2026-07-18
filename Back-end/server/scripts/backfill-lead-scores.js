/**
 * Backfill `Lead.leadScore` for existing leads. Run once after deploying the
 * lead-scoring feature (the live sync/sweep paths maintain it from then on).
 * Idempotent — recomputes from each lead's own fields, so re-running is a no-op.
 *
 * Score is a pure projection of the lead (utils/leadScore.js): status, primarySource,
 * sources[].snapshot, reopenCount, hasPurchased. Closed (won/lost) leads score 0.
 *
 * Usage:
 *   node scripts/backfill-lead-scores.js            # dry run (distribution only, no writes)
 *   node scripts/backfill-lead-scores.js --apply    # apply
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Lead from '../models/Lead.js';
import { computeLeadScore, scoreTier } from '../utils/leadScore.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const BATCH = 1000;

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  await mongoose.connect(uri);
  console.log('[backfill-scores] connected');
}

async function run() {
  await connect();

  const tiers = { hot: 0, warm: 0, cold: 0 };
  let scanned = 0;
  let changed = 0;
  let afterId = null;

  // Keyset pagination on immutable _id (writes bump updatedAt).
  for (;;) {
    const filter = afterId ? { _id: { $gt: afterId } } : {};
    const leads = await Lead.find(filter).sort({ _id: 1 }).limit(BATCH);
    if (leads.length === 0) break;

    const ops = [];
    for (const lead of leads) {
      const next = computeLeadScore(lead);
      tiers[scoreTier(next)] += 1;
      if (next !== lead.leadScore) {
        changed += 1;
        ops.push({ updateOne: { filter: { _id: lead._id }, update: { $set: { leadScore: next } } } });
      }
    }
    if (APPLY && ops.length) await Lead.bulkWrite(ops, { ordered: false });

    scanned += leads.length;
    afterId = leads[leads.length - 1]._id;
    if (leads.length < BATCH) break;
  }

  console.log(`[backfill-scores] scanned=${scanned} changed=${changed} (${APPLY ? 'APPLIED' : 'dry run'})`);
  console.log(`[backfill-scores] distribution — hot(>=60)=${tiers.hot} warm(30-59)=${tiers.warm} cold(<30)=${tiers.cold}`);
  if (!APPLY) console.log('[backfill-scores] re-run with --apply to write.');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[backfill-scores] failed:', err);
  process.exit(1);
});
