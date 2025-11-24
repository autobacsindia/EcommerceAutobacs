import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';
import Category from './models/Category.js';

dotenv.config();

console.log('Adding sample products to MongoDB...');

// Simple slug generator function
function generateSlug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function addSampleProducts() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 10000,
    });
    
    console.log('✓ Connected to MongoDB');
    console.log('Database name:', mongoose.connection.name);
    
    // Create sample categories if they don't exist
    const categories = [
      { name: 'Engine Parts', description: 'Engine components and parts', slug: 'engine-parts' },
      { name: 'Brake System', description: 'Brake pads, rotors, and related components', slug: 'brake-system' },
      { name: 'Electronics', description: 'Car electronics and sensors', slug: 'electronics' },
      { name: 'Filters', description: 'Air, oil, and fuel filters', slug: 'filters' },
      { name: 'Suspension', description: 'Shock absorbers, struts, and suspension components', slug: 'suspension' },
      { name: 'Exhaust', description: 'Mufflers, catalytic converters, and exhaust components', slug: 'exhaust' }
    ];
    
    const categoryIds = [];
    for (const cat of categories) {
      const existing = await Category.findOne({ name: cat.name });
      if (existing) {
        categoryIds.push(existing._id);
        console.log(`Category already exists: ${cat.name}`);
      } else {
        const newCat = new Category(cat);
        const savedCat = await newCat.save();
        categoryIds.push(savedCat._id);
        console.log(`Created category: ${cat.name}`);
      }
    }
    
    // Create a more complete set of sample products
    const sampleProducts = [
      // Engine Parts
      {
        name: 'Premium Brake Pads',
        description: 'High-performance brake pads for optimal stopping power with low dust formulation',
        shortDescription: 'High-quality brake pads',
        price: 89.99,
        originalPrice: 99.99,
        category: categoryIds[1], // Brake System
        brand: 'Autobacs',
        stock: 50,
        sku: 'BP-001',
        isActive: true,
        isFeatured: true,
        tags: ['brake', 'performance', 'pads'],
        specifications: [
          { key: 'Material', value: 'Ceramic' },
          { key: 'Width', value: '120mm' },
          { key: 'Height', value: '50mm' }
        ],
        images: [{ url: 'https://example.com/brake-pads.jpg', alt: 'Brake Pads' }]
      },
      {
        name: 'Engine Oil Filter',
        description: 'High-quality oil filter for engine protection with synthetic media',
        shortDescription: 'Standard oil filter',
        price: 24.99,
        category: categoryIds[0], // Engine Parts
        brand: 'Autobacs',
        stock: 100,
        sku: 'EOF-001',
        isActive: true,
        isFeatured: false,
        tags: ['engine', 'oil', 'filter'],
        specifications: [
          { key: 'Filter Type', value: 'Spin-on' },
          { key: 'Thread Size', value: '3/4-16' },
          { key: 'Flow Rate', value: '15 GPM' }
        ],
        images: [{ url: 'https://example.com/oil-filter.jpg', alt: 'Oil Filter' }]
      },
      {
        name: 'Car Battery',
        description: 'Reliable car battery for all weather conditions with 3-year warranty',
        shortDescription: '12V car battery',
        price: 129.99,
        category: categoryIds[2], // Electronics
        brand: 'Autobacs',
        stock: 25,
        sku: 'CB-001',
        isActive: true,
        isFeatured: true,
        tags: ['battery', 'electronics', 'power'],
        specifications: [
          { key: 'Voltage', value: '12V' },
          { key: 'Amp Hours', value: '60Ah' },
          { key: 'Cold Cranking Amps', value: '550 CCA' }
        ],
        images: [{ url: 'https://example.com/car-battery.jpg', alt: 'Car Battery' }]
      },
      {
        name: 'Air Filter',
        description: 'High-flow air filter for improved engine performance and fuel efficiency',
        shortDescription: 'Engine air filter',
        price: 19.99,
        category: categoryIds[3], // Filters
        brand: 'Autobacs',
        stock: 75,
        sku: 'AF-001',
        isActive: true,
        isFeatured: false,
        tags: ['air', 'filter', 'engine'],
        specifications: [
          { key: 'Filter Type', value: 'Pleated Paper' },
          { key: 'Size', value: '8.5" x 3.5"' },
          { key: 'Air Flow', value: '350 CFM' }
        ],
        images: [{ url: 'https://example.com/air-filter.jpg', alt: 'Air Filter' }]
      },
      {
        name: 'Spark Plugs',
        description: 'Iridium spark plugs for optimal ignition and extended life',
        shortDescription: 'Set of 4 spark plugs',
        price: 39.99,
        category: categoryIds[0], // Engine Parts
        brand: 'Autobacs',
        stock: 60,
        sku: 'SP-001',
        isActive: true,
        isFeatured: false,
        tags: ['spark', 'plugs', 'ignition'],
        specifications: [
          { key: 'Plug Type', value: 'Iridium' },
          { key: 'Thread Size', value: '14mm' },
          { key: 'Heat Range', value: '7' }
        ],
        images: [{ url: 'https://example.com/spark-plugs.jpg', alt: 'Spark Plugs' }]
      },
      // Additional products
      {
        name: 'Fuel Filter',
        description: 'High-efficiency fuel filter to protect fuel injection systems',
        shortDescription: 'Fuel system filter',
        price: 34.99,
        category: categoryIds[3], // Filters
        brand: 'Autobacs',
        stock: 40,
        sku: 'FF-001',
        isActive: true,
        isFeatured: false,
        tags: ['fuel', 'filter', 'injection'],
        specifications: [
          { key: 'Filter Type', value: 'In-line' },
          { key: 'Micron Rating', value: '10 Microns' },
          { key: 'Flow Rate', value: '40 LPH' }
        ],
        images: [{ url: 'https://example.com/fuel-filter.jpg', alt: 'Fuel Filter' }]
      },
      {
        name: 'Cabin Air Filter',
        description: 'Activated carbon cabin air filter for allergen and odor protection',
        shortDescription: 'HVAC cabin filter',
        price: 29.99,
        category: categoryIds[3], // Filters
        brand: 'Autobacs',
        stock: 80,
        sku: 'CAF-001',
        isActive: true,
        isFeatured: true,
        tags: ['cabin', 'air', 'filter', 'HVAC'],
        specifications: [
          { key: 'Filter Type', value: 'Activated Carbon' },
          { key: 'Size', value: '10" x 8" x 1"' },
          { key: 'Filtration Efficiency', value: '99.5%' }
        ],
        images: [{ url: 'https://example.com/cabin-air-filter.jpg', alt: 'Cabin Air Filter' }]
      },
      {
        name: 'Shock Absorbers',
        description: 'Gas-filled shock absorbers for improved ride comfort and handling',
        shortDescription: 'Front shock absorbers',
        price: 149.99,
        category: categoryIds[4], // Suspension
        brand: 'Autobacs',
        stock: 30,
        sku: 'SA-001',
        isActive: true,
        isFeatured: false,
        tags: ['suspension', 'shock', 'absorbers'],
        specifications: [
          { key: 'Type', value: 'Gas-filled' },
          { key: 'Length', value: '14.5"' },
          { key: 'Diameter', value: '40mm' }
        ],
        images: [{ url: 'https://example.com/shock-absorbers.jpg', alt: 'Shock Absorbers' }]
      },
      {
        name: 'Muffler',
        description: 'Stainless steel muffler for reduced exhaust noise',
        shortDescription: 'Universal fit muffler',
        price: 89.99,
        category: categoryIds[5], // Exhaust
        brand: 'Autobacs',
        stock: 20,
        sku: 'MUF-001',
        isActive: true,
        isFeatured: false,
        tags: ['exhaust', 'muffler', 'noise'],
        specifications: [
          { key: 'Material', value: 'Stainless Steel' },
          { key: 'Inlet Diameter', value: '2.5"' },
          { key: 'Outlet Diameter', value: '2.5"' }
        ],
        images: [{ url: 'https://example.com/muffler.jpg', alt: 'Muffler' }]
      },
      {
        name: 'Oxygen Sensor',
        description: 'Universal oxygen sensor for emissions control and fuel efficiency',
        shortDescription: 'O2 sensor',
        price: 69.99,
        category: categoryIds[2], // Electronics
        brand: 'Autobacs',
        stock: 35,
        sku: 'O2S-001',
        isActive: true,
        isFeatured: false,
        tags: ['oxygen', 'sensor', 'emissions'],
        specifications: [
          { key: 'Sensor Type', value: 'Zirconia' },
          { key: 'Connector Type', value: '4-wire' },
          { key: 'Operating Voltage', value: '12V' }
        ],
        images: [{ url: 'https://example.com/oxygen-sensor.jpg', alt: 'Oxygen Sensor' }]
      },
      {
        name: 'Alternator',
        description: 'High-output alternator for reliable electrical system performance',
        shortDescription: '12V automotive alternator',
        price: 199.99,
        category: categoryIds[2], // Electronics
        brand: 'Autobacs',
        stock: 15,
        sku: 'ALT-001',
        isActive: true,
        isFeatured: true,
        tags: ['alternator', 'generator', 'electronics'],
        specifications: [
          { key: 'Output', value: '120 Amp' },
          { key: 'Voltage', value: '12V' },
          { key: 'Mounting Type', value: 'Direct Fit' }
        ],
        images: [{ url: 'https://example.com/alternator.jpg', alt: 'Alternator' }]
      },
      {
        name: 'Radiator',
        description: 'Aluminum radiator for efficient engine cooling',
        shortDescription: 'Engine cooling radiator',
        price: 249.99,
        category: categoryIds[0], // Engine Parts
        brand: 'Autobacs',
        stock: 12,
        sku: 'RAD-001',
        isActive: true,
        isFeatured: false,
        tags: ['radiator', 'cooling', 'engine'],
        specifications: [
          { key: 'Material', value: 'Aluminum' },
          { key: 'Core Size', value: '24" x 18"' },
          { key: 'Number of Rows', value: '2' }
        ],
        images: [{ url: 'https://example.com/radiator.jpg', alt: 'Radiator' }]
      },
      {
        name: 'Brake Rotors',
        description: 'Premium quality brake rotors for smooth braking performance',
        shortDescription: 'Front brake rotors',
        price: 79.99,
        category: categoryIds[1], // Brake System
        brand: 'Autobacs',
        stock: 45,
        sku: 'BR-001',
        isActive: true,
        isFeatured: false,
        tags: ['brake', 'rotors', 'disc'],
        specifications: [
          { key: 'Material', value: 'Cast Iron' },
          { key: 'Diameter', value: '12.5"' },
          { key: 'Thickness', value: '25mm' }
        ],
        images: [{ url: 'https://example.com/brake-rotors.jpg', alt: 'Brake Rotors' }]
      },
      {
        name: 'Transmission Filter',
        description: 'High-quality transmission filter for automatic transmissions',
        shortDescription: 'Automatic transmission filter',
        price: 42.99,
        category: categoryIds[3], // Filters
        brand: 'Autobacs',
        stock: 38,
        sku: 'TF-001',
        isActive: true,
        isFeatured: false,
        tags: ['transmission', 'filter', 'automatic'],
        specifications: [
          { key: 'Filter Type', value: 'Spin-on' },
          { key: 'Thread Size', value: 'M20x1.5' },
          { key: 'Flow Rate', value: '25 LPM' }
        ],
        images: [{ url: 'https://example.com/transmission-filter.jpg', alt: 'Transmission Filter' }]
      },
      {
        name: 'Steering Rack',
        description: 'Rebuilt steering rack for precise steering control',
        shortDescription: 'Power steering rack',
        price: 299.99,
        category: categoryIds[4], // Suspension
        brand: 'Autobacs',
        stock: 8,
        sku: 'SR-001',
        isActive: true,
        isFeatured: true,
        tags: ['steering', 'rack', 'suspension'],
        specifications: [
          { key: 'Type', value: 'Rebuilt' },
          { key: 'End Fittings', value: 'Hydraulic' },
          { key: 'Warranty', value: '2 Years' }
        ],
        images: [{ url: 'https://example.com/steering-rack.jpg', alt: 'Steering Rack' }]
      }
    ];
    
    // Insert sample products
    let addedCount = 0;
    for (const productData of sampleProducts) {
      const existing = await Product.findOne({ sku: productData.sku });
      if (!existing) {
        const product = new Product(productData);
        await product.save();
        console.log(`Added product: ${product.name}`);
        addedCount++;
      } else {
        console.log(`Product already exists: ${productData.name}`);
      }
    }
    
    console.log(`\nAdded ${addedCount} new sample products to the database.`);
    
    // Verify count
    const totalProducts = await Product.countDocuments({});
    console.log(`Total products in database: ${totalProducts}`);
    
    // Close connection
    await mongoose.connection.close();
    console.log('\n✓ Disconnected from MongoDB');
    
  } catch (error) {
    console.error('✗ Error adding sample products:', error.message);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

addSampleProducts();