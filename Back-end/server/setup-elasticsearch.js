#!/usr/bin/env node

/**
 * Elasticsearch Setup Script
 * 
 * Creates optimized index mapping and syncs products.
 * 
 * Usage:
 *   node setup-elasticsearch.js
 * 
 * Prerequisites:
 *   - Elasticsearch running (Docker or local)
 *   - ELASTICSEARCH_ENABLED=true in .env
 */

import { Client } from '@elastic/elasticsearch';
import dotenv from 'dotenv';
import Product from './models/Product.js';
import mongoose from 'mongoose';

// Load environment variables
dotenv.config();

// Configuration
const ES_NODE = process.env.ELASTICSEARCH_NODE || 'http://localhost:9200';
const ES_USERNAME = process.env.ELASTICSEARCH_USERNAME || 'elastic';
const ES_PASSWORD = process.env.ELASTICSEARCH_PASSWORD || 'changeme';
const INDEX_NAME = process.env.ELASTICSEARCH_INDEX || 'products';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/autobacs';

// Optimized index mapping with field boosting
const indexMapping = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    analysis: {
      analyzer: {
        autocomplete_analyzer: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'autocomplete_filter']
        },
        autocomplete_search_analyzer: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase']
        }
      },
      filter: {
        autocomplete_filter: {
          type: 'edge_ngram',
          min_gram: 2,
          max_gram: 20
        }
      }
    }
  },
  mappings: {
    properties: {
      productId: { type: 'keyword' },
      name: {
        type: 'text',
        boost: 3,
        analyzer: 'standard',
        fields: {
          autocomplete: {
            type: 'text',
            analyzer: 'autocomplete_analyzer',
            search_analyzer: 'autocomplete_search_analyzer'
          },
          keyword: {
            type: 'keyword'
          }
        }
      },
      brand: {
        type: 'text',
        boost: 2,
        fields: {
          keyword: { type: 'keyword' }
        }
      },
      tags: {
        type: 'text',
        boost: 1.5
      },
      description: {
        type: 'text',
        boost: 1
      },
      price: { type: 'double' },
      stock: { type: 'integer' },
      category: { type: 'keyword' },
      slug: { type: 'keyword' },
      createdAt: { type: 'date' },
      updatedAt: { type: 'date' }
    }
  }
};

