import elasticsearchService from './services/elasticsearchService.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

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

// Reindex all products
const reindexProducts = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    
    // Check if Elasticsearch is connected
    const isConnected = await elasticsearchService.isConnected();
    if (!isConnected) {
      console.log('❌ Elasticsearch is not connected');
      console.log('Please make sure Elasticsearch is running and accessible');
      process.exit(1);
    }
    
    console.log('✅ Elasticsearch is connected');
    
    // Index all products
    const count = await elasticsearchService.indexAllProducts();
    console.log(`✅ Indexed ${count} products`);
    
    console.log('\n🎉 Reindexing completed successfully!');
    
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error reindexing products:', error);
    process.exit(1);
  }
};

// Run the reindexing
reindexProducts();