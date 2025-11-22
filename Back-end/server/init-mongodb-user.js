import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

console.log('Initializing MongoDB user...');

// Connect without authentication first
const connectWithoutAuth = async () => {
  try {
    console.log('Connecting to MongoDB without authentication...');
    await mongoose.connect('mongodb://localhost:27017/autobacs', {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('✓ Connected to MongoDB without authentication');
    return true;
  } catch (error) {
    console.error('✗ Failed to connect to MongoDB:', error.message);
    return false;
  }
};

// Create the required user
const createRequiredUser = async () => {
  try {
    // Switch to the admin database
    const adminDb = mongoose.connection.useDb('admin');
    
    // Create the user
    const username = 'Autobacs_info_db';
    const password = 'Info@autobacs';
    
    // Check if user already exists
    const users = await adminDb.db.command({ usersInfo: username });
    if (users.users.length > 0) {
      console.log(`User ${username} already exists`);
      // Drop the user first
      try {
        await adminDb.db.command({ dropUser: username });
        console.log(`Dropped existing user ${username}`);
      } catch (dropError) {
        console.log(`User ${username} did not exist or could not be dropped`);
      }
    }
    
    // Create the user with proper roles
    await adminDb.db.command({
      createUser: username,
      pwd: password,
      roles: [
        { role: 'readWrite', db: 'autobacs' },
        { role: 'dbAdmin', db: 'autobacs' }
      ]
    });
    
    console.log(`✓ Created user ${username} with proper permissions`);
    return true;
  } catch (error) {
    console.error('✗ Failed to create user:', error.message);
    return false;
  }
};

// Create the database if it doesn't exist
const createDatabase = async () => {
  try {
    const db = mongoose.connection.useDb('autobacs');
    
    // Create a simple collection to ensure the database exists
    await db.createCollection('init');
    await db.dropCollection('init');
    
    console.log('✓ Database autobacs created/verified');
    return true;
  } catch (error) {
    console.error('✗ Failed to create/verify database:', error.message);
    return false;
  }
};

// Main initialization function
const initialize = async () => {
  try {
    // Connect without authentication
    const connected = await connectWithoutAuth();
    if (!connected) {
      process.exit(1);
    }
    
    // Create the database
    await createDatabase();
    
    // Create the required user
    const userCreated = await createRequiredUser();
    if (!userCreated) {
      process.exit(1);
    }
    
    console.log('✓ MongoDB initialization completed successfully');
    
    // Close the connection
    await mongoose.connection.close();
    console.log('✓ Disconnected from MongoDB');
    
    process.exit(0);
  } catch (error) {
    console.error('✗ Initialization failed:', error.message);
    process.exit(1);
  }
};

// Run the initialization
initialize();