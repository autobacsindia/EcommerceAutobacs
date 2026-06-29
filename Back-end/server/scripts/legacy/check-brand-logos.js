import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Brand from '../../models/Brand.js';

dotenv.config();

await mongoose.connect(process.env.MONGO_URI);
const brands = await Brand.find({ isActive: true }, { name: 1, slug: 1, logo: 1 });
brands.forEach(b => console.log(`${b.name} | slug: ${b.slug} | logo: ${b.logo || 'MISSING'}`));
await mongoose.connection.close();
