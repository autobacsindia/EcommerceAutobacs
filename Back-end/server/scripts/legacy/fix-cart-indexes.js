/**
 * Fix Cart Indexes in Production
 * 
 * This script drops the old duplicate unique index on {user: 1} 
 * and ensures only the partial index exists.
 * 
 * Run once in production:
 * node fix-cart-indexes.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function fixCartIndexes() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('carts');

    // List all indexes
    console.log('\n📋 Current indexes:');
    const indexes = await collection.indexes();
    indexes.forEach(idx => {
      console.log(`  - ${JSON.stringify(idx.key)} (unique: ${idx.unique || false}, partial: ${!!idx.partialFilterExpression})`);
    });

    // Find and drop the problematic index
    const problemIndex = indexes.find(idx => {
      return idx.key.user === 1 && idx.unique === true && !idx.partialFilterExpression;
    });

    if (problemIndex) {
      console.log(`\n❌ Found problematic index: ${problemIndex.name}`);
      console.log('   Dropping index...');
      await collection.dropIndex(problemIndex.name);
      console.log('✓ Index dropped successfully');
    } else {
      console.log('\n✓ No problematic index found');
    }

    // Verify the partial index exists
    const partialIndex = indexes.find(idx => {
      return idx.key.user === 1 && idx.unique === true && idx.partialFilterExpression;
    });

    if (!partialIndex) {
      console.log('\n⚠️  Partial index for user not found. Creating...');
      await collection.createIndex(
        { user: 1 },
        {
          unique: true,
          partialFilterExpression: { user: { $exists: true, $ne: null } }
        }
      );
      console.log('✓ Partial index created');
    } else {
      console.log('\n✓ Partial index for user already exists');
    }

    // Final verification
    console.log('\n📋 Final indexes:');
    const finalIndexes = await collection.indexes();
    finalIndexes.forEach(idx => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)} (unique: ${idx.unique || false}, partial: ${!!idx.partialFilterExpression})`);
    });

    console.log('\n✅ Cart indexes fixed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixCartIndexes();
