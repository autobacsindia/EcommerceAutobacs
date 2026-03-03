import mongoose from 'mongoose';
import Vehicle from '../models/Vehicle.js';
import dotenv from 'dotenv';
dotenv.config();

// MongoDB connection
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/autobacs', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB Connected');
    return conn;
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    process.exit(1);
  }
};

// Sample vehicle data (this would come from scraping the source website)
const sampleVehicles = [
  { make: 'Toyota', model: 'Hilux', year: 2023, slug: 'toyota-hilux', image: { url: '/images/vehicles/toyota-hilux.jpg', alt: 'Toyota Hilux' } },
  { make: 'Mahindra', model: 'Thar', year: 2023, slug: 'mahindra-thar', image: { url: '/images/vehicles/mahindra-thar.jpg', alt: 'Mahindra Thar' } },
  { make: 'Isuzu', model: 'D-Max', year: 2023, slug: 'isuzu-d-max', image: { url: '/images/vehicles/isuzu-d-max.jpg', alt: 'Isuzu D-Max' } },
  { make: 'Maruti', model: 'Jimny', year: 2023, slug: 'maruti-jimny', image: { url: '/images/vehicles/maruti-jimny.jpg', alt: 'Maruti Jimny' } },
  { make: 'Jeep', model: 'Wrangler', year: 2023, slug: 'jeep-wrangler', image: { url: '/images/vehicles/jeep-wrangler.jpg', alt: 'Jeep Wrangler' } },
  { make: 'Toyota', model: 'Fortuner', year: 2023, slug: 'toyota-fortuner', image: { url: '/images/vehicles/toyota-fortuner.jpg', alt: 'Toyota Fortuner' } },
  { make: 'Volkswagen', model: 'Polo', year: 2023, slug: 'volkswagen-polo', image: { url: '/images/vehicles/volkswagen-polo.jpg', alt: 'Volkswagen Polo' } },
  { make: 'Hyundai', model: 'Creta', year: 2023, slug: 'hyundai-creta', image: { url: '/images/vehicles/hyundai-creta.jpg', alt: 'Hyundai Creta' } },
  { make: 'Kia', model: 'Seltos', year: 2023, slug: 'kia-seltos', image: { url: '/images/vehicles/kia-seltos.jpg', alt: 'Kia Seltos' } },
  { make: 'Ford', model: 'Endeavour', year: 2023, slug: 'ford-endeavour', image: { url: '/images/vehicles/ford-endeavour.jpg', alt: 'Ford Endeavour' } },
  { make: 'Audi', model: 'Q7', year: 2023, slug: 'audi-q7', image: { url: '/images/vehicles/audi-q7.jpg', alt: 'Audi Q7' } },
  { make: 'BMW', model: 'X5', year: 2023, slug: 'bmw-x5', image: { url: '/images/vehicles/bmw-x5.jpg', alt: 'BMW X5' } },
  { make: 'Ford', model: 'Ranger', year: 2023, slug: 'ford-ranger', image: { url: '/images/vehicles/ford-ranger.jpg', alt: 'Ford Ranger' } },
  { make: 'Land Rover', model: 'Defender', year: 2023, slug: 'land-rover-defender', image: { url: '/images/vehicles/land-rover-defender.jpg', alt: 'Land Rover Defender' } },
  { make: 'Mercedes-Benz', model: 'G-Class', year: 2023, slug: 'mercedes-benz-g-class', image: { url: '/images/vehicles/mercedes-benz-g-class.jpg', alt: 'Mercedes-Benz G-Class' } }
];

const populateVehicles = async () => {
  try {
    await connectDB();
    
    // Clear existing vehicles
    await Vehicle.deleteMany({});
    console.log('Cleared existing vehicles');
    
    // Insert sample vehicles
    const insertedVehicles = await Vehicle.insertMany(sampleVehicles);
    console.log(`Inserted ${insertedVehicles.length} vehicles`);
    
    console.log('Vehicle population completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error populating vehicles:', error);
    process.exit(1);
  }
};

populateVehicles();