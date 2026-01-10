/**
 * Seed initial brands into the database
 * Run with: node seed-brands.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Brand from './models/Brand.js';

dotenv.config();

const brands = [
  {
    name: 'Profender',
    slug: 'profender',
    description: 'Premium automotive suspension and shock absorber specialist',
    isActive: true
  },
  {
    name: 'Bushranger',
    slug: 'bushranger',
    description: 'High-quality automotive protection and outdoor adventure accessories',
    isActive: true
  },
  {
    name: 'Ironman',
    slug: 'ironman',
    description: 'Performance suspension and 4x4 accessories for off-road enthusiasts',
    isActive: true
  },
  {
    name: 'Dr. Nano',
    slug: 'dr-nano',
    description: 'Advanced automotive care and nano-coating protection products',
    isActive: true
  },
  {
    name: 'Lightforce',
    slug: 'lightforce',
    description: 'High-performance LED and HID lighting solutions for vehicles',
    isActive: true
  },
  {
    name: 'Option',
    slug: 'option',
    description: 'Custom automotive accessories and styling products',
    isActive: true
  }
];

async function seedBrands() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/autobacs';
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB');

    // Seed each brand
    for (const brandData of brands) {
      try {
        // Check if brand already exists
        const existingBrand = await Brand.findOne({ 
          $or: [
            { slug: brandData.slug },
            { name: { $regex: new RegExp(`^${brandData.name}$`, 'i') } }
          ]
        });

        if (existingBrand) {
          console.log(`⚠ Brand "${brandData.name}" already exists, updating...`);
          existingBrand.description = brandData.description;
          existingBrand.isActive = brandData.isActive;
          await existingBrand.save();
          console.log(`  ✓ Updated "${brandData.name}"`);
        } else {
          const brand = await Brand.create(brandData);
          console.log(`✓ Created brand: ${brand.name} (${brand.slug})`);
        }
      } catch (err) {
        console.error(`✗ Failed to create/update brand "${brandData.name}":`, err.message);
      }
    }

    console.log('\n✓ Brand seeding completed!');
    
    // List all brands
    const allBrands = await Brand.find({});
    console.log(`\nTotal brands in database: ${allBrands.length}`);
    allBrands.forEach(b => {
      console.log(`  - ${b.name} (${b.slug}) - ${b.isActive ? 'Active' : 'Inactive'}`);
    });

  } catch (error) {
    console.error('✗ Error:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('\n✓ Database connection closed');
  }
}

seedBrands();
