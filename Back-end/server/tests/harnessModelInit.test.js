/**
 * Harness regression — every model's collection + index build is settled before the
 * first test of a suite runs (tests/setup.js `waitForModelInit`).
 *
 * Without it, the first request of a suite raced ~100 models' background index builds
 * on a fresh database. Under load that made the first POST /auth/register take 60 s+,
 * fail with "socket hang up", and then throw a VersionError when afterEach wiped the
 * user out from under the still-running handler (auth.integration and
 * e2e.product-lifecycle in the pre-push hook).
 */

import mongoose from 'mongoose';
import { app } from '../app.js';
import { CRITICAL_INDEXES_READY } from '../config/db.js';

test('all model inits and the critical-index pass have finished before the first test', async () => {
  // Importing the app is what registers the models; guard against an empty check.
  expect(app).toBeDefined();
  const models = Object.values(mongoose.connection.models);
  expect(models.length).toBeGreaterThan(10);

  const pending = new Set(models.map((m) => m.modelName));
  for (const model of models) {
    // `init()` is memoised: it hands back the build started on connect.
    model.init().then(
      () => pending.delete(model.modelName),
      () => pending.delete(model.modelName)
    );
  }

  // config/db.js's ensureCriticalIndexes() pass, started on 'connected'. It also touches
  // orders/users, and a suite's first transaction collided with it ("catalog changes").
  const critical = mongoose.connection[CRITICAL_INDEXES_READY];
  expect(critical).toBeInstanceOf(Promise);
  pending.add('ensureCriticalIndexes');
  critical.then(() => pending.delete('ensureCriticalIndexes'));

  // Let already-settled promises run their callbacks; an unfinished build will not.
  await new Promise((resolve) => setImmediate(resolve));

  expect([...pending]).toEqual([]);
});
