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

// Test Elasticsearch integration
const testElasticsearch = async () => {
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
    
    // Test creating index
    await elasticsearchService.createIndex();
    console.log('✅ Products index created/verified');
    
    // Test searching products
    const searchResults = await elasticsearchService.searchProducts({ q: 'test' });
    console.log('✅ Product search works');
    console.log(`Found ${searchResults.pagination.total} products`);
    
    // Test getting suggestions
    const suggestions = await elasticsearchService.getSearchSuggestions('test', 5);
    console.log('✅ Search suggestions work');
    console.log(`Found ${suggestions.length} suggestions`);
    
    // Test logging search query
    await elasticsearchService.logSearchQuery('test query', 'test-user');
    console.log('✅ Search analytics logging works');
    
    // Test getting analytics
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    const endDate = new Date();
    const analytics = await elasticsearchService.getSearchAnalytics(startDate, endDate);
    console.log('✅ Search analytics retrieval works');
    
    console.log('\n🎉 All Elasticsearch integration tests passed!');
    
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error testing Elasticsearch integration:', error);
    process.exit(1);
  }
};

// Run the tests
testElasticsearch();