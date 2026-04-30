/**
 * Fix Cart Index Migration
 * 
 * Problem: Old unique index on `user` field doesn't allow null values
 * Solution: Drop old index, create new partial index that allows nulls
 * 
 * Run once in production to fix guest cart creation
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
      console.log(`  - ${idx.name}:`, JSON.stringify(idx.key));
      if (idx.unique) console.log('    UNIQUE:', idx.unique);
      if (idx.partialFilterExpression) console.log('    PARTIAL:', JSON.stringify(idx.partialFilterExpression));
    });

    // Check if old user_1 index exists without partial filter
    const oldUserIndex = indexes.find(idx => 
      idx.name === 'user_1' && !idx.partialFilterExpression && idx.unique
    );

    if (oldUserIndex) {
      console.log('\n⚠️  Found OLD user_1 index without partial filter');
      console.log('Dropping old index...');
      await collection.dropIndex('user_1');
      console.log('✓ Dropped old user_1 index');

      // Create new partial index
      console.log('Creating new partial index...');
      await collection.createIndex(
        { user: 1 },
        {
          unique: true,
          partialFilterExpression: { user: { $exists: true } }
        }
      );
      console.log('✓ Created new partial index on user field');
    } else {
      console.log('\n✅ No old index found. Indexes are correct!');
    }

    // Verify the fix
    console.log('\n📋 Updated indexes:');
    const updatedIndexes = await collection.indexes();
    updatedIndexes.forEach(idx => {
      console.log(`  - ${idx.name}:`, JSON.stringify(idx.key));
      if (idx.unique) console.log('    UNIQUE:', idx.unique);
      if (idx.partialFilterExpression) console.log('    PARTIAL:', JSON.stringify(idx.partialFilterExpression));
    });

    console.log('\n✅ Migration complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

fixCartIndexes();
