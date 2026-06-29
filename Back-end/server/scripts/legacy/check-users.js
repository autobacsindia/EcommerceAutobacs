import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../../models/User.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI);

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', async () => {
  console.log('Connected to MongoDB');
  
  try {
    // Check all users
    const users = await User.find({});
    console.log(`Found ${users.length} users:`);
    
    users.forEach(user => {
      console.log(`- ${user.name} (${user.email}) - Role: ${user.role}`);
    });
    
    mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error checking users:', error.message);
    mongoose.connection.close();
  }
});