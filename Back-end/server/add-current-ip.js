#!/usr/bin/env node

/**
 * Script to add current IP to MongoDB Atlas whitelist
 */

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

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

async function addToWhitelist() {
  try {
    // Get required configuration
    const publicKey = process.env.MONGODB_ATLAS_PUBLIC_API_KEY;
    const privateKey = process.env.MONGODB_ATLAS_PRIVATE_API_KEY;
    const projectId = process.env.MONGODB_ATLAS_PROJECT_ID;
    
    if (!publicKey || !privateKey || !projectId) {
      throw new Error('Missing required MongoDB Atlas configuration. Please check your .env file.');
    }
    
    // Get current IP
    const currentIP = await getCurrentIP();
    console.log('Current IP:', currentIP);
    
    // Add IP to whitelist
    const baseUrl = `https://cloud.mongodb.com/api/atlas/v1.0/groups/${projectId}/accessList`;
    
    const payload = {
      ipAddress: currentIP,
      comment: `Development machine - Added on ${new Date().toISOString().split('T')[0]}`
    };
    
    console.log('Adding IP to whitelist...');
    
    const response = await axios.post(baseUrl, payload, {
      auth: {
        username: publicKey,
        password: privateKey
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Successfully added IP to whitelist');
    console.log('Response:', response.data);
    
  } catch (error) {
    if (error.response && error.response.data && error.response.data.detail) {
      console.error('❌ Failed to add IP to whitelist:', error.response.data.detail);
    } else {
      console.error('❌ Failed to add IP to whitelist:', error.message);
    }
    process.exit(1);
  }
}

addToWhitelist();