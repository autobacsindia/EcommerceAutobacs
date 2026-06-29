import { writeFileSync, copyFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

console.log('MongoDB Authentication Setup Script');
console.log('==================================');

const mongoConfigPath = 'C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.cfg';
const projectConfigPath = join(process.cwd(), 'mongod-with-auth.cfg');
const tempConfigPath = join(process.cwd(), 'mongod-temp.cfg');

// Function to disable authentication
async function disableAuth() {
  console.log('Disabling MongoDB authentication...');
  
  // Read the current config
  const configContent = `# mongod.conf

# for documentation of all options, see:
#   http://docs.mongodb.org/manual/reference/configuration-options/

# Where and how to store data.
storage:
  dbPath: C:\\Program Files\\MongoDB\\Server\\8.2\\data

# where to write logging data.
systemLog:
  destination: file
  logAppend: true
  path: C:\\Program Files\\MongoDB\\Server\\8.2\\log\\mongod.log

# network interfaces
net:
  port: 27017
  bindIp: 127.0.0.1

# Security settings (authentication disabled)
#security:
#  authorization: enabled

#processManagement:

#operationProfiling:

#replication:

#sharding:

## Enterprise-Only Options:

#auditLog:
`;
  
  try {
    writeFileSync(tempConfigPath, configContent);
    console.log('✓ Created temporary configuration without authentication');
    return true;
  } catch (error) {
    console.error('✗ Failed to create temporary configuration:', error.message);
    return false;
  }
}

// Function to enable authentication
async function enableAuth() {
  console.log('Enabling MongoDB authentication...');
  
  try {
    // Copy the auth-enabled config
    copyFileSync(projectConfigPath, tempConfigPath);
    console.log('✓ Created temporary configuration with authentication');
    return true;
  } catch (error) {
    console.error('✗ Failed to create temporary configuration:', error.message);
    return false;
  }
}

// Function to replace the MongoDB config file
async function replaceConfig() {
  console.log('Replacing MongoDB configuration file...');
  
  try {
    copyFileSync(tempConfigPath, mongoConfigPath);
    console.log('✓ Replaced MongoDB configuration file');
    return true;
  } catch (error) {
    console.error('✗ Failed to replace MongoDB configuration:', error.message);
    return false;
  }
}

// Function to clean up temporary files
async function cleanup() {
  try {
    if (existsSync(tempConfigPath)) {
      unlinkSync(tempConfigPath);
      console.log('✓ Cleaned up temporary files');
    }
  } catch (error) {
    console.warn('Warning: Could not clean up temporary files:', error.message);
  }
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  const action = args[0];
  
  if (!action) {
    console.log('Usage: node setup-mongodb-auth.js [disable-auth|enable-auth|setup-complete]');
    process.exit(1);
  }
  
  switch (action) {
    case 'disable-auth':
      await disableAuth();
      await replaceConfig();
      console.log('\nNext steps:');
      console.log('1. Start MongoDB service: net start MongoDB');
      console.log('2. Run: node init-mongodb-user.js');
      console.log('3. Run: node setup-mongodb-auth.js enable-auth');
      break;
      
    case 'enable-auth':
      await enableAuth();
      await replaceConfig();
      console.log('\nNext steps:');
      console.log('1. Stop MongoDB service: net stop MongoDB');
      console.log('2. Start MongoDB service: net start MongoDB');
      console.log('3. Run: npm run test-db');
      break;
      
    case 'setup-complete':
      await cleanup();
      console.log('✓ MongoDB authentication setup completed');
      break;
      
    default:
      console.log('Invalid action. Use: disable-auth, enable-auth, or setup-complete');
      process.exit(1);
  }
}

// Run the script
main();