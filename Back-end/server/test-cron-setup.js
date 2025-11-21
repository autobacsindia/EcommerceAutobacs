import dotenv from 'dotenv';
import mongoose from 'mongoose';
import CronService from './services/cronService.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

// Test the cron service
const testCronService = async () => {
  await connectDB();
  
  console.log('Testing Cron Service Setup');
  
  const cronService = new CronService();
  cronService.initializeCronJobs();
  
  console.log('Cron service initialized');
  console.log('Scheduled tasks:', cronService.getScheduledTasks());
  
  // Wait a moment to see if any jobs would run
  setTimeout(() => {
    console.log('Test completed');
    process.exit(0);
  }, 5000);
};

testCronService();