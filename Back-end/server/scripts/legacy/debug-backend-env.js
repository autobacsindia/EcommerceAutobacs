import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import locationService from '../../services/locationService.js';
import { connectWithRetry } from '../../config/db.js';

// Load env
dotenv.config();

console.log('=== Backend Environment Debug ===');
console.log('GOOGLE_MAPS_SERVER_KEY:', process.env.GOOGLE_MAPS_SERVER_KEY ? (process.env.GOOGLE_MAPS_SERVER_KEY.substring(0, 5) + '...') : 'undefined');
console.log('GOOGLE_MAPS_CLIENT_KEY:', process.env.GOOGLE_MAPS_CLIENT_KEY ? (process.env.GOOGLE_MAPS_CLIENT_KEY.substring(0, 5) + '...') : 'undefined');

async function testReverseGeocode() {
  console.log('\nConnecting to DB...');
  await connectWithRetry();

  console.log('\nTesting selectLocation with coordinates...');
  try {
    const identifier = { sessionId: 'debug-session' };
    const locationData = {
      coordinates: {
        latitude: 12.9716,
        longitude: 77.5946
      }
    };

    const result = await locationService.selectLocation(identifier, locationData);
    console.log('Success:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Caught Error:', error);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  } finally {
    await mongoose.disconnect();
  }
}

testReverseGeocode();
