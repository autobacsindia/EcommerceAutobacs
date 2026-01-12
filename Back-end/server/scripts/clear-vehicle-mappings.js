/**
 * Clear Incorrect Vehicle-Product Mappings
 * 
 * This script removes all existing vehicle-product associations that were
 * incorrectly set (all products mapped to all vehicles).
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../models/Product.js';

dotenv.config();

class ClearVehicleMappings {
  async connect() {
    try {
      const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
      if (!uri) {
        throw new Error('MongoDB URI not found in environment variables');
      }
      await mongoose.connect(uri);
      console.log('✓ Connected to MongoDB');
    } catch (error) {
      console.error('✗ Failed to connect to MongoDB:', error.message);
      throw error;
    }
  }

  async disconnect() {
    await mongoose.connection.close();
    console.log('✓ Disconnected from MongoDB');
  }

  async clearMappings() {
    try {
      console.log('\n=== CLEARING VEHICLE-PRODUCT MAPPINGS ===\n');

      // Count products with mappings before clearing
      const beforeCount = await Product.countDocuments({
        compatibleVehicles: { $exists: true, $ne: [] }
      });

      console.log(`Products with vehicle mappings: ${beforeCount}`);
      console.log('Clearing all mappings...\n');

      // Clear all compatibleVehicles arrays
      const result = await Product.updateMany(
        { compatibleVehicles: { $exists: true, $ne: [] } },
        { $set: { compatibleVehicles: [] } }
      );

      console.log(`✓ Cleared vehicle mappings from ${result.modifiedCount} products`);

      // Verify
      const afterCount = await Product.countDocuments({
        compatibleVehicles: { $exists: true, $ne: [] }
      });

      console.log(`Products with vehicle mappings after clear: ${afterCount}`);
      
      if (afterCount === 0) {
        console.log('\n✓ All vehicle mappings cleared successfully!');
      } else {
        console.log(`\n⚠ Warning: ${afterCount} products still have mappings`);
      }
    } catch (error) {
      console.error('✗ Failed to clear mappings:', error);
      throw error;
    }
  }

  async run() {
    try {
      await this.connect();
      await this.clearMappings();
      console.log('\n✓ Operation completed successfully!\n');
    } catch (error) {
      console.error('✗ Operation failed:', error);
      throw error;
    } finally {
      await this.disconnect();
    }
  }
}

// Run the script
const clear = new ClearVehicleMappings();
clear.run().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
