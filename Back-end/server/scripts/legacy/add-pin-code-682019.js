import mongoose from 'mongoose';
import DeliveryZone from '../../models/DeliveryZone.js';
import dotenv from 'dotenv';

dotenv.config();

async function addPinCodeToZone() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB');

    // Check if PIN code 682019 already exists in any zone
    const existingZone = await DeliveryZone.findByPinCode('682019');
    
    if (existingZone) {
      console.log(`✓ PIN code 682019 already exists in zone: ${existingZone.name}`);
      process.exit(0);
    }

    // Add PIN code to Kerala/South India zone or create new zone
    let zone = await DeliveryZone.findOne({ name: /south|kerala/i });
    
    if (!zone) {
      // Create a new South India zone
      console.log('Creating new South India delivery zone...');
      zone = new DeliveryZone({
        name: 'South India Zone',
        code: 'SOUTH-INDIA',
        type: 'tier1',
        cities: ['Kochi', 'Ernakulam'],
        states: ['Kerala'],
        pinCodes: ['682019'],
        deliveryTime: {
          minDays: 3,
          maxDays: 5
        },
        shippingCost: {
          baseCost: 50,
          perKm: 2
        },
        isServiceable: true,
        priority: 3
      });
      
      await zone.save();
      console.log('✓ Created new South India zone with PIN code 682019');
    } else {
      // Add to existing zone
      await DeliveryZone.bulkAddPinCodes(zone._id, ['682019']);
      console.log(`✓ Added PIN code 682019 to zone: ${zone.name}`);
    }

    console.log('\n✅ PIN code 682019 is now serviceable!');
    console.log(`Zone: ${zone.name}`);
    console.log(`Delivery Time: ${zone.deliveryTime.minDays}-${zone.deliveryTime.maxDays} days`);
    console.log(`Shipping Cost: ₹${zone.shippingCost.baseCost} base + ₹${zone.shippingCost.perKm}/km`);

  } catch (error) {
    console.error('✗ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

addPinCodeToZone();
