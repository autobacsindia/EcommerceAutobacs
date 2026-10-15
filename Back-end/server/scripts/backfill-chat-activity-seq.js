/**
 * Give every existing top-level chat message an `activitySeq`.
 *
 * WHY
 * ---
 * Team chat threads (models/ChatMessage.js) order a channel's timeline by
 * `activitySeq`: the seq of the newest thing in a thread, so a thread that gets
 * a reply comes back to the bottom. New messages are written with it. Messages
 * from before threads existed have none, and the timeline query
 * (`activitySeq: { $lt: cursor }`, sorted on it) would sort them last and page
 * past them. For a message with no replies, its activitySeq IS its own seq, so
 * the backfill is exact: activitySeq = seq.
 *
 * WHEN TO RUN
 * -----------
 * Safe BEFORE the deploy: the old code never reads the field. Run it once before
 * deploying (so the timeline is right from the first request) and once after
 * (to catch messages posted by the old code in between). Idempotent: it only
 * touches messages that still lack the field.
 *
 * Also apply the new indexes after the deploy — production runs autoIndex:false:
 *   npm run audit-index-drift -- --apply --only ChatMessage
 *
 * ROLLBACK
 * --------
 * None needed: the old code ignores `activitySeq`. To remove it anyway:
 *   db.chatmessages.updateMany({ replyCount: { $in: [0, null] } }, { $unset: { activitySeq: '' } })
 *
 * Usage:
 *   node scripts/backfill-chat-activity-seq.js           # dry run, changes nothing
 *   node scripts/backfill-chat-activity-seq.js --apply   # write
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const MISSING = { activitySeq: { $exists: false }, threadRoot: { $in: [null] } };

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  // autoIndex off: connecting must never build indexes against whatever cluster this points at.
  await mongoose.connect(uri, { autoIndex: false });
  const messages = mongoose.connection.db.collection('chatmessages');

  const total = await messages.countDocuments({});
  const missing = await messages.countDocuments(MISSING);
  console.log(`chatmessages: ${total} total, ${missing} top-level without activitySeq`);

  if (!APPLY) {
    console.log('Dry run — nothing changed. Re-run with --apply to set activitySeq = seq on those messages.');
    return;
  }
  if (!missing) {
    console.log('Nothing to do.');
    return;
  }
  const res = await messages.updateMany(MISSING, [{ $set: { activitySeq: '$seq' } }]);
  const left = await messages.countDocuments(MISSING);
  console.log(`Updated ${res.modifiedCount}. Remaining without activitySeq: ${left}.`);
  if (left) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