async function setupElasticsearch() {
  console.log('🚀 Elasticsearch Setup\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Check if enabled
  if (process.env.ELASTICSEARCH_ENABLED !== 'true') {
    console.error('❌ Elasticsearch is not enabled!');
    console.error('\nAdd to your .env file:');
    console.error('  ELASTICSEARCH_ENABLED=true');
    console.error('  ELASTICSEARCH_NODE=http://localhost:9200');
    console.error('  ELASTICSEARCH_USERNAME=elastic');
    console.error('  ELASTICSEARCH_PASSWORD=changeme');
    process.exit(1);
  }

  // Connect to MongoDB
  console.log('📦 Connecting to MongoDB...');
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✓ Connected to MongoDB\n');
  } catch (error) {
    console.error('✗ MongoDB connection failed:', error.message);
    process.exit(1);
  }

  // Initialize Elasticsearch client
  console.log('🔌 Connecting to Elasticsearch...');
  let client;
  try {
    client = new Client({
      node: ES_NODE,
      auth: {
        username: ES_USERNAME,
        password: ES_PASSWORD
      },
      requestTimeout: 30000,
      maxRetries: 3
    });

    // Test connection
    const info = await client.info();
    console.log(`✓ Connected to Elasticsearch ${info.version.number}`);
    console.log(`  Cluster: ${info.cluster_name}\n`);
  } catch (error) {
    console.error('✗ Elasticsearch connection failed:', error.message);
    console.error('\nMake sure Elasticsearch is running:');
    console.error('  docker run -d --name elasticsearch -p 9200:9200 elasticsearch:8.10.0');
    process.exit(1);
  }

  // Delete existing index if it exists
  console.log('🗑️  Checking for existing index...');
  try {
    const exists = await client.indices.exists({ index: INDEX_NAME });
    if (exists.body) {
      console.log(`⚠️  Index "${INDEX_NAME}" already exists. Deleting...`);
      await client.indices.delete({ index: INDEX_NAME });
      console.log('✓ Deleted existing index\n');
    } else {
      console.log(`✓ No existing index found\n`);
    }
  } catch (error) {
    console.error('✗ Error checking index:', error.message);
  }

  // Create new index with mapping
  console.log('🏗️  Creating index with optimized mapping...');
  console.log('  Field boosting:');
  console.log('    - name: 3x (most important)');
  console.log('    - brand: 2x (important)');
  console.log('    - tags: 1.5x (moderate)');
  console.log('    - description: 1x (baseline)');
  console.log('  Features:');
  console.log('    - Autocomplete (edge n-grams)');
  console.log('    - Fuzzy search support');
  console.log('    - Synonym support ready\n');

  try {
    await client.indices.create({
      index: INDEX_NAME,
      body: indexMapping
    });
    console.log(`✓ Index "${INDEX_NAME}" created successfully\n`);
  } catch (error) {
    console.error('✗ Failed to create index:', error.message);
    process.exit(1);
  }

  // Sync products from MongoDB
  console.log('📊 Syncing products from MongoDB...');
  
  const totalProducts = await Product.countDocuments();
  console.log(`  Found ${totalProducts.toLocaleString()} products in MongoDB\n`);

  if (totalProducts === 0) {
    console.log('⚠️  No products to index. Add some products first.\n');
    console.log('ℹ️  Skipping product sync.\n');
  } else {
    const BATCH_SIZE = 500;
    let indexed = 0;
    let errors = 0;

    for (let i = 0; i < totalProducts; i += BATCH_SIZE) {
      const products = await Product.find()
        .skip(i)
        .limit(BATCH_SIZE)
        .select('_id name description brand tags price stock category slug createdAt updatedAt')
        .lean();

      const bulkBody = [];
      
      for (const product of products) {
        bulkBody.push(
          { index: { _index: INDEX_NAME, _id: product._id.toString() } }
        );
        bulkBody.push({
          productId: product._id.toString(),
          name: product.name || '',
          brand: product.brand || '',
          tags: product.tags?.join(' ') || '',
          description: product.description || '',
          price: product.price || 0,
          stock: product.stock || 0,
          category: product.category?.toString() || '',
          slug: product.slug || '',
          createdAt: product.createdAt,
          updatedAt: product.updatedAt
        });
        indexed++;
      }

      if (bulkBody.length > 0) {
        try {
          await client.bulk({ body: bulkBody });
          console.log(`✓ Indexed ${Math.min(indexed, totalProducts).toLocaleString()} / ${totalProducts.toLocaleString()} products`);
        } catch (error) {
          console.error(`✗ Error indexing batch: ${error.message}`);
          errors++;
        }
      }
    }

    console.log('');
    if (errors > 0) {
      console.log(`⚠️  Completed with ${errors} error(s)\n`);
    } else {
      console.log(`✅ Successfully indexed ${indexed.toLocaleString()} products!\n`);
    }
  }

  // Verify index stats
  console.log('📊 Index Statistics:');
  try {
    const stats = await client.cat.indices({
      index: INDEX_NAME,
      format: 'json',
      h: 'docs.count,store.size,pri,rep'
    });

    const indexStats = stats.body[0];
    console.log(`  Documents: ${parseInt(indexStats['docs.count']).toLocaleString()}`);
    console.log(`  Size: ${indexStats['store.size']}`);
    console.log(`  Shards: ${indexStats.pri} primary, ${indexStats.rep} replica\n`);
  } catch (error) {
    console.log('  (Could not retrieve stats)\n');
  }

  // Test search
  console.log('🧪 Testing search functionality...');
  try {
    const testQuery = {
      query: {
        multi_match: {
          query: 'test',
          fields: ['name^3', 'brand^2', 'tags', 'description']
        }
      }
    };

    const response = await client.search({
      index: INDEX_NAME,
      body: testQuery
    });

    const took = response.took;
    const hits = response.hits.total.value;

    console.log(`✓ Search working!`);
    console.log(`  Query time: ${took}ms`);
    console.log(`  Total hits: ${hits}\n`);

    if (took > 100) {
      console.log('⚠️  Warning: Query time > 100ms. Consider optimizing.\n');
    }
  } catch (error) {
    console.error('✗ Search test failed:', error.message);
  }

  // Summary
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('✅ Elasticsearch Setup Complete!\n');
  console.log('📝 Next Steps:\n');
  console.log('1. Test search queries in your application:');
  console.log('   GET /api/v1/search?q=brake+pads\n');
  console.log('2. Enable autocomplete in frontend:');
  console.log('   GET /api/v1/search/autocomplete?q=bra\n');
  console.log('3. Monitor performance:');
  console.log('   Target: < 100ms response time\n');
  console.log('4. Deploy to production when ready!\n');
  console.log('🎉 Enjoy blazing-fast search! ⚡\n');

  // Cleanup
  await mongoose.disconnect();
  process.exit(0);
}

// Run setup
setupElasticsearch().catch(error => {
  console.error('💥 Fatal error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
