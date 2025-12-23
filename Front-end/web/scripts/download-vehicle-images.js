import axios from 'axios';
import fs from 'fs';
import path from 'path';

// Create directory if it doesn't exist
const vehiclesDir = path.join(process.cwd(), 'public', 'images', 'vehicles');
if (!fs.existsSync(vehiclesDir)) {
  fs.mkdirSync(vehiclesDir, { recursive: true });
}

// List of vehicle image URLs to download from Autobacs India
const vehicleImageUrls = [
  // Ford Ranger
  'https://autobacsindia.com/wp-content/uploads/2024/11/Ford-Ranger-2024-1024x576.jpg',
  // Toyota Hilux
  'https://autobacsindia.com/wp-content/uploads/2024/11/Toyota-Hilux-2024-1024x576.jpg',
  // Mahindra Thar
  'https://autobacsindia.com/wp-content/uploads/2024/11/Mahindra-Thar-2024-1024x576.jpg',
  // Isuzu D-Max
  'https://autobacsindia.com/wp-content/uploads/2024/11/Isuzu-D-Max-2024-1024x576.jpg',
  // Maruti Jimny
  'https://autobacsindia.com/wp-content/uploads/2024/11/Maruti-Jimny-2024-1024x576.jpg',
  // Jeep Wrangler
  'https://autobacsindia.com/wp-content/uploads/2024/11/Jeep-Wrangler-2024-1024x576.jpg',
  // Toyota Fortuner
  'https://autobacsindia.com/wp-content/uploads/2024/11/Toyota-Fortuner-2024-1024x576.jpg',
  // Volkswagen Polo
  'https://autobacsindia.com/wp-content/uploads/2024/11/Volkswagen-Polo-2024-1024x576.jpg',
  // Hyundai
  'https://autobacsindia.com/wp-content/uploads/2024/11/Hyundai-Creta-2024-1024x576.jpg',
  // KIA
  'https://autobacsindia.com/wp-content/uploads/2024/11/KIA-Seltos-2024-1024x576.jpg',
  // Ford Endeavour
  'https://autobacsindia.com/wp-content/uploads/2024/11/Ford-Endeavour-2024-1024x576.jpg',
  // Audi
  'https://autobacsindia.com/wp-content/uploads/2024/11/Audi-Q5-2024-1024x576.jpg',
  // BMW
  'https://autobacsindia.com/wp-content/uploads/2024/11/BMW-X5-2024-1024x576.jpg',
  // Land Rover Defender
  'https://autobacsindia.com/wp-content/uploads/2024/11/Land-Rover-Defender-2024-1024x576.jpg',
  // Mercedes Benz
  'https://autobacsindia.com/wp-content/uploads/2024/11/Mercedes-Benz-GLE-2024-1024x576.jpg',
  // Additional images from the 2024/11 directory
  'https://autobacsindia.com/wp-content/uploads/2024/11/181709-3000x1688-desktop-hd-jeep-background-photo-scaled.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/audi-rs6-avant-2021-116651-scaled.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/bmw-m4-competition-2021-116647-scaled.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/ford-ranger-raptor-2023-116655-scaled.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/hyundai-custo-2021-116659-scaled.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/kia-sorento-2022-116663-scaled.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/land-rover-defender-90-2021-116667-scaled.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/mahindra-thar-2021-116671-scaled.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/mercedes-benz-eqs-580-4matic-2021-116675-scaled.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/toyota-fortuner-2023-116679-scaled.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/volkswagen-polo-2021-116683-scaled.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/jeep-compass-2021-116687-scaled.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/ford-endeavour-2023-116691-scaled.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/isuzu-d-max-2021-116695-scaled.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/maruti-suzuki-jimny-2021-116699-scaled.jpg'
];

// Map vehicle slugs to image URLs
const vehicleSlugMap = {
  'ford-ranger': 'https://autobacsindia.com/wp-content/uploads/2024/11/Ford-Ranger-2024-1024x576.jpg',
  'toyota-hilux': 'https://autobacsindia.com/wp-content/uploads/2024/11/Toyota-Hilux-2024-1024x576.jpg',
  'mahindra-thar': 'https://autobacsindia.com/wp-content/uploads/2024/11/Mahindra-Thar-2024-1024x576.jpg',
  'isuzu-dmax-v-cross': 'https://autobacsindia.com/wp-content/uploads/2024/11/Isuzu-D-Max-2024-1024x576.jpg',
  'maruti-jimny': 'https://autobacsindia.com/wp-content/uploads/2024/11/Maruti-Jimny-2024-1024x576.jpg',
  'jeep-wrangler': 'https://autobacsindia.com/wp-content/uploads/2024/11/Jeep-Wrangler-2024-1024x576.jpg',
  'toyota-fortuner': 'https://autobacsindia.com/wp-content/uploads/2024/11/Toyota-Fortuner-2024-1024x576.jpg',
  'volkswagen-polo': 'https://autobacsindia.com/wp-content/uploads/2024/11/Volkswagen-Polo-2024-1024x576.jpg',
  'hyundai': 'https://autobacsindia.com/wp-content/uploads/2024/11/Hyundai-Creta-2024-1024x576.jpg',
  'kia': 'https://autobacsindia.com/wp-content/uploads/2024/11/KIA-Seltos-2024-1024x576.jpg',
  'ford-endeavour': 'https://autobacsindia.com/wp-content/uploads/2024/11/Ford-Endeavour-2024-1024x576.jpg',
  'audi': 'https://autobacsindia.com/wp-content/uploads/2024/11/Audi-Q5-2024-1024x576.jpg',
  'bmw': 'https://autobacsindia.com/wp-content/uploads/2024/11/BMW-X5-2024-1024x576.jpg',
  'land-rover-defender': 'https://autobacsindia.com/wp-content/uploads/2024/11/Land-Rover-Defender-2024-1024x576.jpg',
  'mercedes-benz': 'https://autobacsindia.com/wp-content/uploads/2024/11/Mercedes-Benz-GLE-2024-1024x576.jpg'
};

async function downloadImage(url, filename) {
  try {
    console.log(`Downloading ${filename}...`);
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    const filePath = path.join(vehiclesDir, filename);
    const writer = fs.createWriteStream(filePath);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (error) {
    console.error(`Error downloading ${filename}:`, error.message);
    // Create a placeholder image if download fails
    const filePath = path.join(vehiclesDir, filename);
    fs.writeFileSync(filePath, `<?xml version="1.0" encoding="UTF-8"?>
<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#f0f0f0"/>
  <text x="50%" y="50%" font-family="Arial" font-size="16" text-anchor="middle" fill="#666">
    Image not available
  </text>
</svg>`);
  }
}

async function downloadAllImages() {
  console.log('Starting to download vehicle images...');
  
  for (const [slug, url] of Object.entries(vehicleSlugMap)) {
    const filename = `${slug}.jpg`;
    await downloadImage(url, filename);
    console.log(`✓ Downloaded ${filename}`);
  }
  
  console.log('All vehicle images downloaded successfully!');
}

// Run the download function
downloadAllImages().catch(console.error);