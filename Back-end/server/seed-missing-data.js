import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Vehicle from './models/Vehicle.js';
import Category from './models/Category.js';
import Brand from './models/Brand.js';

dotenv.config();

const missingVehicles = [
  {
    name: 'Isuzu D-Max',
    slug: 'isuzu-dmax',
    make: 'Isuzu',
    type: 'Pickup Truck',
    active: true
  },
  {
    name: 'Kia Carens',
    slug: 'kia-carens',
    make: 'Kia',
    type: 'MPV',
    active: true
  },
  {
    name: 'Kia Seltos',
    slug: 'kia-seltos',
    make: 'Kia',
    type: 'SUV',
    active: true
  },
  {
    name: 'Hyundai Creta',
    slug: 'hyundai-creta',
    make: 'Hyundai',
    type: 'SUV',
    active: true
  },
  {
    name: 'Hyundai Verna',
    slug: 'hyundai-verna',
    make: 'Hyundai',
    type: 'Sedan',
    active: true
  },
  {
    name: 'Hyundai Tucson',
    slug: 'hyundai-tucson',
    make: 'Hyundai',
    type: 'SUV',
    active: true
  }
];

const missingCategories = [
  {
    name: 'Lights',
    slug: 'lights',
    description: 'Headlights, taillights, fog lights, and auxiliary lighting systems',
    active: true,
    parentCategory: null
  },
  {
    name: 'Suspension',
    slug: 'suspension',
    description: 'Shock absorbers, struts, coilovers, and suspension components',
    active: true,
    parentCategory: null
  },
  {
    name: 'Performance',
    slug: 'performance',
    description: 'Performance parts including turbochargers, intercoolers, and engine tuning',
    active: true,
    parentCategory: null
  },
  {
    name: 'Audio',
    slug: 'audio',
    description: 'Car audio systems, speakers, subwoofers, amplifiers, and head units',
    active: true,
    parentCategory: null
  },
  {
    name: 'Interior',
    slug: 'interior',
    description: 'Interior accessories including seat covers, floor mats, and trim pieces',
    active: true,
    parentCategory: null
  },
  {
    name: 'Exterior Accessories',
    slug: 'exterior-accessories',
    description: 'Exterior parts including body kits, spoilers, and exterior trim',
    active: true,
    parentCategory: null
  }
];

async function seedMissingData() {
  try {
    console.log('🌱 Starting data seeding...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4
    });
    console.log('✅ Connected to MongoDB');

    // Import missing vehicles
    console.log('\n🚗 Importing vehicles...');
    let vehicleCount = 0;
    for (const vehicle of missingVehicles) {
      const existing = await Vehicle.findOne({ slug: vehicle.slug });
      if (!existing) {
        await Vehicle.create(vehicle);
        console.log(`   ✅ Created: ${vehicle.name} (${vehicle.slug})`);
        vehicleCount++;
      } else {
        console.log(`   ⏭️  Skipped (exists): ${vehicle.name}`);
      }
    }
    console.log(`\n   📊 Vehicles created: ${vehicleCount}/${missingVehicles.length}`);

    // Import missing categories
    console.log('\n📦 Importing categories...');
    let categoryCount = 0;
    for (const category of missingCategories) {
      const existing = await Category.findOne({ slug: category.slug });
      if (!existing) {
        await Category.create(category);
        console.log(`   ✅ Created: ${category.name} (${category.slug})`);
        categoryCount++;
      } else {
        console.log(`   ⏭️  Skipped (exists): ${category.name}`);
      }
    }
    console.log(`\n   📊 Categories created: ${categoryCount}/${missingCategories.length}`);

    // Check Profender brand
    console.log('\n🏷️  Checking Profender brand...');
    const profender = await Brand.findOne({ 
      $or: [
        { name: /profender/i },
        { slug: 'profender' }
      ]
    });
    
    if (profender) {
      console.log(`   ✅ Profender brand exists: ${profender.name}`);
      console.log(`      ID: ${profender._id}`);
    } else {
      const newBrand = await Brand.create({
        name: 'Profender',
        slug: 'profender',
        logo: '',
        description: 'Profender suspension systems - Premium quality automotive suspension',
        active: true
      });
      console.log('   ✅ Created: Profender brand');
      console.log(`      ID: ${newBrand._id}`);
    }

    // Summary
    console.log('\n✨ ====================================');
    console.log('✨ Seeding complete!');
    console.log('✨ ====================================');
    console.log(`\n📈 Summary:`);
    console.log(`   Vehicles created: ${vehicleCount}`);
    console.log(`   Categories created: ${categoryCount}`);
    console.log(`   Brands checked: 1`);
    console.log(`\n🎯 Next steps:`);
    console.log(`   1. Add products to these categories`);
    console.log(`   2. Upload vehicle images`);
    console.log(`   3. Test frontend pages\n`);
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Error during seeding:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

seedMissingData();
