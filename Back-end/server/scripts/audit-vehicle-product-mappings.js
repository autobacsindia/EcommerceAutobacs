/**
 * Audit Vehicle-Product Mapping Coverage
 * 
 * This script generates a comprehensive report on the current state of
 * vehicle-product associations in the database.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../models/Product.js';
import Vehicle from '../models/Vehicle.js';
import fs from 'fs';
import path from 'path';

dotenv.config();

class VehicleProductAudit {
  constructor() {
    this.report = {
      timestamp: new Date().toISOString(),
      database: {
        totalProducts: 0,
        productsWithVehicles: 0,
        productsWithoutVehicles: 0,
        totalVehicles: 0,
        activeVehicles: 0
      },
      vehicleStats: [],
      productStats: {
        minVehiclesPerProduct: 0,
        maxVehiclesPerProduct: 0,
        avgVehiclesPerProduct: 0
      },
      coverage: {
        vehiclesWithProducts: 0,
        vehiclesWithoutProducts: 0,
        percentageVehiclesCovered: 0,
        percentageProductsMapped: 0
      },
      issues: {
        vehiclesWithZeroProducts: [],
        vehiclesWithLowProducts: [], // Less than 20
        productsWithAllVehicles: [], // Mapped to all vehicles (likely error)
        orphanedProducts: []
      }
    };
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

  async auditDatabase() {
    console.log('\n=== AUDITING DATABASE ===\n');

    // Count totals
    this.report.database.totalProducts = await Product.countDocuments();
    this.report.database.productsWithVehicles = await Product.countDocuments({
      compatibleVehicles: { $exists: true, $ne: [] }
    });
    this.report.database.productsWithoutVehicles = 
      this.report.database.totalProducts - this.report.database.productsWithVehicles;

    this.report.database.totalVehicles = await Vehicle.countDocuments();
    this.report.database.activeVehicles = await Vehicle.countDocuments({ isActive: true });

    console.log(`Total Products: ${this.report.database.totalProducts}`);
    console.log(`Products with Vehicle Mappings: ${this.report.database.productsWithVehicles}`);
    console.log(`Products without Vehicle Mappings: ${this.report.database.productsWithoutVehicles}`);
    console.log(`Total Vehicles: ${this.report.database.totalVehicles}`);
    console.log(`Active Vehicles: ${this.report.database.activeVehicles}`);
  }

  async auditVehicles() {
    console.log('\n=== AUDITING VEHICLES ===\n');

    const vehicles = await Vehicle.find({ isActive: true }).lean();
    const totalVehicles = vehicles.length;

    for (const vehicle of vehicles) {
      const productCount = await Product.countDocuments({
        compatibleVehicles: vehicle._id,
        isActive: true
      });

      const vehicleData = {
        id: vehicle._id.toString(),
        name: `${vehicle.make} ${vehicle.model}`,
        slug: vehicle.slug,
        make: vehicle.make,
        model: vehicle.model,
        productCount: productCount
      };

      this.report.vehicleStats.push(vehicleData);

      // Identify issues
      if (productCount === 0) {
        this.report.issues.vehiclesWithZeroProducts.push(vehicleData);
      } else if (productCount < 20) {
        this.report.issues.vehiclesWithLowProducts.push(vehicleData);
      }

      // Track coverage
      if (productCount > 0) {
        this.report.coverage.vehiclesWithProducts++;
      } else {
        this.report.coverage.vehiclesWithoutProducts++;
      }

      console.log(`${vehicleData.name}: ${productCount} products`);
    }

    // Calculate coverage percentages
    if (totalVehicles > 0) {
      this.report.coverage.percentageVehiclesCovered = 
        (this.report.coverage.vehiclesWithProducts / totalVehicles * 100).toFixed(2);
    }

    if (this.report.database.totalProducts > 0) {
      this.report.coverage.percentageProductsMapped = 
        (this.report.database.productsWithVehicles / this.report.database.totalProducts * 100).toFixed(2);
    }
  }

  async auditProducts() {
    console.log('\n=== AUDITING PRODUCTS ===\n');

    const products = await Product.find({ compatibleVehicles: { $exists: true, $ne: [] } })
      .select('name sku compatibleVehicles')
      .lean();

    if (products.length === 0) {
      console.log('No products with vehicle mappings found');
      return;
    }

    const vehicleCounts = products.map(p => (p.compatibleVehicles || []).length);
    
    this.report.productStats.minVehiclesPerProduct = Math.min(...vehicleCounts);
    this.report.productStats.maxVehiclesPerProduct = Math.max(...vehicleCounts);
    this.report.productStats.avgVehiclesPerProduct = 
      (vehicleCounts.reduce((a, b) => a + b, 0) / vehicleCounts.length).toFixed(2);

    console.log(`Min Vehicles per Product: ${this.report.productStats.minVehiclesPerProduct}`);
    console.log(`Max Vehicles per Product: ${this.report.productStats.maxVehiclesPerProduct}`);
    console.log(`Avg Vehicles per Product: ${this.report.productStats.avgVehiclesPerProduct}`);

    // Check for products mapped to all vehicles (likely error)
    const totalActiveVehicles = this.report.database.activeVehicles;
    for (const product of products) {
      const vehicleCount = (product.compatibleVehicles || []).length;
      
      if (vehicleCount === totalActiveVehicles && totalActiveVehicles > 5) {
        this.report.issues.productsWithAllVehicles.push({
          id: product._id.toString(),
          name: product.name,
          sku: product.sku,
          vehicleCount: vehicleCount
        });
      }
    }

    if (this.report.issues.productsWithAllVehicles.length > 0) {
      console.log(`\n⚠ Warning: ${this.report.issues.productsWithAllVehicles.length} products mapped to ALL vehicles`);
    }
  }

  async generateSummary() {
    console.log('\n=== AUDIT SUMMARY ===\n');
    
    console.log('Coverage:');
    console.log(`- Vehicles with products: ${this.report.coverage.vehiclesWithProducts} (${this.report.coverage.percentageVehiclesCovered}%)`);
    console.log(`- Vehicles without products: ${this.report.coverage.vehiclesWithoutProducts}`);
    console.log(`- Products with vehicle mappings: ${this.report.coverage.percentageProductsMapped}%`);

    console.log('\nIssues Identified:');
    console.log(`- Vehicles with ZERO products: ${this.report.issues.vehiclesWithZeroProducts.length}`);
    console.log(`- Vehicles with LOW products (<20): ${this.report.issues.vehiclesWithLowProducts.length}`);
    console.log(`- Products mapped to ALL vehicles: ${this.report.issues.productsWithAllVehicles.length}`);

    console.log('\nTop 5 Vehicles by Product Count:');
    const topVehicles = [...this.report.vehicleStats]
      .sort((a, b) => b.productCount - a.productCount)
      .slice(0, 5);
    
    topVehicles.forEach((v, idx) => {
      console.log(`  ${idx + 1}. ${v.name}: ${v.productCount} products`);
    });

    console.log('\nBottom 5 Vehicles by Product Count:');
    const bottomVehicles = [...this.report.vehicleStats]
      .sort((a, b) => a.productCount - b.productCount)
      .slice(0, 5);
    
    bottomVehicles.forEach((v, idx) => {
      console.log(`  ${idx + 1}. ${v.name}: ${v.productCount} products`);
    });
  }

  async saveReport() {
    const reportsDir = path.join(process.cwd(), 'reports');
    
    // Create reports directory if it doesn't exist
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const reportPath = path.join(reportsDir, `vehicle-product-audit-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(this.report, null, 2));
    
    console.log(`\n✓ Report saved to: ${reportPath}`);
    
    // Also save a summary markdown file
    const summaryPath = path.join(reportsDir, `vehicle-product-audit-${Date.now()}.md`);
    const summaryContent = this.generateMarkdownSummary();
    fs.writeFileSync(summaryPath, summaryContent);
    
    console.log(`✓ Summary saved to: ${summaryPath}`);
  }

  generateMarkdownSummary() {
    return `# Vehicle-Product Mapping Audit Report

**Generated**: ${this.report.timestamp}

## Overview

| Metric | Value |
|--------|-------|
| Total Products | ${this.report.database.totalProducts} |
| Products with Vehicle Mappings | ${this.report.database.productsWithVehicles} |
| Products without Mappings | ${this.report.database.productsWithoutVehicles} |
| Total Vehicles | ${this.report.database.totalVehicles} |
| Active Vehicles | ${this.report.database.activeVehicles} |

## Coverage Analysis

| Metric | Value |
|--------|-------|
| Vehicles with Products | ${this.report.coverage.vehiclesWithProducts} (${this.report.coverage.percentageVehiclesCovered}%) |
| Vehicles without Products | ${this.report.coverage.vehiclesWithoutProducts} |
| Products Mapped Percentage | ${this.report.coverage.percentageProductsMapped}% |

## Product Statistics

| Metric | Value |
|--------|-------|
| Min Vehicles per Product | ${this.report.productStats.minVehiclesPerProduct} |
| Max Vehicles per Product | ${this.report.productStats.maxVehiclesPerProduct} |
| Avg Vehicles per Product | ${this.report.productStats.avgVehiclesPerProduct} |

## Issues Identified

### Vehicles with Zero Products (${this.report.issues.vehiclesWithZeroProducts.length})

${this.report.issues.vehiclesWithZeroProducts.slice(0, 10).map(v => `- ${v.name} (${v.slug})`).join('\n') || 'None'}
${this.report.issues.vehiclesWithZeroProducts.length > 10 ? `\n... and ${this.report.issues.vehiclesWithZeroProducts.length - 10} more` : ''}

### Vehicles with Low Product Count (<20) (${this.report.issues.vehiclesWithLowProducts.length})

${this.report.issues.vehiclesWithLowProducts.slice(0, 10).map(v => `- ${v.name}: ${v.productCount} products`).join('\n') || 'None'}
${this.report.issues.vehiclesWithLowProducts.length > 10 ? `\n... and ${this.report.issues.vehiclesWithLowProducts.length - 10} more` : ''}

### Products Mapped to All Vehicles (${this.report.issues.productsWithAllVehicles.length})

${this.report.issues.productsWithAllVehicles.slice(0, 10).map(p => `- ${p.name} (SKU: ${p.sku})`).join('\n') || 'None'}
${this.report.issues.productsWithAllVehicles.length > 10 ? `\n... and ${this.report.issues.productsWithAllVehicles.length - 10} more` : ''}

## Top Vehicles by Product Count

${[...this.report.vehicleStats].sort((a, b) => b.productCount - a.productCount).slice(0, 10).map((v, idx) => `${idx + 1}. ${v.name}: ${v.productCount} products`).join('\n')}

## Bottom Vehicles by Product Count

${[...this.report.vehicleStats].sort((a, b) => a.productCount - b.productCount).slice(0, 10).map((v, idx) => `${idx + 1}. ${v.name}: ${v.productCount} products`).join('\n')}

## Recommendations

${this.report.coverage.percentageVehiclesCovered < 80 ? '- ⚠️ Vehicle coverage is below 80%. Run migration to populate vehicle-product associations.' : '- ✓ Vehicle coverage is acceptable.'}
${this.report.coverage.percentageProductsMapped < 60 ? '- ⚠️ Product mapping percentage is below 60%. Consider manual enrichment or migration improvement.' : '- ✓ Product mapping percentage is acceptable.'}
${this.report.issues.vehiclesWithZeroProducts.length > 0 ? `- ⚠️ ${this.report.issues.vehiclesWithZeroProducts.length} vehicles have no products. Manual assignment may be needed.` : '- ✓ All vehicles have at least one product.'}
${this.report.issues.productsWithAllVehicles.length > 0 ? `- ⚠️ ${this.report.issues.productsWithAllVehicles.length} products are mapped to ALL vehicles. Review these mappings.` : '- ✓ No products are incorrectly mapped to all vehicles.'}
`;
  }

  async run() {
    try {
      await this.connect();
      await this.auditDatabase();
      await this.auditVehicles();
      await this.auditProducts();
      await this.generateSummary();
      await this.saveReport();
      
      console.log('\n✓ Audit completed successfully!\n');
    } catch (error) {
      console.error('✗ Audit failed:', error);
      throw error;
    } finally {
      await this.disconnect();
    }
  }
}

// Run the audit
const audit = new VehicleProductAudit();
audit.run().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
