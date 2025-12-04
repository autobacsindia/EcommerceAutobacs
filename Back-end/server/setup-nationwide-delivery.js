import mongoose from 'mongoose';
import DeliveryZone from './models/DeliveryZone.js';
import dotenv from 'dotenv';

dotenv.config();

async function setupNationwideDelivery() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB\n');

    // Step 1: Remove all existing sample zones
    console.log('Step 1: Removing existing sample delivery zones...');
    const deleteResult = await DeliveryZone.deleteMany({});
    console.log(`✓ Removed ${deleteResult.deletedCount} existing delivery zones\n`);

    // Step 2: Create comprehensive India-wide delivery zones
    console.log('Step 2: Creating India-wide delivery zones...\n');

    const zones = [
      {
        name: 'Metro Cities',
        code: 'METRO',
        type: 'metro',
        cities: ['Delhi', 'Mumbai', 'Bangalore', 'Kolkata', 'Chennai', 'Hyderabad', 'Pune', 'Ahmedabad'],
        states: ['Delhi', 'Maharashtra', 'Karnataka', 'West Bengal', 'Tamil Nadu', 'Telangana', 'Gujarat'],
        pinCodes: [], // Will accept all PIN codes via Google Maps
        deliveryTime: {
          minDays: 2,
          maxDays: 4
        },
        shippingCost: {
          baseCost: 50,
          perKm: 1.5
        },
        isServiceable: true,
        priority: 1
      },
      {
        name: 'Tier 1 Cities',
        code: 'TIER1',
        type: 'tier1',
        cities: ['Kochi', 'Jaipur', 'Lucknow', 'Chandigarh', 'Nagpur', 'Indore', 'Coimbatore', 'Visakhapatnam'],
        states: ['Kerala', 'Rajasthan', 'Uttar Pradesh', 'Punjab', 'Madhya Pradesh', 'Andhra Pradesh'],
        pinCodes: [], // Will accept all PIN codes via Google Maps
        deliveryTime: {
          minDays: 3,
          maxDays: 5
        },
        shippingCost: {
          baseCost: 60,
          perKm: 2
        },
        isServiceable: true,
        priority: 2
      },
      {
        name: 'Tier 2 Cities & Towns',
        code: 'TIER2',
        type: 'tier2',
        cities: ['All other cities and towns'],
        states: ['All States'],
        pinCodes: [], // Will accept all PIN codes via Google Maps
        deliveryTime: {
          minDays: 4,
          maxDays: 7
        },
        shippingCost: {
          baseCost: 80,
          perKm: 2.5
        },
        isServiceable: true,
        priority: 3
      },
      {
        name: 'Remote Areas',
        code: 'REMOTE',
        type: 'remote',
        cities: ['Remote and rural areas'],
        states: ['All States'],
        pinCodes: [], // Will accept all PIN codes via Google Maps
        deliveryTime: {
          minDays: 5,
          maxDays: 10
        },
        shippingCost: {
          baseCost: 100,
          perKm: 3
        },
        isServiceable: true,
        priority: 4
      }
    ];

    // Create all zones
    const createdZones = await DeliveryZone.insertMany(zones);
    console.log(`✓ Created ${createdZones.length} delivery zones:\n`);
    
    createdZones.forEach(zone => {
      console.log(`  📦 ${zone.name}`);
      console.log(`     - Type: ${zone.type}`);
      console.log(`     - Delivery: ${zone.deliveryTime.minDays}-${zone.deliveryTime.maxDays} days`);
      console.log(`     - Shipping: ₹${zone.shippingCost.baseCost} base + ₹${zone.shippingCost.perKm}/km`);
      console.log(`     - Priority: ${zone.priority}\n`);
    });

    console.log('✅ SUCCESS! India-wide delivery is now enabled!\n');
    console.log('📍 How it works:');
    console.log('   - Google Maps will detect any location in India');
    console.log('   - System will auto-assign the appropriate delivery zone');
    console.log('   - Customers can order from anywhere in India!\n');
    console.log('💡 Zone assignment logic:');
    console.log('   - Metro cities: 2-4 days, ₹50 base');
    console.log('   - Tier 1 cities: 3-5 days, ₹60 base');
    console.log('   - Tier 2 cities: 4-7 days, ₹80 base');
    console.log('   - Remote areas: 5-10 days, ₹100 base\n');

  } catch (error) {
    console.error('✗ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

setupNationwideDelivery();
