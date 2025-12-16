import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';
import Category from './models/Category.js';

dotenv.config();

console.log('Bulk importing products to MongoDB...');

// Simple slug generator function
function generateSlug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Generate realistic product data
function generateProductData(categoryId, index, categoryName) {
  const productsByCategory = {
    'engine-parts': [
      {
        name: `High Performance Engine ${index}`,
        description: `Advanced engine component with improved efficiency and durability. Features cutting-edge technology for optimal performance.`,
        shortDescription: `Engine component ${index}`,
        price: (Math.random() * 300 + 50).toFixed(2),
        originalPrice: (Math.random() * 400 + 100).toFixed(2),
        brand: ['Autobacs', 'Bosch', 'NGK', 'Denso'][Math.floor(Math.random() * 4)],
        stock: Math.floor(Math.random() * 100),
        sku: `ENG-${categoryName.substring(0, 3).toUpperCase()}-${index}`,
        tags: ['engine', 'performance', categoryName.toLowerCase()],
        specifications: [
          { key: 'Horsepower', value: `${Math.floor(Math.random() * 100)} HP` },
          { key: 'Torque', value: `${Math.floor(Math.random() * 200)} lb-ft` },
          { key: 'Compatibility', value: 'Universal Fit' }
        ]
      },
      {
        name: `Engine ${categoryName} Kit ${index}`,
        description: `Complete ${categoryName} replacement kit with all necessary components. Professional grade for long-lasting performance.`,
        shortDescription: `${categoryName} replacement kit`,
        price: (Math.random() * 200 + 75).toFixed(2),
        originalPrice: (Math.random() * 300 + 100).toFixed(2),
        brand: ['Autobacs', 'Bosch', 'NGK', 'Denso'][Math.floor(Math.random() * 4)],
        stock: Math.floor(Math.random() * 50),
        sku: `KIT-${categoryName.substring(0, 3).toUpperCase()}-${index}`,
        tags: ['engine', 'kit', categoryName.toLowerCase()],
        specifications: [
          { key: 'Components', value: 'Complete Set' },
          { key: 'Installation', value: 'Professional Required' },
          { key: 'Warranty', value: '2 Years' }
        ]
      }
    ],
    'brake-system': [
      {
        name: `Premium Brake ${categoryName} ${index}`,
        description: `High-quality brake ${categoryName} with superior stopping power and reduced wear. Designed for safety and performance.`,
        shortDescription: `Brake ${categoryName}`,
        price: (Math.random() * 150 + 30).toFixed(2),
        originalPrice: (Math.random() * 200 + 50).toFixed(2),
        brand: ['Autobacs', 'Brembo', 'Akebono', 'EBC'][Math.floor(Math.random() * 4)],
        stock: Math.floor(Math.random() * 80),
        sku: `BRAKE-${categoryName.substring(0, 3).toUpperCase()}-${index}`,
        tags: ['brake', categoryName.toLowerCase(), 'safety'],
        specifications: [
          { key: 'Material', value: ['Ceramic', 'Semi-Metallic', 'Organic'][Math.floor(Math.random() * 3)] },
          { key: 'Friction Level', value: `${Math.floor(Math.random() * 5) + 3} (AA Rating)` },
          { key: 'Noise Level', value: '< 40dB' }
        ]
      }
    ],
    'electronics': [
      {
        name: `Advanced ${categoryName} System ${index}`,
        description: `State-of-the-art ${categoryName} system with enhanced functionality and reliability. Digital precision for optimal vehicle performance.`,
        shortDescription: `${categoryName} system`,
        price: (Math.random() * 400 + 100).toFixed(2),
        originalPrice: (Math.random() * 500 + 150).toFixed(2),
        brand: ['Autobacs', 'Bosch', 'Delphi', 'Valeo'][Math.floor(Math.random() * 4)],
        stock: Math.floor(Math.random() * 40),
        sku: `ELEC-${categoryName.substring(0, 3).toUpperCase()}-${index}`,
        tags: ['electronics', categoryName.toLowerCase(), 'digital'],
        specifications: [
          { key: 'Voltage', value: '12V' },
          { key: 'Operating Temp', value: '-40°C to +85°C' },
          { key: 'Compatibility', value: 'OEM Equivalent' }
        ]
      }
    ],
    'filters': [
      {
        name: `High-Flow ${categoryName} Filter ${index}`,
        description: `Premium ${categoryName} filter with increased flow rate and extended service life. Engineered for maximum efficiency.`,
        shortDescription: `${categoryName} filter`,
        price: (Math.random() * 80 + 20).toFixed(2),
        originalPrice: (Math.random() * 100 + 30).toFixed(2),
        brand: ['Autobacs', 'K&N', 'FRAM', 'WIX'][Math.floor(Math.random() * 4)],
        stock: Math.floor(Math.random() * 120),
        sku: `FILT-${categoryName.substring(0, 3).toUpperCase()}-${index}`,
        tags: ['filter', categoryName.toLowerCase(), 'performance'],
        specifications: [
          { key: 'Filtration Efficiency', value: `${Math.floor(Math.random() * 20) + 80}%` },
          { key: 'Service Life', value: `${Math.floor(Math.random() * 12) + 6} months` },
          { key: 'Flow Rate', value: `${Math.floor(Math.random() * 50) + 30} CFM` }
        ]
      }
    ],
    'suspension': [
      {
        name: `Performance ${categoryName} System ${index}`,
        description: `Advanced ${categoryName} system for improved handling and ride comfort. Precision engineered for optimal performance.`,
        shortDescription: `${categoryName} system`,
        price: (Math.random() * 500 + 150).toFixed(2),
        originalPrice: (Math.random() * 600 + 200).toFixed(2),
        brand: ['Autobacs', 'KYB', 'Bilstein', 'Koni'][Math.floor(Math.random() * 4)],
        stock: Math.floor(Math.random() * 30),
        sku: `SUSP-${categoryName.substring(0, 3).toUpperCase()}-${index}`,
        tags: ['suspension', categoryName.toLowerCase(), 'performance'],
        specifications: [
          { key: 'Adjustability', value: ['Fixed', 'Adjustable'][Math.floor(Math.random() * 2)] },
          { key: 'Material', value: 'Aluminum Alloy' },
          { key: 'Warranty', value: 'Lifetime' }
        ]
      }
    ],
    'exhaust': [
      {
        name: `Cat-Back ${categoryName} System ${index}`,
        description: `High-performance cat-back ${categoryName} system with improved flow and deep tone. Stainless steel construction for durability.`,
        shortDescription: `${categoryName} system`,
        price: (Math.random() * 700 + 200).toFixed(2),
        originalPrice: (Math.random() * 900 + 300).toFixed(2),
        brand: ['Autobacs', 'Borla', 'Flowmaster', 'MagnaFlow'][Math.floor(Math.random() * 4)],
        stock: Math.floor(Math.random() * 25),
        sku: `EXH-${categoryName.substring(0, 3).toUpperCase()}-${index}`,
        tags: ['exhaust', categoryName.toLowerCase(), 'performance'],
        specifications: [
          { key: 'Material', value: 'Stainless Steel' },
          { key: 'Diameter', value: `${Math.floor(Math.random() * 2) + 2.5}"` },
          { key: 'Sound Level', value: `${Math.floor(Math.random() * 10) + 85} dB` }
        ]
      }
    ]
  };

  // Get product templates for this category
  const templates = productsByCategory[categoryName] || productsByCategory['engine-parts'];
  const template = templates[Math.floor(Math.random() * templates.length)];
  
  // Add category and images to the template
  return {
    ...template,
    categories: [categoryId],
    images: [{ 
      url: `https://example.com/${categoryName.toLowerCase().replace(' ', '-')}-${index}.jpg`, 
      alt: `${template.name} image` 
    }],
    isActive: true,
    isFeatured: Math.random() > 0.8 // 20% chance of being featured
  };
}

