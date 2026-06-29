import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Brand from '../../models/Brand.js';

dotenv.config();

const BRAND_LOGOS = [
  {
    slug: 'profender',
    logo: 'https://autobacsindia.com/wp-content/uploads/2024/10/profender-logo-1.png.webp'
  },
  {
    slug: 'bushranger',
    logo: 'https://autobacsindia.com/wp-content/uploads/2024/10/bushranger.png.webp'
  },
  {
    slug: 'ironman-4x4',
    logo: 'https://autobacsindia.com/wp-content/uploads/2024/10/ironman.png.webp'
  },
  {
    slug: 'dr-nano',
    logo: 'https://autobacsindia.com/wp-content/uploads/2024/10/dr-nano-logo-1.png.webp'
  },
  {
    slug: 'lightforce',
    logo: 'https://autobacsindia.com/wp-content/uploads/2024/10/lightforce-logo-1.png.webp'
  },
  {
    slug: 'option4wd',
    logo: 'https://autobacsindia.com/wp-content/uploads/2024/10/option-logo-1.png.webp'
  }
];

await mongoose.connect(process.env.MONGO_URI);
console.log('Connected to MongoDB');

for (const { slug, logo } of BRAND_LOGOS) {
  const result = await Brand.findOneAndUpdate(
    { slug },
    { $set: { logo } },
    { new: true }
  );
  if (result) {
    console.log(`✅ Updated logo for: ${result.name} (${slug})`);
  } else {
    console.log(`⚠️  Brand not found: ${slug}`);
  }
}

await mongoose.connection.close();
console.log('Done.');
