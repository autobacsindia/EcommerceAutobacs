import { createHash } from 'node:crypto';

import mongoose from 'mongoose';

/**
 * Legacy per-suite database helper.
 *
 * In practice this is now a thin wrapper: tests/setup.js (setupFilesAfterEnv) has
 * already opened the connection by the time any suite's own `beforeAll` runs, so
 * `connect()` returns early for every current caller. It is kept because ~20 suites
 * still import it.
 *
 * It no longer starts a server of its own. The single in-memory MongoDB is booted
 * once per run by tests/globalSetup.js; starting a second one here would reintroduce
 * exactly the per-suite `mongod` spawn that made the suite slow.
 */

const testDatabaseName = () => {
  const testPath = expect.getState()?.testPath ?? `worker-${process.env.JEST_WORKER_ID ?? '1'}`;
  return `jest_${createHash('sha1').update(testPath).digest('hex').slice(0, 24)}`;
};

/**
 * Connect to the shared in-memory database, under this test file's own db name.
 */
export const connect = async () => {
  // Prevent connecting if already connected
  if (mongoose.connection.readyState !== 0) {
    return;
  }

  const uri = process.env.MONGO_TEST_URI;

  if (!uri) {
    throw new Error(
      '[Test] MONGO_TEST_URI is not set — tests/globalSetup.js did not run. ' +
      'Run the suite through the project jest config (npm test), not a bare jest binary.'
    );
  }

  await mongoose.connect(uri, { dbName: testDatabaseName() });
};

/**
 * Drop this suite's database and close the connection.
 *
 * Does NOT stop the server — it is shared with every other suite in the run and is
 * stopped once by tests/globalTeardown.js.
 */
export const closeDatabase = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
};

/**
 * Remove all the data for all db collections.
 */
export const clearDatabase = async () => {
  if (mongoose.connection.readyState === 0) {
    return;
  }

  const collections = mongoose.connection.collections;

  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany();
  }
};
