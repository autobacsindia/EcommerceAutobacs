import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';
import categoryMappingService from './services/categoryMappingService.js';

// Load environment variables
dotenv.config();

async function testStepneyImport() {
  try {
    console.log('🚀 Testing Stepney Cover category import...');
    
    // Connect to database
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    // Initialize category mapping service
    await categoryMappingService.initialize();
    
    // Test finding the Stepney Cover category
    console.log('\n🔍 Looking for "Stepney Cover" category...');
    const stepneyCategory = categoryMappingService.findCategory('Stepney Cover');
    
    if (stepneyCategory) {
      console.log(`✅ Found existing category: ${stepneyCategory.name} (ID: ${stepneyCategory._id})`);
    } else {
      console.log('⚠️  Stepney Cover category not found, creating it...');
      const newCategory = await categoryMappingService.createCategory('Stepney Cover');
      console.log(`➕ Created new category: ${newCategory.name} (ID: ${newCategory._id})`);
    }
    
    // Test finding the Exterior category
    console.log('\n🔍 Looking for "Exterior" category...');
    const exteriorCategory = categoryMappingService.findCategory('Exterior');
    
    if (exteriorCategory) {
      console.log(`✅ Found existing category: ${exteriorCategory.name} (ID: ${exteriorCategory._id})`);
    } else {
      console.log('❌ Exterior category not found!');
    }
    
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
    console.log('✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testStepneyImport();