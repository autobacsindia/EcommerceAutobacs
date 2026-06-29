#!/usr/bin/env node

/**
 * WooCommerce Data Migration CLI Tool
 * 
 * This script provides a command-line interface for importing data from WooCommerce
 * to the Autobacs e-commerce platform.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { program } from 'commander';
import MigrationOrchestrationService from '../../services/migrationOrchestrationService.js';
import WooCommerceApiClient from '../../services/woocommerceApiClient.js';

// Load environment variables
dotenv.config();

// Debug: Print environment variables to verify they're loaded
console.log('WORDPRESS_SITE_URL:', process.env.WORDPRESS_SITE_URL);

// Connect to MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

// Mock user object for CLI operations
const mockUser = {
  _id: null, // Will be set to null for CLI operations
  role: 'admin'
};

program
  .name('woocommerce-migration')
  .description('CLI tool for migrating WooCommerce data to Autobacs')
  .version('1.0.0');

program
  .command('migrate-full')
  .description('Perform a full migration (categories and products)')
  .option('-j, --job-id <id>', 'Specify a custom job ID')
  .action(async (options) => {
    await connectDB();
    
    try {
      const migrationService = new MigrationOrchestrationService();
      const jobId = options.jobId || `cli-full-import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      console.log(`Starting full migration with job ID: ${jobId}`);
      
      const result = await migrationService.executeFullMigration(
        jobId,
        mockUser._id,
        (progress) => {
          console.log(`[${progress.phase}] ${progress.message}`);
        }
      );
      
      if (result.success) {
        console.log('✅ Full migration completed successfully!');
        console.log(`Job ID: ${result.jobId}`);
        console.log('Summary:');
        console.log(`  Categories: ${result.summary.categories.imported} imported, ${result.summary.categories.failed} failed`);
        console.log(`  Products: ${result.summary.products.imported} imported, ${result.summary.products.failed} failed`);
      } else {
        console.error('❌ Full migration failed:', result.error);
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Error during full migration:', error.message);
      process.exit(1);
    } finally {
      await mongoose.connection.close();
    }
  });

program
  .command('migrate-categories')
  .description('Migrate only categories')
  .option('-j, --job-id <id>', 'Specify a custom job ID')
  .action(async (options) => {
    await connectDB();
    
    try {
      const migrationService = new MigrationOrchestrationService();
      const jobId = options.jobId || `cli-category-import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      console.log(`Starting category migration with job ID: ${jobId}`);
      
      const result = await migrationService.executeCategoryMigration(
        jobId,
        mockUser._id,
        (progress) => {
          console.log(`${progress.message}`);
        }
      );
      
      if (result.success) {
        console.log('✅ Category migration completed successfully!');
        console.log(`Job ID: ${result.jobId}`);
        console.log('Summary:');
        console.log(`  Categories: ${result.summary.imported} imported, ${result.summary.failed} failed`);
      } else {
        console.error('❌ Category migration failed:', result.error);
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Error during category migration:', error.message);
      process.exit(1);
    } finally {
      await mongoose.connection.close();
    }
  });

program
  .command('migrate-products')
  .description('Migrate only products')
  .option('-j, --job-id <id>', 'Specify a custom job ID')
  .action(async (options) => {
    await connectDB();
    
    try {
      const migrationService = new MigrationOrchestrationService();
      const jobId = options.jobId || `cli-product-import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      console.log(`Starting product migration with job ID: ${jobId}`);
      
      const result = await migrationService.executeProductMigration(
        jobId,
        mockUser._id,
        (progress) => {
          console.log(`${progress.message}`);
        }
      );
      
      if (result.success) {
        console.log('✅ Product migration completed successfully!');
        console.log(`Job ID: ${result.jobId}`);
        console.log('Summary:');
        console.log(`  Products: ${result.summary.imported} imported, ${result.summary.failed} failed`);
      } else {
        console.error('❌ Product migration failed:', result.error);
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Error during product migration:', error.message);
      process.exit(1);
    } finally {
      await mongoose.connection.close();
    }
  });

program
  .command('status')
  .description('Check the status of recent import jobs')
  .option('-l, --limit <number>', 'Number of recent jobs to show', '10')
  .action(async (options) => {
    await connectDB();
    
    try {
      const ImportJob = (await import('../../models/ImportJob.js')).default;
      const limit = parseInt(options.limit);
      
      const jobs = await ImportJob.find({})
        .sort({ createdAt: -1 })
        .limit(limit);
      
      if (jobs.length === 0) {
        console.log('No import jobs found.');
        return;
      }
      
      console.log('Recent Import Jobs:');
      console.log('===================');
      
      jobs.forEach(job => {
        console.log(`Job ID: ${job.jobId}`);
        console.log(`Status: ${job.status}`);
        console.log(`Source: ${job.source}`);
        console.log(`Started: ${job.startedAt || 'N/A'}`);
        console.log(`Completed: ${job.completedAt || 'N/A'}`);
        console.log(`Progress: ${job.progress || 0}%`);
        
        if (job.metadata) {
          if (job.metadata.categoryImport) {
            console.log(`Categories: ${job.metadata.categoryImport.imported} imported, ${job.metadata.categoryImport.failed} failed`);
          }
          if (job.metadata.productImport) {
            console.log(`Products: ${job.metadata.productImport.imported} imported, ${job.metadata.productImport.failed} failed`);
          }
        }
        
        if (job.errorMessage) {
          console.log(`Error: ${job.errorMessage}`);
        }
        
        console.log('---');
      });
    } catch (error) {
      console.error('❌ Error fetching job status:', error.message);
      process.exit(1);
    } finally {
      await mongoose.connection.close();
    }
  });

program
  .command('test-connection')
  .description('Test connection to WooCommerce API')
  .action(async () => {
    try {
      console.log('Testing WooCommerce API connection...');
      const apiClient = new WooCommerceApiClient();
      console.log('API Client initialized successfully');
      console.log('Site URL:', apiClient.wordpressSiteUrl);
      
      // Test getting product count
      const productCount = await apiClient.getProductCount();
      console.log(`✅ Successfully connected to WooCommerce API`);
      console.log(`Total products: ${productCount}`);
      
      // Test getting category count
      const categoryCount = await apiClient.getCategoryCount();
      console.log(`Total categories: ${categoryCount}`);
    } catch (error) {
      console.error('❌ Failed to connect to WooCommerce API:', error.message);
      process.exit(1);
    }
  });

program.parse();