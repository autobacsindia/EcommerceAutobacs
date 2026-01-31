
import mongoose from 'mongoose';
import Order from './models/Order.js';

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/autobacs')
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.log(err));

async function debugOrder() {
  try {
    const orderId = '697b267bc9d650f1f14b171a';
    console.log(`Fetching order: ${orderId}`);
    
    const order = await Order.findById(orderId).lean(); // use lean() to get plain JS object
    
    if (!order) {
      console.log('Order not found');
      return;
    }

    console.log('--- Order Debug Info ---');
    console.log(`Status: '${order.status}'`);
    console.log(`DeliveredAt: ${order.deliveredAt} (Type: ${typeof order.deliveredAt})`);
    console.log(`ReturnRequest:`, order.returnRequest);
    console.log(`Has ReturnRequest Key:`, 'returnRequest' in order);
    
    // Simulate Frontend Logic
    const canReturnOrder = (status, deliveredAt) => {
      console.log(`Checking canReturnOrder: status=${status}, deliveredAt=${deliveredAt}`);
      if (status.toLowerCase() !== 'delivered') {
        console.log('Fail: Status not delivered');
        return false;
      }
      if (!deliveredAt) {
        console.log('Fail: No deliveredAt');
        return false;
      }
      
      const now = new Date();
      const deliveryDate = new Date(deliveredAt);
      const daysSinceDelivery = (now.getTime() - deliveryDate.getTime()) / (1000 * 60 * 60 * 24);
      console.log(`Days since delivery: ${daysSinceDelivery}`);
      
      return daysSinceDelivery <= 7;
    };

    const isReturnable = canReturnOrder(order.status, order.deliveredAt);
    const hasNoReturnRequest = !order.returnRequest;
    
    console.log('--- Frontend Logic Check ---');
    console.log(`canReturnOrder: ${isReturnable}`);
    console.log(`!order.returnRequest: ${hasNoReturnRequest}`);
    console.log(`Should Show Button: ${isReturnable && hasNoReturnRequest}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    mongoose.disconnect();
  }
}

debugOrder();
