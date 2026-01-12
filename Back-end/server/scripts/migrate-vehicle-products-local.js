/**
 * Migrate Vehicle-Product Mappings from Local Product Data
 * 
 * This script extracts vehicle-product associations from existing local product data
 * using product names, tags, and existing metadata to determine vehicle compatibility.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../models/Product.js';
import Vehicle from '../models/Vehicle.js';
import fs from 'fs';
import path from 'path';

dotenv.config();

class VehicleProductMigrationLocal {
  constructor() {
    this.stats = {
      timestamp: new Date().toISOString(),
      processedProducts: 0,
      mappingsCreated: 0,
      vehiclesMatched: new Set(),
      errors: [],
      vehicleMatches: {}
    };
    
    // Vehicle name patterns for extraction
    this.vehiclePatterns = [
      // Full brand + model patterns
      { pattern: /\b(toyota)\s+(hilux|fortuner|innova|prado|land\s*cruiser|camry|corolla)\b/gi, group: 'brand-model' },
      { pattern: /\b(mahindra)\s+(thar|scorpio|bolero|xylo|xuv)\b/gi, group: 'brand-model' },
      { pattern: /\b(isuzu)\s+(d-?max|v-?cross|mu-?x)\b/gi, group: 'brand-model' },
      { pattern: /\b(ford)\s+(ranger|endeavour|ecosport|figo)\b/gi, group: 'brand-model' },
      { pattern: /\b(jeep)\s+(wrangler|compass|meridian)\b/gi, group: 'brand-model' },
      { pattern: /\b(maruti|suzuki)\s+(jimny|swift|baleno|brezza)\b/gi, group: 'brand-model' },
      { pattern: /\b(volkswagen)\s+(polo|vento|tiguan)\b/gi, group: 'brand-model' },
      { pattern: /\b(hyundai)\s+(creta|venue|verna|i20|tucson)\b/gi, group: 'brand-model' },
      { pattern: /\b(kia)\s+(seltos|sonet|carens)\b/gi, group: 'brand-model' },
      { pattern: /\b(audi)\s+(q[357]|a[34678])\b/gi, group: 'brand-model' },
      { pattern: /\b(bmw)\s+(x[1-7]|[1-7]\s*series|m[2-8]|[gx]\d+)\b/gi, group: 'brand-model' },
      { pattern: /\b(mercedes|benz)\s*(g-?class|e-?class|c-?class|s-?class|gla|glc|gle)\b/gi, group: 'brand-model' },
      { pattern: /\b(land\s*rover)\s+(defender|discovery|range\s*rover)\b/gi, group: 'brand-model' },
      
      // Standalone model patterns (high specificity)
      { pattern: /\bhilux\b/gi, brand: 'Toyota', model: 'Hilux' },
      { pattern: /\bthar(?:\s+roxx)?\b/gi, brand: 'Mahindra', model: 'Thar' },
      { pattern: /\bjimny\b/gi, brand: 'Maruti', model: 'Jimny' },
      { pattern: /\bwrangler\b/gi, brand: 'Jeep', model: 'Wrangler' },
      { pattern: /\bfortuner\b/gi, brand: 'Toyota', model: 'Fortuner' },
      { pattern: /\bd-?max\b/gi, brand: 'Isuzu', model: 'D-Max' },
      { pattern: /\bv-?cross\b/gi, brand: 'Isuzu', model: 'D-Max' }, // V-Cross is variant of D-Max
      { pattern: /\branger\b/gi, brand: 'Ford', model: 'Ranger' },
      { pattern: /\bendeavour\b/gi, brand: 'Ford', model: 'Endeavour' },
      { pattern: /\bdefender\b/gi, brand: 'Land Rover', model: 'Defender' },
      { pattern: /\bcreta\b/gi, brand: 'Hyundai', model: 'Creta' },
      { pattern: /\bseltos\b/gi, brand: 'Kia', model: 'Seltos' },
      { pattern: /\bpolo\b/gi, brand: 'Volkswagen', model: 'Polo' },
      
      // BMW specific patterns
      { pattern: /\bF30\b/gi, brand: 'BMW', model: 'X5' }, // F30 is 3-series chassis code, map to generic BMW
      { pattern: /\bG82\b/gi, brand: 'BMW', model: 'X5' }, // G82 is M4 chassis code
    ];
  }

  async connect() {
    try {
      const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
      if (!uri) {
        throw new Error('MongoDB URI not found in environment variables');
      }
      await mongoose.connect(uri);
      console.log('✓ Connected to MongoDB');
    } catch (error) {
      console.error('✗ Failed to connect to MongoDB:', error.message);
      throw error;
    }
  }

  async disconnect() {
    await mongoose.connection.close();
    console.log('✓ Disconnected from MongoDB');
  }

  /**
   * Extract vehicle identifiers from product data
   */
  extractVehicleIdentifiers(product) {
    const identifiers = new Set();
    const searchText = `${product.name || ''} ${product.description || ''} ${(product.tags || []).join(' ')}`.toLowerCase();
    
    // Apply all patterns
    for (const patternDef of this.vehiclePatterns) {
      if (patternDef.group === 'brand-model') {
        // Extract brand-model combinations
        const matches = searchText.matchAll(patternDef.pattern);
        for (const match of matches) {
          if (match[1] && match[2]) {
            const brand = match[1].trim();
            const model = match[2].replace(/\s+/g, '-').trim();
            identifiers.add({ brand, model, source: 'pattern-match' });
          }
        }
      } else if (patternDef.brand && patternDef.model) {
        // Standalone model pattern
        if (patternDef.pattern.test(searchText)) {
          identifiers.add({ brand: patternDef.brand, model: patternDef.model, source: 'standalone-model' });
        }
      }
    }
    
    return Array.from(identifiers);
  }

  /**
   * Normalize vehicle name to match database slug format
   */
  normalizeToSlug(brand, model) {
    return `${brand}-${model}`
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }

  /**
   * Match extracted identifiers to local vehicles
   */
  async matchVehicles(identifiers) {
    const matchedVehicles = [];
    
    for (const identifier of identifiers) {
      try {
        const slug = this.normalizeToSlug(identifier.brand, identifier.model);
        
        // Try exact slug match
        let vehicle = await Vehicle.findOne({ 
          slug: slug,
          isActive: true 
        }).lean();
        
        // Try fuzzy match
        if (!vehicle) {
          vehicle = await Vehicle.findOne({
            $and: [
              {
                $or: [
                  { make: { $regex: new RegExp(identifier.brand, 'i') } },
                  { model: { $regex: new RegExp(identifier.model, 'i') } },
                  { slug: { $regex: new RegExp(slug, 'i') } }
                ]
              },
              { isActive: true }
            ]
          }).lean();
        }
        
        if (vehicle && !matchedVehicles.find(v => v._id.toString() === vehicle._id.toString())) {
          matchedVehicles.push(vehicle);
          
          // Track stats
          const vehicleKey = vehicle.slug;
          this.stats.vehicleMatches[vehicleKey] = (this.stats.vehicleMatches[vehicleKey] || 0) + 1;
        }
      } catch (error) {
        console.error(`Error matching vehicle ${identifier.brand} ${identifier.model}:`, error.message);
      }
    }
    
    return matchedVehicles;
  }

  /**
   * Process a single product
   */
  async processProduct(product, dryRun = false) {
    try {
      // Extract vehicle identifiers
      const identifiers = this.extractVehicleIdentifiers(product);
      
      if (identifiers.length === 0) {
        return { processed: true, mapped: 0 };
      }
      
      // Match to vehicles
      const vehicles = await this.matchVehicles(identifiers);
      
      if (vehicles.length === 0) {
        return { processed: true, mapped: 0, reason: 'no_match' };
      }
      
      if (!dryRun) {
        // Update product with vehicle associations
        const vehicleIds = vehicles.map(v => v._id);
        const existingIds = product.compatibleVehicles || [];
        
        // Only add new vehicle IDs
        const newIds = vehicleIds.filter(id => 
          !existingIds.some(existing => existing.toString() === id.toString())
        );
        
        if (newIds.length > 0) {
          product.compatibleVehicles = [...existingIds, ...newIds];
          await product.save();
          
          this.stats.mappingsCreated += newIds.length;
          newIds.forEach(id => {
            const vehicle = vehicles.find(v => v._id.toString() === id.toString());
            if (vehicle) {
              this.stats.vehiclesMatched.add(vehicle.slug);
            }
          });
        }
        
        return { processed: true, mapped: newIds.length };
      } else {
        // Dry run - just return what would be done
        return { 
          processed: true, 
          mapped: vehicles.length,
          vehicles: vehicles.map(v => `${v.make} ${v.model}`),
          identifiers: identifiers
        };
      }
      
    } catch (error) {
      this.stats.errors.push({
        productId: product._id,
        productName: product.name,
        error: error.message
      });
      return { processed: false, error: error.message };
    }
  }

  /**
   * Run the migration
   */
  async migrate(dryRun = false) {
    console.log('\n=== Vehicle-Product Mapping Migration (Local) ===\n');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'PRODUCTION'}\n`);
    
    try {
      // Get all active vehicles
      const vehicles = await Vehicle.find({ isActive: true }).lean();
      console.log(`Found ${vehicles.length} active vehicles\n`);
      
      // Get all active products
      const products = await Product.find({ isActive: true });
      console.log(`Found ${products.length} active products\n`);
      
      if (products.length === 0) {
        console.log('No products found. Exiting.');
        return this.stats;
      }
      
      console.log('Processing products...\n');
      
      let productsWithMappings = 0;
      
      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        this.stats.processedProducts++;
        
        const result = await this.processProduct(product, dryRun);
        
        if (result.mapped > 0) {
          productsWithMappings++;
          
          if (dryRun && i < 20) {
            console.log(`Product: ${product.name}`);
            console.log(`  Would map to: ${result.vehicles.join(', ')}`);
            console.log(`  Identifiers found: ${result.identifiers.map(id => `${id.brand} ${id.model}`).join(', ')}\n`);
          }
        }
        
        // Progress indicator
        if ((i + 1) % 100 === 0) {
          console.log(`Progress: ${i + 1}/${products.length} products processed`);
        }
      }
      
      console.log('\n=== Migration Complete ===\n');
      console.log('Statistics:');
      console.log(`  Products processed: ${this.stats.processedProducts}`);
      console.log(`  Products with mappings: ${productsWithMappings}`);
      console.log(`  Total mappings created: ${this.stats.mappingsCreated}`);
      console.log(`  Unique vehicles matched: ${this.stats.vehiclesMatched.size}`);
      console.log(`  Errors: ${this.stats.errors.length}`);
      
      if (this.stats.errors.length > 0) {
        console.log('\nFirst 10 Errors:');
        this.stats.errors.slice(0, 10).forEach(err => {
          console.log(`  - ${err.productName}: ${err.error}`);
        });
      }
      
      console.log('\nVehicle Match Summary:');
      Object.entries(this.stats.vehicleMatches)
        .sort((a, b) => b[1] - a[1])
        .forEach(([vehicle, count]) => {
          console.log(`  ${vehicle}: ${count} products`);
        });
      
      return {
        ...this.stats,
        vehiclesMatched: Array.from(this.stats.vehiclesMatched)
      };
      
    } catch (error) {
      console.error('Migration failed:', error);
      throw error;
    }
  }

  async saveReport(stats) {
    const reportsDir = path.join(process.cwd(), 'reports');
    
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const reportPath = path.join(reportsDir, `vehicle-product-migration-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(stats, null, 2));
    
    console.log(`\n✓ Migration report saved to: ${reportPath}`);
  }

  async run(dryRun = false) {
    try {
      await this.connect();
      const stats = await this.migrate(dryRun);
      await this.saveReport(stats);
      console.log('\n✓ Migration completed successfully!\n');
    } catch (error) {
      console.error('✗ Migration failed:', error);
      throw error;
    } finally {
      await this.disconnect();
    }
  }
}

// Main execution
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

const migration = new VehicleProductMigrationLocal();
migration.run(dryRun).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
