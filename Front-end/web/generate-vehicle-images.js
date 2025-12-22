const fs = require('fs');
const path = require('path');

// Vehicle data
const vehicles = [
  { id: 1, name: 'Toyota Hilux', slug: 'toyota-hilux' },
  { id: 2, name: 'Mahindra Thar', slug: 'mahindra-thar' },
  { id: 3, name: 'Isuzu Dmax-v cross', slug: 'isuzu-dmax-v-cross' },
  { id: 4, name: 'Maruti Jimny', slug: 'maruti-jimny' },
  { id: 5, name: 'Jeep Wrangler', slug: 'jeep-wrangler' },
  { id: 6, name: 'Toyota Fortuner', slug: 'toyota-fortuner' },
  { id: 7, name: 'Volkswagen Polo', slug: 'volkswagen-polo' },
  { id: 8, name: 'Hyundai', slug: 'hyundai' },
  { id: 9, name: 'KIA', slug: 'kia' },
  { id: 10, name: 'Ford Endeavour', slug: 'ford-endeavour' },
  { id: 11, name: 'Audi', slug: 'audi' },
  { id: 12, name: 'BMW', slug: 'bmw' },
  { id: 13, name: 'Ford Ranger', slug: 'ford-ranger' },
  { id: 14, name: 'Land Rover Defender', slug: 'land-rover-defender' },
  { id: 15, name: 'Mercedes Benz', slug: 'mercedes-benz' },
];

// Create a simple SVG placeholder for each vehicle
function createPlaceholderSVG(name, outputPath) {
  const svgContent = `
  <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
    <!-- Background gradient -->
    <defs>
      <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#f0f0f0;stop-opacity:1" />
        <stop offset="100%" style="stop-color:#e0e0e0;stop-opacity:1" />
      </linearGradient>
    </defs>
    
    <!-- Background -->
    <rect width="100%" height="100%" fill="url(#bgGradient)" />
    
    <!-- Vehicle icon representation -->
    <rect x="100" y="100" width="200" height="100" rx="10" fill="#cccccc" />
    <circle cx="140" cy="180" r="20" fill="#999999" />
    <circle cx="260" cy="180" r="20" fill="#999999" />
    
    <!-- Vehicle name text -->
    <text x="200" y="60" font-family="Arial, sans-serif" font-size="24" fill="#333333" text-anchor="middle" font-weight="bold">
      ${name}
    </text>
    
    <!-- Placeholder label -->
    <text x="200" y="270" font-family="Arial, sans-serif" font-size="16" fill="#666666" text-anchor="middle">
      Vehicle Image
    </text>
  </svg>`;

  fs.writeFileSync(outputPath, svgContent.trim());
  console.log(`Created placeholder image for ${name} at ${outputPath}`);
}

// Generate images for all vehicles
const vehiclesDir = path.join(__dirname, 'public', 'images', 'vehicles');

if (!fs.existsSync(vehiclesDir)) {
  fs.mkdirSync(vehiclesDir, { recursive: true });
}

vehicles.forEach(vehicle => {
  const imagePath = path.join(vehiclesDir, `${vehicle.slug}.jpg`);
  
  // For now, we'll create SVG placeholders and convert them to JPG-like naming
  // In a real scenario, you would either:
  // 1. Download actual images from the live site
  // 2. Use a library like canvas to generate actual image files
  // 3. Use actual JPG files
  
  // Create SVG placeholder
  const svgPath = path.join(vehiclesDir, `${vehicle.slug}.svg`);
  createPlaceholderSVG(vehicle.name, svgPath);
  
  // Also create a JPG version (which will just be the SVG for now)
  // In a real implementation, you'd convert SVG to JPG or use actual JPG files
  fs.copyFileSync(svgPath, imagePath);
});

console.log('All vehicle placeholder images have been generated.');
console.log('Note: These are SVG placeholders. For actual images, replace with real vehicle images from the live site.');