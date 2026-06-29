import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { removeHtmlTags } from '../../utils/htmlSanitizer.js';
import { categorizeProduct } from '../../utils/productCategorizer.js';

// Load environment variables
dotenv.config();

// Sample WordPress products with HTML in descriptions
const sampleWordPressProducts = [
  {
    _id: '1',
    name: 'Turbo Charger Pro',
    description: '<p>High performance <strong>turbo charger</strong> for enhanced <em>engine power</em>. Features:</p><ul><li>Increased horsepower</li><li>Better fuel efficiency</li><li>Easy installation</li></ul><p>Perfect for performance enthusiasts!</p>',
    shortDescription: 'Performance turbo charger',
    tags: ['engine', 'boost', 'performance']
  },
  {
    _id: '2',
    name: 'LED Headlight Kit',
    description: '<div>Bright <span style="color:blue">LED headlights</span> with <strong>premium illumination</strong>.</div><br/><p>Features:<br/>- 6000K cool white light<br/>- Easy plug and play installation<br/>- Long lasting bulbs</p>',
    shortDescription: 'Bright LED headlights',
    tags: ['lighting', 'headlights']
  },
  {
    _id: '3',
    name: 'Car Audio Subwoofer',
    description: '<h3>Premium Sound Subwoofer</h3><p>Deep bass <em>subwoofer</em> for your car audio system.</p><script>alert("This should be removed!");</script><p>Specifications:</p><ol><li>10 inch woofer</li><li>500W peak power</li><li>Low distortion</li></ol>',
    shortDescription: 'Car audio subwoofer',
    tags: ['audio', 'sound', 'bass']
  },
  {
    _id: '4',
    name: 'Steering Wheel Cover',
    description: '<p>Leather <strong>steering wheel cover</strong> for comfort and grip.</p><p>Available in multiple colors:<br/>- Black<br/>- Red<br/>- Blue</p>',
    shortDescription: 'Leather steering wheel cover',
    tags: ['interior', 'accessories']
  },
  {
    _id: '5',
    name: 'Coilover Suspension Kit',
    description: '<div>Adjustable <em>coilover suspension</em> for improved handling.</div><p>Key features:</p><ul><li>Height adjustable</li><li>Rebound damping control</li><li>Forged aluminum components</li></ul>',
    shortDescription: 'Adjustable coilover suspension',
    tags: ['suspension', 'handling']
  }
];

async function testWordPressCleanup() {
  try {
    console.log('Testing WordPress Product Cleanup...\n');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });
    
    console.log('✓ Connected to MongoDB\n');
    
    // Test HTML sanitization
    console.log('=== HTML SANITIZATION TEST ===');
    for (const product of sampleWordPressProducts) {
      console.log(`Product: ${product.name}`);
      console.log('Original description:');
      console.log(product.description);
      console.log('\nCleaned description:');
      console.log(removeHtmlTags(product.description));
      console.log('---');
    }
    
    console.log('\n=== PRODUCT CATEGORIZATION TEST ===');
    for (const product of sampleWordPressProducts) {
      console.log(`Product: ${product.name}`);
      const categoryId = await categorizeProduct(product);
      
      if (categoryId) {
        // Get the actual category name
        const Category = mongoose.model('Category');
        const category = await Category.findById(categoryId);
        console.log(`Assigned Category: ${category ? category.name : 'Unknown'}`);
      } else {
        console.log('Assigned Category: Uncategorized');
      }
      
      console.log('---');
    }
    
    // Close connection
    await mongoose.connection.close();
    console.log('\n✓ Disconnected from MongoDB');
    
  } catch (error) {
    console.error('Error during testing:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  }
}

// Run the test
testWordPressCleanup();