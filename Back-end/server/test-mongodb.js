import dotenv from 'dotenv';
import mongoose from 'mongoose';
import ImportJob from './models/ImportJob.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI);

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', async () => {
  console.log('Connected to MongoDB');
  
  try {
    // Test accessing ImportJob model
    const count = await ImportJob.countDocuments();
    console.log(`Found ${count} import jobs in the database`);
    
    // Create a test import job
    const testJob = new ImportJob({
      jobId: `test-job-${Date.now()}`,
      status: 'pending',
      source: 'wordpress'
    });
    
    await testJob.save();
    console.log('✅ Successfully created test import job');
    
    // Clean up - delete the test job
    await ImportJob.deleteOne({ jobId: testJob.jobId });
    console.log('✅ Cleaned up test import job');
    
    mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error testing ImportJob model:', error.message);
    console.error(error.stack);
    mongoose.connection.close();
  }
});