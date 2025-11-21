#!/usr/bin/env node

import MongoDBWhitelistManager from './mongodb-whitelist-manager.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  // Handle help command before instantiating manager
  if (!command || command === 'help') {
    console.log('MongoDB Atlas Whitelist Manager');
    console.log('===============================');
    console.log('Available commands:');
    console.log('  add-current          Add current IP to whitelist');
    console.log('  add <ip> [desc] [ttl] Add specific IP to whitelist');
    console.log('  remove <ip>          Remove IP from whitelist');
    console.log('  list                 List all whitelisted IPs');
    console.log('  check <ip>           Check if IP is whitelisted');
    console.log('');
    console.log('Examples:');
    console.log('  node mongodb-whitelist-cli.js add-current');
    console.log('  node mongodb-whitelist-cli.js add 192.168.1.100 "Office IP" 48');
    console.log('  node mongodb-whitelist-cli.js remove 192.168.1.100');
    console.log('  node mongodb-whitelist-cli.js list');
    console.log('  node mongodb-whitelist-cli.js check 192.168.1.100');
    return;
  }
  
  try {
    const manager = new MongoDBWhitelistManager();
    
    switch (command) {
      case 'add-current':
        console.log('Adding current IP to MongoDB Atlas whitelist...');
        await manager.addCurrentIP();
        break;
        
      case 'add':
        if (args.length < 2) {
          console.error('Usage: node mongodb-whitelist-cli.js add <ip-address> [description] [ttl-hours]');
          process.exit(1);
        }
        const ipAddress = args[1];
        const description = args[2] || 'Added via CLI';
        const ttlHours = args[3] ? parseInt(args[3]) : 24;
        console.log(`Adding IP ${ipAddress} to MongoDB Atlas whitelist...`);
        await manager.addIP(ipAddress, description, ttlHours);
        break;
        
      case 'remove':
        if (args.length < 2) {
          console.error('Usage: node mongodb-whitelist-cli.js remove <ip-address>');
          process.exit(1);
        }
        const ipToRemove = args[1];
        console.log(`Removing IP ${ipToRemove} from MongoDB Atlas whitelist...`);
        await manager.removeIP(ipToRemove);
        break;
        
      case 'list':
        console.log('Fetching MongoDB Atlas whitelist...');
        const whitelist = await manager.listIPs();
        console.log('\nMongoDB Atlas IP Whitelist:');
        console.log('===========================');
        if (whitelist.results && whitelist.results.length > 0) {
          whitelist.results.forEach((entry, index) => {
            console.log(`${index + 1}. ${entry.ipAddress}`);
            if (entry.comment) {
              console.log(`   Description: ${entry.comment}`);
            }
            if (entry.deleteAfterDate) {
              console.log(`   Expires: ${new Date(entry.deleteAfterDate).toLocaleString()}`);
            }
            console.log('');
          });
        } else {
          console.log('No IP addresses in whitelist');
        }
        break;
        
      case 'check':
        if (args.length < 2) {
          console.error('Usage: node mongodb-whitelist-cli.js check <ip-address>');
          process.exit(1);
        }
        const ipToCheck = args[1];
        console.log(`Checking if IP ${ipToCheck} is in MongoDB Atlas whitelist...`);
        const isWhitelisted = await manager.isIPWhitelisted(ipToCheck);
        if (isWhitelisted) {
          console.log(`✓ IP ${ipToCheck} is whitelisted`);
        } else {
          console.log(`✗ IP ${ipToCheck} is NOT whitelisted`);
        }
        break;
        
      default:
        console.log('MongoDB Atlas Whitelist Manager');
        console.log('===============================');
        console.log('Available commands:');
        console.log('  add-current          Add current IP to whitelist');
        console.log('  add <ip> [desc] [ttl] Add specific IP to whitelist');
        console.log('  remove <ip>          Remove IP from whitelist');
        console.log('  list                 List all whitelisted IPs');
        console.log('  check <ip>           Check if IP is whitelisted');
        console.log('');
        console.log('Examples:');
        console.log('  node mongodb-whitelist-cli.js add-current');
        console.log('  node mongodb-whitelist-cli.js add 192.168.1.100 "Office IP" 48');
        console.log('  node mongodb-whitelist-cli.js remove 192.168.1.100');
        console.log('  node mongodb-whitelist-cli.js list');
        console.log('  node mongodb-whitelist-cli.js check 192.168.1.100');
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();

export default main;