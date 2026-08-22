import mongoose from 'mongoose';

/**
 * Transaction-capable database for suites that exercise `session.withTransaction`.
 *
 * These suites each used to boot their OWN single-node replica set:
 *
 *     if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
 *     replset = await MongoMemoryReplSet.create({ ... });
 *     await mongoose.connect(replset.getUri(), { ... });
 *
 * That was correct when tests/setup.js still started a STANDALONE mongod, because
 * a standalone cannot run transactions ("Transaction numbers are only allowed on
 * a replica set member or mongos"). setup.js now starts a single-node REPLICA SET
 * for every suite, so the disconnect-and-rebuild does nothing except pay for a
 * second mongod — and then run two replica sets side by side in one Jest worker
 * for the rest of the file.
 *
 * Reusing the global connection is therefore both faster and closer to how every
 * other suite behaves.
 *
 * @param {{ warmUp?: boolean }} [options]
 *   warmUp: run one throwaway transaction so the first real test does not absorb
 *   the one-off primary-election + first-transaction latency. Worth it for suites
 *   whose very first test opens a transaction.
 */
export async function useTransactionalDb({ warmUp = false } = {}) {
  if (mongoose.connection.readyState !== 1) {
    // setup.js's global beforeAll runs before any suite-level beforeAll, so this
    // only fires if the harness itself changed.
    throw new Error(
      '[tests/helpers/replicaSet] expected tests/setup.js to have connected Mongoose already; ' +
      `readyState=${mongoose.connection.readyState}`,
    );
  }

  if (!warmUp) return;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await mongoose.connection.db.collection('__txn_warmup').findOne({}, { session });
    });
  } finally {
    await session.endSession();
  }
}

export default useTransactionalDb;
