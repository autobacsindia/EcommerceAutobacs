import { jest } from '@jest/globals';

/**
 * Jest Test Setup - Production Configuration
 *
 * This file runs before each test file.
 * Sets up:
 * - In-memory MongoDB
 * - Global test utilities
 * - Mock cleanup
 * - Error handling
 */

import { createHash } from 'node:crypto';

import mongoose from 'mongoose';

// The in-memory MongoDB itself is started ONCE per run by tests/globalSetup.js and
// its URI arrives here on process.env. This file only opens a connection to it.
//
// Previously this file created a MongoMemoryReplSet in `beforeAll`, and because
// setupFilesAfterEnv runs once per *test file*, that spawned one mongod per suite —
// ~2.5s of fixed cost x ~167 suites, paid even by pure unit suites that never touch
// the database. Sharing one server is what makes the run parallelisable.

// Each test file gets its own database on the shared server, so suites stay as
// isolated from each other as they were with a server apiece. Derived from the test
// path (not a counter) so it is stable and collision-free across parallel workers.
const testDatabaseName = () => {
  const testPath = expect.getState()?.testPath ?? `worker-${process.env.JEST_WORKER_ID ?? '1'}`;
  return `jest_${createHash('sha1').update(testPath).digest('hex').slice(0, 24)}`;
};

// ── Global Setup ────────────────────────────────────────────────────────────

beforeAll(async () => {
  const uri = process.env.MONGO_TEST_URI;

  // Fail loudly rather than letting every db-touching test time out one by one.
  if (!uri) {
    throw new Error(
      '[Test] MONGO_TEST_URI is not set — tests/globalSetup.js did not run. ' +
      'Run the suite through the project jest config (npm test), not a bare jest binary.'
    );
  }

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri, {
      dbName: testDatabaseName(),
      maxPoolSize: 10, // Limit connections for tests
      serverSelectionTimeoutMS: 5000
    });
  }

  await waitForModelInit();
});

/**
 * Wait until every registered model has finished creating its collection and indexes,
 * and until config/db.js's ensureCriticalIndexes() pass (if this suite loaded it) is done.
 *
 * Each suite runs against a brand-new database, and importing `app.js` registers ~100
 * models. On connect, Mongoose starts `createCollection` + `createIndexes` for all of
 * them in the background (autoCreate/autoIndex are on in tests). If the first test fires
 * a request straight away, that request queues behind hundreds of catalog writes on a
 * one-member replica set shared with every other worker. On a loaded machine the first
 * `findOne`/`save` took 20–30 s each, the request outlived the client socket ("socket
 * hang up" at ~60 s), and the still-running handler then hit a VersionError because the
 * test's afterEach had already wiped the collection under it.
 *
 * Settling that work here, in the hook (which has the full test timeout), makes the
 * first test start from the same ready schema as every later one. `Model.init()` is
 * memoised by Mongoose, so this awaits the build already in flight rather than starting
 * a second one.
 */
async function waitForModelInit() {
  if (mongoose.connection.readyState !== 1 && mongoose.connection.readyState !== 2) {
    return;
  }

  // A model that fails to build an index (e.g. a test that deliberately seeds duplicate
  // rows) must still be able to run its own assertions, so failures are reported, not thrown.
  const results = await Promise.allSettled(
    Object.values(mongoose.connection.models).map((model) => model.init())
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('[Test] Model init failed:', result.reason?.message ?? result.reason);
    }
  }

  // config/db.js also starts ensureCriticalIndexes() — ~150 serial index creates/drops,
  // including on orders and users — on 'connected' (only in suites that load it, via
  // app.js). Left running, it broke a suite's first transaction with "Unable to write to
  // collection … due to catalog changes". Same key as CRITICAL_INDEXES_READY there.
  await mongoose.connection[Symbol.for('autobacs.criticalIndexesReady')];
}

// ── Per-Test Cleanup ────────────────────────────────────────────────────────

afterEach(async () => {
  // Clear all collections (not drop, faster)
  if (mongoose.connection.readyState === 1) {
    const collections = mongoose.connection.collections;

    await Promise.all(
      Object.values(collections).map(collection =>
        collection.deleteMany({})
      )
    );
  }

  // Clear all mocks
  jest.clearAllMocks();
});

// ── Global Teardown ─────────────────────────────────────────────────────────

afterAll(async () => {
  // Drop this file's database so the shared server does not accumulate ~167 of
  // them over a run, then close the connection. The server itself is stopped once,
  // by tests/globalTeardown.js.
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
  }

  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
});

// ── Global Error Handling ───────────────────────────────────────────────────

// Prevent unhandled promise rejections from crashing tests
process.on('unhandledRejection', (error) => {
  console.error('[Test] Unhandled Promise Rejection:', error);
});

// Prevent open handles from hanging tests
process.on('uncaughtException', (error) => {
  console.error('[Test] Uncaught Exception:', error);
});

// ── Global Test Utilities ───────────────────────────────────────────────────

/**
 * Create authenticated request helper
 * 
 * Usage:
 *   const { authenticatedRequest } = global;
 *   const res = await authenticatedRequest(app).get('/api/v1/profile');
 */
global.createTestUser = async (overrides = {}) => {
  const { default: User } = await import('../models/User.js');
  
  const userData = {
    name: 'Test User',
    email: `test${Date.now()}@example.com`,
    password: 'TestPass123!',
    role: 'user',
    ...overrides
  };
  
  return await User.create(userData);
};

/**
 * Generate test auth token
 */
global.generateAuthToken = async (user) => {
  const jwt = await import('jsonwebtoken');
  return jwt.default.sign(
    { userId: user._id },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
};

/**
 * Create authenticated supertest request
 */
global.authenticatedRequest = async (app, user) => {
  const supertest = await import('supertest');
  const token = await global.generateAuthToken(user);
  
  return supertest.default(app)
    .get('/') // Dummy request to get agent
    .set('Authorization', `Bearer ${token}`);
};

// ── Suppress Console in Tests (Optional) ────────────────────────────────────

// Uncomment to suppress console.log in tests (reduces noise)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
// };

// Always keep console.error for debugging test failures
