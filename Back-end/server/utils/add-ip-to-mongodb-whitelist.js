#!/usr/bin/env node

/**
 * Utility script to add current IP to MongoDB instance whitelist
 * This script is for self-hosted MongoDB instances that have IP whitelisting enabled
 */

import axios from 'axios';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import { promisify } from 'util';

dotenv.config();

const execPromise = promisify(exec);

console.log('MongoDB IP Whitelist Manager');
console.log('============================');

// Get current public IP using multiple services for redundancy
async function getCurrentIP() {
  const services = [
    'https://api.ipify.org',
    'https://icanhazip.com',
    'https://ident.me'
  ];

  for (const service of services) {
    try {
      const response = await axios.get(service, { timeout: 5000 });
      const ip = response.data.trim();
      // Validate IP format
      if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip)) {
        return ip;
      }
    } catch (error) {
      console.warn(`Failed to get IP from ${service}:`, error.message);
    }
  }
  
  throw new Error('Failed to get current IP address from all services');
}

// Test if we can reach the MongoDB instance
async function testMongoDBAccess() {
  try {
    // Extract host from MONGO_URI
    const uri = process.env.MONGO_URI;
    if (!uri) {
      throw new Error('MONGO_URI not found in environment variables');
    }
    
    // Simple test - try to connect to the MongoDB port
    const hostMatch = uri.match(/mongodb:\/\/[^@]*@([^:]+):(\d+)/);
    if (!hostMatch) {
      throw new Error('Could not parse MongoDB host from connection string');
    }
    
    const host = hostMatch[1];
    const port = hostMatch[2];
    
    console.log(`Testing connectivity to MongoDB at ${host}:${port}...`);
    
    // Try to establish a basic TCP connection
    const net = await import('net');
    const client = new net.Socket();
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.destroy();
        reject(new Error('Connection timeout'));
      }, 5000);
      
      client.connect(port, host, () => {
        clearTimeout(timeout);
        client.destroy();
        resolve(true);
      });
      
      client.on('error', (err) => {
        clearTimeout(timeout);
        client.destroy();
        reject(err);
      });
    });
  } catch (error) {
    console.error('Connectivity test failed:', error.message);
    return false;
  }
}

// Instructions for adding IP to MongoDB whitelist
function provideWhitelistInstructions(currentIP) {
  console.log('\nTo add your IP to the MongoDB whitelist:');
  console.log('========================================');
  
  console.log('\nIf using MongoDB Atlas:');
  console.log('1. Login to MongoDB Atlas at https://cloud.mongodb.com/');
  console.log('2. Navigate to your cluster > Network Access (under Security)');
  console.log('3. Click "Add IP Address"');
  console.log('4. Add your current IP address:', currentIP);
  console.log('5. Optionally, add a description like "Development Machine"');
  console.log('6. Click "Confirm" to save changes');
  
  console.log('\nIf using self-hosted MongoDB with firewall:');
  console.log('1. SSH into your MongoDB server');
  console.log('2. Check your firewall configuration:');
  console.log('   - For UFW: sudo ufw allow from', currentIP);
  console.log('   - For iptables: sudo iptables -A INPUT -s', currentIP, '-p tcp --dport 27017 -j ACCEPT');
  console.log('3. Restart firewall if needed');
  
  console.log('\nIf using cloud provider security groups (AWS, Azure, GCP):');
  console.log('1. Navigate to your VM\'s security group settings');
  console.log('2. Add inbound rule allowing TCP traffic on port 27017 from', currentIP);
  
  console.log('\nAlternative (for development only):');
  console.log('- You can temporarily allow access from any IP (0.0.0.0/0)');
  console.log('- WARNING: Never use 0.0.0.0/0 in production!');
  
  console.log('\nAfter updating the whitelist:');
  console.log('- Wait 1-2 minutes for changes to propagate');
  console.log('- Test connection with: npm run test-db');
}

async function main() {
  try {
    console.log('Getting current public IP address...');
    const currentIP = await getCurrentIP();
    console.log('✓ Current Public IP Address:', currentIP);
    
    console.log('\nTesting MongoDB connectivity...');
    try {
      const isConnected = await testMongoDBAccess();
      if (isConnected) {
        console.log('✓ Successfully connected to MongoDB');
      } else {
        console.log('⚠ Could not connect to MongoDB - likely due to IP whitelist restrictions');
      }
    } catch (error) {
      console.log('⚠ Could not connect to MongoDB - likely due to IP whitelist restrictions');
      console.log('Error details:', error.message);
    }
    
    provideWhitelistInstructions(currentIP);
    
    console.log('\nAdditional troubleshooting tips:');
    console.log('- Ensure MongoDB is running and listening on the correct IP');
    console.log('- Check if MongoDB is configured to accept connections from external IPs');
    console.log('- Verify authentication credentials in the connection string');
    console.log('- Confirm the MongoDB instance is not behind a VPN or private network');
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run the script
main();