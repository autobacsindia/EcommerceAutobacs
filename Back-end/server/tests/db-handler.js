import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod;

/**
 * Connect to the in-memory database.
 */
export const connect = async () => {
  // Prevent connecting if already connected
  if (mongoose.connection.readyState !== 0) {
    return;
  }

  mongod = await MongoMemoryServer.create({
    instance: {
      launchTimeout: 30000
    }
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
