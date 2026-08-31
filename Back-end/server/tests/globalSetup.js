import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Jest globalSetup — boots ONE in-memory MongoDB for the whole run.
 *
 * This used to live in `tests/setup.js` (setupFilesAfterEnv), which Jest executes
 * once per *test file*. That spawned a separate `mongod` process for each of the
 * ~167 suites — roughly 2.5s of fixed startup cost per file, paid even by pure
 * unit suites that never open a connection. It was the single largest component
 * of the suite's wall time.
 *
 * globalSetup runs once, in the main Jest process, *before* any worker is forked,
 * so `process.env` written here is inherited by every worker. Each test file then
 * connects to this one server under its own database name (see tests/setup.js),
 * which preserves the previous per-file isolation without the per-file process.
 *
 * A REPLICA SET, not a standalone. Order creation wraps order + payment record +
 * cart clear in a MongoDB transaction, as CLAUDE.md requires for multi-document
 * writes, and transactions need a replica set or mongos. Against a standalone every
 * checkout returned 500 "Transaction numbers are only allowed on a replica set
 * member or mongos", which read as broken order code rather than a harness gap.
 */
export default async function globalSetup() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ launchTimeout: 120000 }], // 2 minutes for slow CI
    binary: {
      version: '7.0.14' // Match production MongoDB version
    }
  });

  // globalTeardown reads this to stop the server. Jest runs globalSetup and
  // globalTeardown in the same process, so globalThis carries across.
  globalThis.__MONGO_REPLSET__ = replSet;

  // Workers are forked after this returns and inherit process.env.
  process.env.MONGO_TEST_URI = replSet.getUri();
}
