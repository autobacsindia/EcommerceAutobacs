/**
 * Update brands with logo URLs
 * Run with: node update-brand-logos.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Brand from './models/Brand.js';

dotenv.config();

const brandLogos = [
  {
    slug: 'profender',
    logo: 'https://autobacsindia.com/wp-content/uploads/2024/10/profender-logo-1.png.webp'
  },
  {
    slug: 'bushranger',
    logo: 'https://autobacsindia.com/wp-content/uploads/2024/10/bushranger.png.webp'
  },
  {
    slug: 'ironman',
    logo: 'https://autobacsindia.com/wp-content/uploads/2024/10/ironman.png.webp'
  },
  {
    slug: 'dr-nano',
    logo: 'https://autobacsindia.com/wp-content/uploads/2024/10/dr-nano-logo-1.png.webp'
  },
  {
    slug: 'lightforce',
    logo: 'https://autobacsindia.com/wp-content/uploads/2024/10/lightforce-logo-1.png.webp'
  },
  {
    slug: 'option',
    logo: 'https://autobacsindia.com/wp-content/uploads/2024/10/option-logo-1.png.webp'
  }
];

async function updateBrandLogos() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/autobacs';
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB\n');

    for (const { slug, logo } of brandLogos) {
      const brand = await Brand.findOne({ slug });
      
      if (brand) {
        brand.logo = logo;
        await brand.save();
        console.log(`✓ Updated logo for ${brand.name}`);
      } else {
        console.log(`⚠ Brand with slug "${slug}" not found`);
      }
    }

    console.log('\n✓ Brand logos updated successfully!');
    
    // Show updated brands
    const allBrands = await Brand.find({});
    console.log('\nUpdated brands:');
    allBrands.forEach(b => {
      console.log(`  - ${b.name}: ${b.logo ? '✓ Has logo' : '✗ No logo'}`);
    });

  } catch (error) {
    console.error('✗ Error:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('\n✓ Database connection closed');
  }
}

updateBrandLogos();
