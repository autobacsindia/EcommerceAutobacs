import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let mongod;

/**
 * Connect to the in-memory database.
 */
export const connect = async () => {
  // Prevent connecting if already connected
  if (mongoose.connection.readyState !== 0) {
    return;
  }

  // A REPLICA SET, not a standalone.
  //
  // Production order creation wraps the order + payment record + cart clear in a
  // MongoDB transaction (CLAUDE.md requires it for multi-document writes), and
  // transactions are only available on a replica set or mongos. Against the old
  // standalone `MongoMemoryServer` every checkout returned:
  //
  //   500 "Transaction numbers are only allowed on a replica set member or mongos"
  //
  // which is why the orders / ordersIntegration / e2eUserJourney suites failed on
  // anything that placed an order. The failure looked like broken order code rather
  // than a test-harness limitation, so it went unfixed for months.
  //
  // A single-member replica set boots in roughly the same time as a standalone and
  // matches the production topology, so the tests now exercise the real code path.
  mongod = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ launchTimeout: 120000 }],
    binary: { version: '7.0.14' },
  });
  const uri = mongod.getUri();

  await mongoose.connect(uri);
};

/**
 * Drop database, close the connection and stop mongod.
 */
export const closeDatabase = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
  
  if (mongod) {
    await mongod.stop();
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
