/**
 * Jest globalTeardown — stops the single in-memory MongoDB started by
 * tests/globalSetup.js. Runs once, after every worker has exited.
 *
 * `mongod` is a real child process, so failing to stop it leaks it past the run.
 * `forceExit` in jest.config.js does not reap it.
 */
export default async function globalTeardown() {
  const replSet = globalThis.__MONGO_REPLSET__;

  if (replSet) {
    await replSet.stop();
    globalThis.__MONGO_REPLSET__ = undefined;
  }
}
