
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from server root (.env is one level up from scripts/)
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/autobacs';

const run = async () => {
  try {
    console.log(`Connecting to MongoDB: ${MONGO_URI.replace(/:([^:@]+)@/, ':****@')}...`);
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    // Define schema inline to avoid importing models that might have other dependencies
    // We only need to delete based on images/createdAt
    const productSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
    const Product = mongoose.models.Product || mongoose.model('Product', productSchema);

    // Find products with no images or empty images array
    const query = {
      $or: [
        { images: { $size: 0 } },
        { images: { $exists: false } },
        { images: null }
      ]
    };

    // Find first to log what we are deleting
    const products = await Product.find(query)
      .sort({ createdAt: -1 })
      .limit(15);

    if (products.length === 0) {
      console.log('No dummy products found (products without images).');
      await mongoose.disconnect();
      process.exit(0);
    }

    console.log(`Found ${products.length} dummy products to remove:`);
    products.forEach(p => {
      console.log(`- ID: ${p._id}, Name: ${p.name || 'Unknown'}, Created: ${p.createdAt}`);
    });

    // Delete them
    const ids = products.map(p => p._id);
    const result = await Product.deleteMany({ _id: { $in: ids } });

    console.log(`Successfully removed ${result.deletedCount} products.`);
    
    await mongoose.disconnect();
    process.exit(0);

  } catch (error) {
    console.error('Error removing products:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
};

run();
