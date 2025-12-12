import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from './models/User.js';
import bcrypt from 'bcryptjs';

// Load environment variables
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', async () => {
  console.log('Connected to MongoDB');
  
  try {
    // Check if admin user already exists
    const existingAdmin = await User.findOne({ email: 'admin@autobacs.com' });
    
    if (existingAdmin) {
      console.log('Admin user already exists');
      mongoose.connection.close();
      return;
    }
    
    // Create admin user
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('Admin123!', salt);
    
    const adminUser = new User({
      name: 'Admin User',
      email: 'admin@autobacs.com',
      passwordHash: hashedPassword,
      role: 'admin'
    });
    
    await adminUser.save();
    console.log('✅ Admin user created successfully!');
    console.log('Email: admin@autobacs.com');
    console.log('Password: Admin123!');
    
    mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error creating admin user:', error.message);
    mongoose.connection.close();
  }
});