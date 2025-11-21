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

// Test the failed product import functionality
const testFailedProductImport = async () => {
  await connectDB();
  
  console.log('Testing Failed Product Import Functionality');
  
  const cronService = new CronService();
  
  // Run the failed product import process
  const result = await cronService.runFailedProductImport();
  
  console.log('Failed product import result:', result);
  
  // Close the database connection
  await mongoose.connection.close();
  console.log('Database connection closed');
  
  process.exit(0);
};

testFailedProductImport();