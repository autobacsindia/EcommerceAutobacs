import elasticsearchService from './services/elasticsearchService.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from './models/Product.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

// Initialize Elasticsearch and index all products
const initElasticsearch = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    
    // Check if Elasticsearch is connected
    const isConnected = await elasticsearchService.isConnected();
    if (!isConnected) {
      console.error('Elasticsearch is not connected. Please make sure Elasticsearch is running.');
      process.exit(1);
    }
    
    console.log('Elasticsearch is connected');
    
    // Create the products index
    await elasticsearchService.createIndex();
    console.log('Products index created');
    
    // Index all products
    const count = await elasticsearchService.indexAllProducts();
    console.log(`Indexed ${count} products`);
    
    console.log('Elasticsearch setup completed successfully');
    
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
    
    process.exit(0);
  } catch (error) {
    console.error('Error initializing Elasticsearch:', error);
    process.exit(1);
  }
};

// Run the initialization
initElasticsearch();