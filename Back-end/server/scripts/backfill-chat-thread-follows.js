/**
 * Fill the "Threads" list (ChatThreadFollow) for threads that existed before it.
 *
 * From the deploy on, chatService writes a row whenever someone replies in a
 * thread. Threads from before have no rows, so without this nobody's Threads
 * list shows them until the next reply.
 *
 * WHAT IT WRITES
 *   One row per (thread, person) for every person who replied in a thread, and
 *   for the person who started it. Every backfilled row starts READ (readSeq =
 *   the thread's newest reply): marking months of history "unread" on day one
 *   would bury the threads that actually need an answer.
 *
 *   `$setOnInsert` only — a row the live app has already written since the
 *   deploy is never touched, so it is safe to run while people are chatting,
 *   and safe to run twice. Backfilled rows carry `backfilled: true`, which is
 *   the rollback handle.
 *
 * ORDER OF OPERATIONS
 *   1. Deploy the code.
 *   2. npm run audit-index-drift -- --apply --only ChatThreadFollow
 *      (the unique { root, user } index is what makes concurrent writes safe —
 *      this script refuses to run without it).
 *   3. Dry run, read the counts, then --apply.
 *
 * Usage (Railway, prod env):
 *   railway run node --import=dotenv/config scripts/backfill-chat-thread-follows.js           # dry run
 *   railway run node --import=dotenv/config scripts/backfill-chat-thread-follows.js --apply
 *
 * ROLLBACK
 *   db.chatthreadfollows.deleteMany({ backfilled: true })
 *   (rows written by the live app have no `backfilled` and are kept.)
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'url';
import ChatMessage from '../models/ChatMessage.js';
import ChatThreadFollow from '../models/ChatThreadFollow.js';

const BATCH = 1000;

/** Is the unique { root, user } index built? Without it, two writers could each insert a row. */
async function hasUniqueIndex() {
  try {
    const indexes = await ChatThreadFollow.collection.indexes();
    return indexes.some((i) => i.unique && i.key?.root === 1 && i.key?.user === 1);
  } catch {
    return false; // collection does not exist yet
  }
}

/**
 * @param {{ apply?: boolean, log?: (msg: string) => void }} opts
 * @returns {Promise<{ threads: number, rows: number, inserted: number }>}
 */
export async function backfillThreadFollows({ apply = false, log = console.log } = {}) {
  if (apply && !(await hasUniqueIndex())) {
    throw new Error('ChatThreadFollow has no unique { root, user } index — run audit-index-drift --apply --only ChatThreadFollow first');
  }

  // Who replied where. The $type states the partial index's condition so this
  // reads chat_thread_replies instead of scanning every message.
  const repliers = await ChatMessage.aggregate([
    { $match: { threadRoot: { $type: 'objectId' }, kind: 'user', sender: { $type: 'objectId' } } },
    { $group: { _id: { root: '$threadRoot', user: '$sender' } } },
  ]);
  const usersByRoot = new Map();
  for (const { _id } of repliers) {
    const key = String(_id.root);
    if (!usersByRoot.has(key)) usersByRoot.set(key, new Set());
    usersByRoot.get(key).add(String(_id.user));
  }

  const rootIds = [...usersByRoot.keys()].map((id) => new mongoose.Types.ObjectId(id));
  let rows = 0;
  let inserted = 0;
  let threads = 0;
  for (let i = 0; i < rootIds.length; i += BATCH) {
    const roots = await ChatMessage.find({ _id: { $in: rootIds.slice(i, i + BATCH) } })
      .select('channel kind sender seq activitySeq lastReplyAt updatedAt').lean();
    const ops = [];
    for (const root of roots) {
      threads += 1;
      const people = new Set(usersByRoot.get(String(root._id)));
      if (root.kind === 'user' && root.sender) people.add(String(root.sender));
      const readSeq = root.activitySeq ?? root.seq;
      const lastActivityAt = root.lastReplyAt || root.updatedAt;
      for (const user of people) {
        ops.push({
          updateOne: {
            filter: { root: root._id, user: new mongoose.Types.ObjectId(user) },
            update: { $setOnInsert: { channel: root.channel, readSeq, lastActivityAt, backfilled: true } },
            upsert: true,
          },
        });
      }
    }
    rows += ops.length;
    if (apply && ops.length) {
      // The raw collection, so the `backfilled` marker is kept (it is not in the schema).
      const res = await ChatThreadFollow.collection.bulkWrite(ops, { ordered: false });
      inserted += res.upsertedCount;
    }
  }

  log(`${apply ? 'APPLIED' : 'DRY RUN'}: ${threads} threads, ${rows} (thread, person) rows${apply ? `, ${inserted} new` : ''}`);
  if (!apply) log('Nothing written. Re-run with --apply.');
  else log('Rollback: db.chatthreadfollows.deleteMany({ backfilled: true })');
  return { threads, rows, inserted };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  // autoIndex: false — connecting must never build indexes on whatever cluster this points at.
  await mongoose.connect(uri, { autoIndex: false });
  console.log(`db=${mongoose.connection.name} host=${mongoose.connection.host}`);
  try {
    await backfillThreadFollows({ apply });
  } finally {
    await mongoose.connection.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
