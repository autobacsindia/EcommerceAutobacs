
import mongoose from 'mongoose';
import Order from './models/Order.js';

const MONGO_URI = 'mongodb://localhost:27017/autobacs';

async function fixOrder() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected.');

    // ID found in the debug check
    const orderId = '697dd73dd39a2630dd1873f0';
    console.log(`Fixing order: ${orderId}`);

    // Unset the returnRequest field completely
    const result = await Order.updateOne(
      { _id: orderId },
      { $unset: { returnRequest: "" } }
    );

    console.log('Update result:', result);

    // Verify with lean() to see raw DB state
    const order = await Order.findById(orderId).lean();
    console.log('Updated ReturnRequest (lean):', order.returnRequest);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

fixOrder();
