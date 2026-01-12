/**
 * Migrate Vehicle-Product Mappings from WordPress to Local Database
 * 
 * This script extracts vehicle-product associations from WordPress products
 * and creates explicit relationships in the local Product.compatibleVehicles field.
 * 
 * Data Sources:
 * 1. WordPress product tags containing vehicle names
 * 2. WordPress product categories containing vehicle information
 * 3. WordPress product names with vehicle identifiers
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../models/Product.js';
import Vehicle from '../models/Vehicle.js';
import WordPressAPIClient from '../utils/wordpressApiClient.js';

dotenv.config();

class VehicleProductMigration {
  constructor() {
    this.wpClient = new WordPressAPIClient();
    this.stats = {
      processedProducts: 0,
      mappingsCreated: 0,
      vehiclesMatched: 0,
      errors: [],
      vehicleMatches: {}
    };
  }

  /**
   * Extract vehicle identifiers from WordPress product
   */
  extractVehicleIdentifiers(wpProduct) {
    const identifiers = new Set();
    
    // Extract from tags
    if (wpProduct.tags && Array.isArray(wpProduct.tags)) {
      wpProduct.tags.forEach(tag => {
        if (tag.name) {
          const normalized = this.normalizeVehicleName(tag.name);
          if (normalized) identifiers.add(normalized);
        }
      });
    }
    
    // Extract from categories
    if (wpProduct.categories && Array.isArray(wpProduct.categories)) {
      wpProduct.categories.forEach(category => {
        if (category.name) {
          const normalized = this.normalizeVehicleName(category.name);
          if (normalized) identifiers.add(normalized);
        }
      });
    }
    
    // Extract from product name using patterns
    if (wpProduct.name) {
      const extracted = this.extractFromName(wpProduct.name);
      extracted.forEach(id => identifiers.add(id));
    }
    
    return Array.from(identifiers);
  }

  /**
   * Normalize vehicle name to match local database slugs
   */
  normalizeVehicleName(name) {
    if (!name || typeof name !== 'string') return null;
    
    // Convert to lowercase and replace spaces with hyphens
    let normalized = name.toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    
    // Filter out generic terms
    const genericTerms = ['accessories', 'parts', 'auto', 'car', 'vehicle', 'truck', 'suv'];
    if (genericTerms.includes(normalized)) return null;
    
    // Minimum length check
    if (normalized.length < 3) return null;
    
    return normalized;
  }

  /**
   * Extract vehicle identifiers from product name using patterns
   */
  extractFromName(productName) {
    const identifiers = [];
    
    // Common vehicle name patterns
    const patterns = [
      // Toyota Hilux, Ford Ranger, etc.
      /\b(toyota|ford|isuzu|mahindra|maruti|jeep|volkswagen|hyundai|kia|audi|bmw|mercedes|land\s*rover)\s+(hilux|ranger|dmax|v-cross|thar|jimny|wrangler|fortuner|polo|i20|carens|endeavour|defender|e-class)\b/gi,
      // Specific model mentions
      /\b(hilux|ranger|dmax|d-max|v-cross|thar|jimny|wrangler|fortuner|polo|endeavour|defender)\b/gi
    ];
    
    patterns.forEach(pattern => {
      const matches = productName.matchAll(pattern);
      for (const match of matches) {
        if (match[0]) {
          const normalized = this.normalizeVehicleName(match[0]);
          if (normalized) identifiers.push(normalized);
        }
      }
    });
    
    return identifiers;
  }

  /**
   * Match WordPress vehicle identifiers to local Vehicle documents
   */
  async matchVehicles(identifiers) {
    const matchedVehicles = [];
    
    for (const identifier of identifiers) {
      try {
        // Try exact slug match first
        let vehicle = await Vehicle.findOne({ 
          slug: identifier, 
          isActive: true 
        });
        
        if (!vehicle) {
          // Try partial match on make or model
          vehicle = await Vehicle.findOne({
            $or: [
              { make: { $regex: new RegExp(identifier, 'i') } },
              { model: { $regex: new RegExp(identifier, 'i') } },
              { slug: { $regex: new RegExp(identifier, 'i') } }
            ],
            isActive: true
          });
        }
        
        if (vehicle) {
          matchedVehicles.push(vehicle);
          this.stats.vehicleMatches[identifier] = this.stats.vehicleMatches[identifier] || 0;
          this.stats.vehicleMatches[identifier]++;
        }
      } catch (error) {
        console.error(`Error matching vehicle ${identifier}:`, error.message);
      }
    }
    
    return matchedVehicles;
  }

  /**
   * Process a single WordPress product
   */
  async processProduct(wpProduct) {
    try {
      // Find corresponding local product by externalId or SKU
      const localProduct = await Product.findOne({
        $or: [
          { externalId: wpProduct.id.toString() },
          { sku: wpProduct.sku }
        ]
      });
      
      if (!localProduct) {
        console.log(`Product not found in local DB: ${wpProduct.name} (WP ID: ${wpProduct.id})`);
        return { processed: false, reason: 'not_found' };
      }
      
      // Extract vehicle identifiers from WordPress product
      const identifiers = this.extractVehicleIdentifiers(wpProduct);
      
      if (identifiers.length === 0) {
        return { processed: true, mapped: 0 };
      }
      
      // Match identifiers to local vehicles
      const vehicles = await this.matchVehicles(identifiers);
      
      if (vehicles.length === 0) {
        return { processed: true, mapped: 0, reason: 'no_vehicle_match' };
      }
      
      // Add vehicles to product's compatibleVehicles array
      const vehicleIds = vehicles.map(v => v._id);
      const existingIds = localProduct.compatibleVehicles || [];
      
      // Only add new vehicle IDs
      const newIds = vehicleIds.filter(id => 
        !existingIds.some(existing => existing.toString() === id.toString())
      );
      
      if (newIds.length > 0) {
        localProduct.compatibleVehicles = [...existingIds, ...newIds];
        await localProduct.save();
        
        this.stats.mappingsCreated += newIds.length;
        this.stats.vehiclesMatched += newIds.length;
        
        console.log(`✓ Mapped ${newIds.length} vehicles to product: ${localProduct.name}`);
      }
      
      return { processed: true, mapped: newIds.length };
      
    } catch (error) {
      this.stats.errors.push({
        product: wpProduct.name,
        error: error.message
      });
      console.error(`Error processing product ${wpProduct.name}:`, error.message);
      return { processed: false, error: error.message };
    }
  }

  /**
   * Fetch all WordPress products with pagination
   */
  async fetchAllWordPressProducts() {
    console.log('Fetching WordPress products...');
    const allProducts = [];
    let page = 1;
    const perPage = 50;
    let hasMore = true;
    
    while (hasMore) {
      try {
        const products = await this.wpClient.getProducts({ page, per_page: perPage });
        
        if (!products || products.length === 0) {
          hasMore = false;
          break;
        }
        
        allProducts.push(...products);
        console.log(`Fetched page ${page}: ${products.length} products (Total: ${allProducts.length})`);
        
        if (products.length < perPage) {
          hasMore = false;
        }
        
        page++;
        
        // Add delay to respect API rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.error(`Error fetching page ${page}:`, error.message);
        hasMore = false;
      }
    }
    
    console.log(`✓ Fetched total of ${allProducts.length} WordPress products\n`);
    return allProducts;
  }

  /**
   * Run the migration
   */
  async migrate(dryRun = false) {
    console.log('=== Vehicle-Product Mapping Migration ===\n');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'PRODUCTION'}\n`);
    
    try {
      // Fetch all WordPress products
      const wpProducts = await this.fetchAllWordPressProducts();
      
      if (wpProducts.length === 0) {
        console.log('No WordPress products found. Exiting.');
        return this.stats;
      }
      
      // Get all local vehicles for reference
      const localVehicles = await Vehicle.find({ isActive: true });
      console.log(`Found ${localVehicles.length} active vehicles in local database\n`);
      
      // Process each product
      console.log('Processing products...\n');
      
      for (let i = 0; i < wpProducts.length; i++) {
        const wpProduct = wpProducts[i];
        this.stats.processedProducts++;
        
        if (!dryRun) {
          await this.processProduct(wpProduct);
        } else {
          // Dry run: just extract and log
          const identifiers = this.extractVehicleIdentifiers(wpProduct);
          if (identifiers.length > 0) {
            console.log(`Product: ${wpProduct.name}`);
            console.log(`  Identifiers: ${identifiers.join(', ')}`);
            const vehicles = await this.matchVehicles(identifiers);
            console.log(`  Matches: ${vehicles.map(v => `${v.make} ${v.model}`).join(', ')}\n`);
          }
        }
        
        // Progress indicator
        if (i % 10 === 0) {
          console.log(`Progress: ${i + 1}/${wpProducts.length} products processed`);
        }
      }
      
      console.log('\n=== Migration Complete ===\n');
      console.log('Statistics:');
      console.log(`  Products processed: ${this.stats.processedProducts}`);
      console.log(`  Mappings created: ${this.stats.mappingsCreated}`);
      console.log(`  Unique vehicles matched: ${Object.keys(this.stats.vehicleMatches).length}`);
      console.log(`  Errors: ${this.stats.errors.length}`);
      
      if (this.stats.errors.length > 0) {
        console.log('\nErrors:');
        this.stats.errors.slice(0, 10).forEach(err => {
          console.log(`  - ${err.product}: ${err.error}`);
        });
        if (this.stats.errors.length > 10) {
          console.log(`  ... and ${this.stats.errors.length - 10} more`);
        }
      }
      
      console.log('\nVehicle Match Summary:');
      Object.entries(this.stats.vehicleMatches)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .forEach(([identifier, count]) => {
          console.log(`  ${identifier}: ${count} products`);
        });
      
      return this.stats;
      
    } catch (error) {
      console.error('Migration failed:', error);
      throw error;
    }
  }
}

// Main execution
async function main() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });
    console.log('✓ Connected to MongoDB\n');
    
    const migration = new VehicleProductMigration();
    
    // Check command line arguments
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    
    if (dryRun) {
      console.log('Running in DRY RUN mode - no changes will be made\n');
    }
    
    const stats = await migration.migrate(dryRun);
    
    // Save migration report
    const fs = await import('fs');
    const reportPath = `./reports/vehicle-product-migration-${Date.now()}.json`;
    fs.default.writeFileSync(reportPath, JSON.stringify(stats, null, 2));
    console.log(`\nMigration report saved to: ${reportPath}`);
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n✓ Disconnected from MongoDB');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  main();
}

export default VehicleProductMigration;
