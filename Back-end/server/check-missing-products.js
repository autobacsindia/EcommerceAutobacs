import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import Product from './models/Product.js';

console.log('Script started');
dotenv.config();
console.log('Env loaded');

async function checkMissingProducts() {
  try {
    console.log('Connecting to DB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const wpProductsPath = path.join(process.cwd(), 'complete-wp-data.json');
    console.log('Reading JSON file:', wpProductsPath);
    const wpData = JSON.parse(fs.readFileSync(wpProductsPath, 'utf8'));
    const wpProducts = wpData.products;
    console.log(`Total products in JSON file: ${wpProducts.length}`);

    const dbProducts = await Product.find({}, 'name');
    const dbProductNames = new Set(dbProducts.map(p => p.name.trim().toLowerCase()));
    console.log(`Total products in DB: ${dbProducts.length}`);

    const missingProducts = wpProducts.filter(p => {
        const name = p.name ? p.name.trim().toLowerCase() : '';
        return name && !dbProductNames.has(name);
    });

    console.log(`Missing products count: ${missingProducts.length}`);
    
    if (missingProducts.length > 0) {
        console.log('First 5 missing products:');
        missingProducts.slice(0, 5).forEach(p => console.log(`- ${p.name}`));
    }

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
    if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
    }
  }
}

checkMissingProducts();
