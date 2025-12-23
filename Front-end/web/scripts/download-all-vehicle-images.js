const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Create images directory if it doesn't exist
const imagesDir = path.join(__dirname, '..', 'public', 'images', 'vehicles');
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

// List of vehicle image URLs to download from Autobacs India
const vehicleImageUrls = [
  'https://autobacsindia.com/wp-content/uploads/2024/11/Nova-Hilux-2021_1-scaled-1.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/mahindra_thar_roxx_2024_5k-3840x2160-1-scaled.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/1778470-1920x1300-desktop-hd-isuzu-wallpaper-photo.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/suzuki_jimny_2018_08.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/181709-3000x1688-desktop-hd-jeep-background-photo-scaled.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/toyota-fortuner-right-front-three-quarter0.jpeg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/VW-Polo-7.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/Hyundai-i20-2-jpeg.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/Carens_1920x1080_3.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/Untitled-design-2024-01-04T133626.142.png',
  'https://autobacsindia.com/wp-content/uploads/2024/11/A240553_web_2880-scaled.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/bmw-3-series.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/Ford-Ranger.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/land-rover-defender-1333693509.jpg',
  'https://autobacsindia.com/wp-content/uploads/2024/11/Mercedes-Benz-E-Class.jpg'
];

async function downloadImage(url, filename) {
  try {
    console.log(`Downloading ${filename} from ${url}`);
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    const filePath = path.join(imagesDir, filename);
    const writer = fs.createWriteStream(filePath);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (error) {
    console.error(`Error downloading ${url}:`, error.message);
    // Create a placeholder image if download fails
    createPlaceholderImage(filename);
  }
}

function createPlaceholderImage(filename) {
  const placeholderSVG = `<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#f0f0f0"/>
  <text x="50%" y="50%" font-family="Arial" font-size="16" fill="#666" text-anchor="middle" dominant-baseline="middle">
    ${filename}
  </text>
</svg>`;
  
  const filePath = path.join(imagesDir, filename);
  fs.writeFileSync(filePath, placeholderSVG);
  console.log(`Created placeholder for ${filename}`);
}

async function downloadAllImages() {
  console.log(`Starting download of ${vehicleImageUrls.length} vehicle images...`);
  
  for (const url of vehicleImageUrls) {
    try {
      // Extract filename from URL
      const urlParts = url.split('/');
      const filename = urlParts[urlParts.length - 1];
      
      // Skip if file already exists
      const filePath = path.join(imagesDir, filename);
      if (fs.existsSync(filePath)) {
        console.log(`Skipping ${filename}, already exists`);
        continue;
      }
      
      await downloadImage(url, filename);
      console.log(`Successfully downloaded ${filename}`);
      
      // Add a small delay to be respectful to the server
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`Failed to process ${url}:`, error.message);
    }
  }
  
  console.log('Download process completed!');
}

// Run the download function
downloadAllImages().catch(console.error);