import { MongoClient } from 'mongodb';

console.log('Creating MongoDB user directly...');

async function createMongoDBUser() {
  let client;
  
  try {
    // Connect to MongoDB without authentication
    console.log('Connecting to MongoDB without authentication...');
    client = new MongoClient('mongodb://localhost:27017');
    
    await client.connect();
    console.log('✓ Connected to MongoDB');
    
    const adminDb = client.db('admin');
    
    // Create the user
    const username = 'Autobacs_info_db';
    const password = 'Info@autobacs';
    
    console.log(`Creating user ${username}...`);
    
    // First, try to drop the user if it exists
    try {
      await adminDb.command({ dropUser: username });
      console.log(`Dropped existing user ${username}`);
    } catch (error) {
      console.log(`User ${username} does not exist or could not be dropped`);
    }
    
    // Create the user with proper roles
    await adminDb.command({
      createUser: username,
      pwd: password,
      roles: [
        { role: 'readWrite', db: 'autobacs' },
        { role: 'dbAdmin', db: 'autobacs' },
        { role: 'userAdminAnyDatabase', db: 'admin' },
        { role: 'readWriteAnyDatabase', db: 'admin' }
      ]
    });
    
    console.log(`✓ Created user ${username} with proper permissions`);
    
    // Create the autobacs database
    const autobacsDb = client.db('autobacs');
    await autobacsDb.createCollection('init');
    await autobacsDb.dropCollection('init');
    console.log('✓ Created/verified autobacs database');
    
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('✓ Disconnected from MongoDB');
    }
  }
}

createMongoDBUser();