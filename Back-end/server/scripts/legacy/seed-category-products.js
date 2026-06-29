import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../../models/Product.js';
import Category from '../../models/Category.js';

dotenv.config();

async function seedProductsToCategories() {
  try {
    console.log('🌱 Starting product seeding for categories...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4
    });
    console.log('✅ Connected to MongoDB');

    // Get the Lights and Audio categories
    const lightsCategory = await Category.findOne({ slug: 'lights' });
    const audioCategory = await Category.findOne({ slug: 'audio' });

    if (!lightsCategory) {
      console.log('❌ Lights category not found!');
      process.exit(1);
    }

    if (!audioCategory) {
      console.log('❌ Audio category not found!');
      process.exit(1);
    }

    console.log(`\n📦 Found categories:`);
    console.log(`   Lights: ${lightsCategory._id}`);
    console.log(`   Audio: ${audioCategory._id}`);

    // Sample products for Lights category
    const lightsProducts = [
      {
        name: 'LED Headlight Bulbs H4',
        slug: 'led-headlight-bulbs-h4',
        description: 'High-quality LED headlight bulbs with superior brightness',
        price: 2999,
        mrp: 4999,
        discount: 40,
        sku: 'LIGHT-LED-H4-001',
        stock: 50,
        category: lightsCategory._id,
        images: [{ 
          url: 'https://via.placeholder.com/400x400/2563eb/ffffff?text=LED+Headlight',
          alt: 'LED Headlight Bulbs',
          position: 1
        }],
        brand: null,
        active: true,
        featured: false,
        specifications: {
          wattage: '60W',
          lumens: '8000LM',
          colorTemperature: '6000K'
        }
      },
      {
        name: 'Fog Light Kit Universal',
        slug: 'fog-light-kit-universal',
        description: 'Universal fog light kit with wiring harness',
        price: 1899,
        mrp: 2999,
        discount: 37,
        sku: 'LIGHT-FOG-UNI-002',
        stock: 30,
        category: lightsCategory._id,
        images: [{ 
          url: 'https://via.placeholder.com/400x400/dc2626/ffffff?text=Fog+Light',
          alt: 'Fog Light Kit',
          position: 1
        }],
        brand: null,
        active: true,
        featured: false,
        specifications: {
          voltage: '12V',
          wattage: '55W',
          bulbType: 'H3'
        }
      },
      {
        name: 'LED Tail Lights Red',
        slug: 'led-tail-lights-red',
        description: 'Premium LED tail lights for enhanced visibility',
        price: 3499,
        mrp: 5499,
        discount: 36,
        sku: 'LIGHT-TAIL-RED-003',
        stock: 25,
        category: lightsCategory._id,
        images: [{ 
          url: 'https://via.placeholder.com/400x400/ef4444/ffffff?text=Tail+Lights',
          alt: 'LED Tail Lights',
          position: 1
        }],
        brand: null,
        active: true,
        featured: true,
        specifications: {
          type: 'LED',
          color: 'Red',
          position: 'Rear'
        }
      }
    ];

    // Sample products for Audio category
    const audioProducts = [
      {
        name: 'Car Stereo Double DIN',
        slug: 'car-stereo-double-din',
        description: 'Android-based car stereo with touchscreen',
        price: 8999,
        mrp: 14999,
        discount: 40,
        sku: 'AUDIO-STEREO-DIN-001',
        stock: 15,
        category: audioCategory._id,
        images: [{ 
          url: 'https://via.placeholder.com/400x400/7c3aed/ffffff?text=Car+Stereo',
          alt: 'Car Stereo',
          position: 1
        }],
        brand: null,
        active: true,
        featured: true,
        specifications: {
          screen: '7 inch',
          os: 'Android 10',
          bluetooth: 'Yes'
        }
      },
      {
        name: 'Component Speakers 6.5"',
        slug: 'component-speakers-6-5',
        description: 'High-fidelity component speaker system',
        price: 5999,
        mrp: 9999,
        discount: 40,
        sku: 'AUDIO-SPEAK-COMP-002',
        stock: 20,
        category: audioCategory._id,
        images: [{ 
          url: 'https://via.placeholder.com/400x400/059669/ffffff?text=Speakers',
          alt: 'Component Speakers',
          position: 1
        }],
        brand: null,
        active: true,
        featured: false,
        specifications: {
          size: '6.5 inch',
          power: '80W RMS',
          impedance: '4 Ohm'
        }
      },
      {
        name: 'Subwoofer 10" Powered',
        slug: 'subwoofer-10-powered',
        description: 'Powered subwoofer with built-in amplifier',
        price: 12999,
        mrp: 19999,
        discount: 35,
        sku: 'AUDIO-SUB-10-003',
        stock: 10,
        category: audioCategory._id,
        images: [{ 
          url: 'https://via.placeholder.com/400x400/db2777/ffffff?text=Subwoofer',
          alt: 'Subwoofer',
          position: 1
        }],
        brand: null,
        active: true,
        featured: true,
        specifications: {
          size: '10 inch',
          power: '300W',
          type: 'Powered'
        }
      },
      {
        name: 'Car Amplifier 4 Channel',
        slug: 'car-amplifier-4-channel',
        description: 'Class AB 4-channel amplifier for speakers',
        price: 7499,
        mrp: 11999,
        discount: 38,
        sku: 'AUDIO-AMP-4CH-004',
        stock: 12,
        category: audioCategory._id,
        images: [{ 
          url: 'https://via.placeholder.com/400x400/ea580c/ffffff?text=Amplifier',
          alt: 'Car Amplifier',
          position: 1
        }],
        brand: null,
        active: true,
        featured: false,
        specifications: {
          channels: '4',
          power: '80W x 4',
          class: 'AB'
        }
      }
    ];

    // Import Lights products
    console.log('\n💡 Adding products to Lights category...');
    let lightsCount = 0;
    for (const productData of lightsProducts) {
      const existing = await Product.findOne({ slug: productData.slug });
      if (!existing) {
        await Product.create(productData);
        console.log(`   ✅ Created: ${productData.name}`);
        lightsCount++;
      } else {
        console.log(`   ⏭️  Skipped (exists): ${productData.name}`);
      }
    }
    console.log(`   📊 Lights products added: ${lightsCount}/${lightsProducts.length}`);

    // Import Audio products
    console.log('\n🔊 Adding products to Audio category...');
    let audioCount = 0;
    for (const productData of audioProducts) {
      const existing = await Product.findOne({ slug: productData.slug });
      if (!existing) {
        await Product.create(productData);
        console.log(`   ✅ Created: ${productData.name}`);
        audioCount++;
      } else {
        console.log(`   ⏭️  Skipped (exists): ${productData.name}`);
      }
    }
    console.log(`   📊 Audio products added: ${audioCount}/${audioProducts.length}`);

    // Summary
    console.log('\n✨ ====================================');
    console.log('✨ Product seeding complete!');
    console.log('✨ ====================================');
    console.log(`\n📈 Summary:`);
    console.log(`   Lights products: ${lightsCount}`);
    console.log(`   Audio products: ${audioCount}`);
    console.log(`   Total products: ${lightsCount + audioCount}`);
    console.log(`\n🎯 Test URLs:`);
    console.log(`   http://localhost:3000/categories/lights`);
    console.log(`   http://localhost:3000/categories/audio\n`);
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Error during seeding:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

seedProductsToCategories();
