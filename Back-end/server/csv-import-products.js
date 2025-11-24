import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from './models/Product.js';
import Category from './models/Category.js';
import fs from 'fs';
import path from 'path';

dotenv.config();

console.log('CSV product import script initialized...');

// Simple slug generator function
function generateSlug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Parse CSV line
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"' && !inQuotes) {
      inQuotes = true;
    } else if (char === '"' && inQuotes) {
      inQuotes = false;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

// Create sample CSV file if it doesn't exist
function createSampleCSV() {
  const csvContent = `name,description,shortDescription,price,originalPrice,category,brand,stock,sku,tags,specifications
"Premium Brake Pads","High-performance brake pads with low dust formulation","High-quality brake pads",89.99,99.99,"Brake System","Autobacs",50,"BP-CSV-001","brake,performance,pads","Material:Ceramic,Width:120mm,Height:50mm"
"Engine Oil Filter","High-quality oil filter for engine protection","Standard oil filter",24.99,,,"Engine Parts","Autobacs",100,"EOF-CSV-001","engine,oil,filter","Filter Type:Spin-on,Thread Size:3/4-16,Flow Rate:15 GPM"
"Car Battery","Reliable car battery for all weather conditions","12V car battery",129.99,,,"Electronics","Autobacs",25,"CB-CSV-001","battery,electronics,power","Voltage:12V,Amp Hours:60Ah,Cold Cranking Amps:550 CCA"
"Air Filter","High-flow air filter for improved engine performance","Engine air filter",19.99,,,"Filters","Autobacs",75,"AF-CSV-001","air,filter,engine","Filter Type:Pleated Paper,Size:8.5x3.5,Air Flow:350 CFM"
"Spark Plugs","Iridium spark plugs for optimal ignition","Set of 4 spark plugs",39.99,,,"Engine Parts","Autobacs",60,"SP-CSV-001","spark,plugs,ignition","Plug Type:Iridium,Thread Size:14mm,Heat Range:7"`;

  const csvPath = path.join(process.cwd(), 'sample-products.csv');
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, csvContent);
    console.log('Created sample CSV file: sample-products.csv');
  }
  return csvPath;
}

async function importProductsFromCSV(csvFilePath) {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });
    
    console.log('✓ Connected to MongoDB');
    
    // Check if CSV file exists
    if (!fs.existsSync(csvFilePath)) {
      console.log(`CSV file not found: ${csvFilePath}`);
      console.log('Creating sample CSV file...');
      csvFilePath = createSampleCSV();
    }
    
    // Read CSV file
    const csvData = fs.readFileSync(csvFilePath, 'utf8');
    const lines = csvData.split('\n').filter(line => line.trim() !== '');
    
    if (lines.length < 2) {
      console.log('CSV file is empty or invalid');
      process.exit(1);
    }
    
    // Parse header
    const headers = parseCSVLine(lines[0]);
    console.log('CSV Headers:', headers);
    
    // Get all categories
    const categories = await Category.find({});
    const categoryMap = {};
    categories.forEach(cat => {
      categoryMap[cat.name.toLowerCase()] = cat._id;
    });
    
    console.log(`Found ${categories.length} categories in database`);
    
    // Process each line
    let addedCount = 0;
    let skippedCount = 0;
    
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length !== headers.length) {
        console.log(`Skipping line ${i + 1}: Column count mismatch`);
        skippedCount++;
        continue;
      }
      
      // Create product object
      const productData = {};
      for (let j = 0; j < headers.length; j++) {
        const header = headers[j];
        let value = values[j];
        
        // Handle special fields
        switch (header) {
          case 'price':
          case 'originalPrice':
            productData[header] = value ? parseFloat(value) : undefined;
            break;
          case 'stock':
            productData[header] = parseInt(value) || 0;
            break;
          case 'category':
            // Find category by name
            const categoryId = categoryMap[value.toLowerCase()];
            if (categoryId) {
              productData[header] = categoryId;
            } else {
              console.log(`Warning: Category "${value}" not found for product "${productData.name || 'Unknown'}"`);
            }
            break;
          case 'tags':
            productData[header] = value ? value.split(',').map(tag => tag.trim()) : [];
            break;
          case 'specifications':
            if (value) {
              const specs = [];
              const specPairs = value.split(',');
              for (const pair of specPairs) {
                const [key, val] = pair.split(':').map(str => str.trim());
                if (key && val) {
                  specs.push({ key, value: val });
                }
              }
              productData[header] = specs;
            } else {
              productData[header] = [];
            }
            break;
          default:
            productData[header] = value || undefined;
        }
      }
      
      // Add required fields
      productData.isActive = true;
      productData.images = [{ 
        url: `https://example.com/${productData.sku || `product-${i}`}.jpg`, 
        alt: `${productData.name} image` 
      }];
      
      // Add product to database
      try {
        if (productData.sku) {
          const existing = await Product.findOne({ sku: productData.sku });
          if (!existing) {
            const product = new Product(productData);
            await product.save();
            addedCount++;
            console.log(`Added product: ${productData.name}`);
          } else {
            console.log(`Product already exists: ${productData.name}`);
            skippedCount++;
          }
        } else {
          console.log(`Skipping product at line ${i + 1}: Missing SKU`);
          skippedCount++;
        }
      } catch (error) {
        console.error(`Error adding product "${productData.name}":`, error.message);
        skippedCount++;
      }
    }
    
    console.log(`\nImport complete! Added: ${addedCount}, Skipped: ${skippedCount}`);
    
    // Verify count
    const totalProducts = await Product.countDocuments({});
    console.log(`Total products in database: ${totalProducts}`);
    
    // Close connection
    await mongoose.connection.close();
    console.log('\n✓ Disconnected from MongoDB');
    
  } catch (error) {
    console.error('✗ Error importing products from CSV:', error.message);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

// Get CSV file path from command line arguments or use default
const csvFilePath = process.argv[2] || path.join(process.cwd(), 'sample-products.csv');
importProductsFromCSV(csvFilePath);