async function bulkImportProducts() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });
    
    console.log('✓ Connected to MongoDB');
    console.log('Database name:', mongoose.connection.name);
    
    // Get all existing categories
    const categories = await Category.find({});
    console.log(`Found ${categories.length} categories in database`);
    
    if (categories.length === 0) {
      console.log('No categories found. Please run add-sample-products.js first to create categories.');
      process.exit(1);
    }
    
    // Create a mapping of category names to IDs
    const categoryMap = {};
    categories.forEach(cat => {
      categoryMap[cat.slug] = cat._id;
    });
    
    // Generate a large number of products
    const batchSize = 50;
    const totalProducts = 500; // Adjust this number as needed
    let addedCount = 0;
    
    console.log(`Generating ${totalProducts} products in batches of ${batchSize}...`);
    
    for (let i = 1; i <= totalProducts; i++) {
      // Select a random category
      const categorySlugs = Object.keys(categoryMap);
      const randomCategorySlug = categorySlugs[Math.floor(Math.random() * categorySlugs.length)];
      const categoryId = categoryMap[randomCategorySlug];
      
      // Generate product data
      const productData = generateProductData(
        categoryId, 
        i, 
        randomCategorySlug.replace('-', ' ')
      );
      
      // Add product to database
      try {
        const existing = await Product.findOne({ sku: productData.sku });
        if (!existing) {
          const product = new Product(productData);
          await product.save();
          addedCount++;
          
          if (addedCount % 50 === 0) {
            console.log(`Added ${addedCount} products so far...`);
          }
        }
      } catch (error) {
        console.error(`Error adding product ${productData.sku}:`, error.message);
      }
      
      // Add a small delay every 100 products to prevent overwhelming the database
      if (i % 100 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`\nSuccessfully added ${addedCount} new products to the database.`);
    
    // Verify count
    const totalProductsInDB = await Product.countDocuments({});
    console.log(`Total products in database: ${totalProductsInDB}`);
    
    // Show category breakdown
    console.log('\n--- Category Breakdown ---');
    for (const category of categories) {
      const count = await Product.countDocuments({ categories: category._id });
      console.log(`${category.name}: ${count} products`);
    }
    
    // Close connection
    await mongoose.connection.close();
    console.log('\n✓ Disconnected from MongoDB');
    
  } catch (error) {
    console.error('✗ Error bulk importing products:', error.message);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

bulkImportProducts();