import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Product from '../models/Product.js';
// Dynamic import for service to ensure env is loaded first
// import elasticsearchService from '../services/elasticsearchService.js';
import Vehicle from '../models/Vehicle.js'; 
import Category from '../models/Category.js'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from the server root
dotenv.config({ path: join(__dirname, '../.env') });

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

const syncElasticsearch = async () => {
  console.log('Starting Elasticsearch synchronization...');
  
  // Dynamically import service after env is loaded
  const { default: elasticsearchService } = await import('../services/elasticsearchService.js');

  // 1. Connect to MongoDB
  await connectDB();

  // 2. Check Elasticsearch connection
  // Force enable for this script even if disabled in env (unless explicitly set to false)
  if (process.env.ELASTICSEARCH_ENABLED === 'false') {
    console.warn('ELASTICSEARCH_ENABLED is explicitly set to false. Aborting sync.');
    process.exit(0);
  }
  
  // Initialize client if not already (service constructor does this, but let's ensure)
  if (!elasticsearchService.client) {
      console.error('Elasticsearch client not initialized. Check ELASTICSEARCH_NODE in .env');
      process.exit(1);
  }

  const connection = await elasticsearchService.testConnection();
  if (!connection.connected) {
    console.error('Failed to connect to Elasticsearch:', connection.error);
    process.exit(1);
  }

  try {
    // 3. Create Index (if not exists)
    console.log('Creating/Verifying index...');
    await elasticsearchService.createIndex();

    // 4. Index All Products
    console.log('Indexing products...');
    const count = await elasticsearchService.indexAllProducts();
    
    console.log(`Successfully synced ${count} products to Elasticsearch.`);
  } catch (error) {
    console.error('Sync failed:', error);
  } finally {
    await mongoose.disconnect();
    process.exit();
  }
};

syncElasticsearch();
