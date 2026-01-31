
import mongoose from 'mongoose';
import Order from './models/Order.js';

const MONGO_URI = 'mongodb://localhost:27017/autobacs';

async function checkOrder() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected.');

    const orderId = '697b267bc9d650f1f14b171a';
    console.log(`\nChecking specific order: ${orderId}`);

    const order = await Order.findById(orderId);

    console.log('\n--- Listing Last 5 Orders ---');
    const orders = await Order.find().sort({ createdAt: -1 }).limit(5);
    orders.forEach(o => {
        console.log(`ID: ${o._id} | Status: ${o.status} | CreatedAt: ${o.createdAt}`);
    });

    console.log('\n--- Searching for ANY delivered order ---');
    const deliveredOrder = await Order.findOne({ status: 'delivered' }).sort({ updatedAt: -1 });
    if (deliveredOrder) {
        console.log('Found a delivered order:');
        logOrderDetails(deliveredOrder);
    } else {
        console.log('No delivered orders found in the database.');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected.');
  }
}

function logOrderDetails(order) {
    console.log(`ID: ${order._id}`);
    console.log(`Status: ${order.status}`);
    console.log(`DeliveredAt: ${order.deliveredAt}`);
    console.log(`FulfillmentMetrics:`, order.fulfillmentMetrics);
    console.log(`ReturnRequest:`, order.returnRequest);

    // Validate Logic
    const isDelivered = order.status.toLowerCase() === 'delivered';
    const deliveredDate = order.deliveredAt || (order.fulfillmentMetrics && order.fulfillmentMetrics.deliveredAt);
    
    let isWithin7Days = false;
    let daysDiff = -1;

    if (deliveredDate) {
        const now = new Date();
        const delivered = new Date(deliveredDate);
        const diffTime = Math.abs(now - delivered);
        daysDiff = diffTime / (1000 * 60 * 60 * 24);
        isWithin7Days = daysDiff <= 7;
    }

    const hasReturnRequest = !!(order.returnRequest && order.returnRequest.status);

    console.log('--- Eligibility Check ---');
    console.log(`Is Delivered: ${isDelivered}`);
    console.log(`Has Delivered Date: ${!!deliveredDate} (${deliveredDate})`);
    console.log(`Days Since Delivery: ${daysDiff.toFixed(2)}`);
    console.log(`Is Within 7 Days: ${isWithin7Days}`);
    console.log(`Has Return Request: ${hasReturnRequest}`);
    console.log(`SHOULD SHOW BUTTON: ${isDelivered && !!deliveredDate && isWithin7Days && !hasReturnRequest}`);
}

checkOrder();
