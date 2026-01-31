
import mongoose from 'mongoose';
import Order from './models/Order.js';
import ReturnRequest from './models/ReturnRequest.js';

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/autobacs')
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.log(err));

async function deleteAllOrders() {
  try {
    console.log('Starting deletion process...');

    // Delete Return Requests first (child dependency usually)
    const returnsResult = await ReturnRequest.deleteMany({});
    console.log(`Deleted ${returnsResult.deletedCount} Return Requests.`);

    // Delete Orders
    const ordersResult = await Order.deleteMany({});
    console.log(`Deleted ${ordersResult.deletedCount} Orders.`);

    console.log('All orders and return requests have been removed.');

  } catch (error) {
    console.error('Error deleting orders:', error);
  } finally {
    mongoose.disconnect();
  }
}

deleteAllOrders();
