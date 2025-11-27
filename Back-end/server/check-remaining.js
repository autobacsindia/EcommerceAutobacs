import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';

// Load environment variables
dotenv.config();

async function checkRemaining() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const count = await Product.countDocuments({ 
      description: { $regex: /<[^>]*>/ } 
    });
    console.log('Products with HTML tags remaining:', count);
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkRemaining();