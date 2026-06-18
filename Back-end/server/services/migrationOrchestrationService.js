import ProductImportService from './productImportService.js';
import CategoryImportService from './categoryImportService.js';
import importJobRepository from '../repositories/importJobRepository.js';

class MigrationOrchestrationService {
  constructor() {
    this.productImportService = new ProductImportService();
    this.categoryImportService = new CategoryImportService();
  }

  /**
   * Execute a complete migration (categories first, then products)
   * @param {String} jobId - ID of the import job for tracking
   * @param {ObjectId} initiatedBy - User ID who initiated the import
   * @param {Function} progressCallback - Callback function to report progress
   * @returns {Object} Migration result
   */
  async executeFullMigration(jobId, initiatedBy, progressCallback = null) {
    let importJob = null;
    
    try {
      // Create or update import job tracking
      importJob = await importJobRepository.findOne({ jobId });
      
      if (!importJob) {
        importJob = importJobRepository.build({
          jobId,
          initiatedBy,
          source: 'wordpress',
          status: 'running',
          startedAt: new Date()
        });
      } else {
        importJob.status = 'running';
        importJob.startedAt = new Date();
      }
      
      await importJob.save();
      
      // Report initial progress
      if (progressCallback) {
        progressCallback({
          phase: 'initialization',
          message: 'Starting full migration process'
        });
      }
      
      // Phase 1: Import categories
      if (progressCallback) {
        progressCallback({
          phase: 'categories',
          message: 'Starting category import'
        });
      }
      
      const categoryImportResult = await this.categoryImportService.importAllCategories(
        (progress) => {
          if (progressCallback) {
            progressCallback({
              phase: 'categories',
              progress: progress,
              message: `Importing categories: ${progress.processed}/${progress.total}`
            });
          }
        }
      );
      
      if (!categoryImportResult.success) {
        throw new Error(`Category import failed: ${categoryImportResult.error}`);
      }
      
      // Update job with category import results
      importJob.metadata = importJob.metadata || {};
      importJob.metadata.categoryImport = categoryImportResult.summary;
      await importJob.save();
      
      if (progressCallback) {
        progressCallback({
          phase: 'categories',
          message: `Category import completed: ${categoryImportResult.summary.imported} imported, ${categoryImportResult.summary.failed} failed`
        });
      }
      
      // Phase 2: Import products
      if (progressCallback) {
        progressCallback({
          phase: 'products',
          message: 'Starting product import'
        });
      }
      
      const productImportResult = await this.productImportService.importAllProducts(
        jobId,
        initiatedBy,
        (progress) => {
          if (progressCallback) {
            progressCallback({
              phase: 'products',
              progress: progress,
              message: `Importing products: ${progress.imported}/${progress.totalProducts} imported`
            });
          }
        }
      );
      
      if (!productImportResult.success) {
        throw new Error(`Product import failed: ${productImportResult.error}`);
      }
      
      // Mark job as completed
      importJob.status = 'completed';
      importJob.completedAt = new Date();
      importJob.progress = 100;
      importJob.metadata = importJob.metadata || {};
      importJob.metadata.productImport = productImportResult.summary;
      await importJob.save();
      
      return {
        success: true,
        jobId: importJob.jobId,
        summary: {
          categories: categoryImportResult.summary,
          products: productImportResult.summary
        }
      };
    } catch (error) {
      // Mark job as failed
      if (importJob) {
        importJob.status = 'failed';
        importJob.failedAt = new Date();
        importJob.errorMessage = error.message;
        await importJob.save();
      }
      
      return {
        success: false,
        jobId: importJob ? importJob.jobId : null,
        error: error.message
      };
    }
  }

  /**
   * Execute category-only migration
   * @param {String} jobId - ID of the import job for tracking
   * @param {ObjectId} initiatedBy - User ID who initiated the import
   * @param {Function} progressCallback - Callback function to report progress
   * @returns {Object} Migration result
   */
  async executeCategoryMigration(jobId, initiatedBy, progressCallback = null) {
    let importJob = null;
    
    try {
      // Create or update import job tracking
      importJob = await importJobRepository.findOne({ jobId });
      
      if (!importJob) {
        importJob = importJobRepository.build({
          jobId,
          initiatedBy,
          source: 'wordpress',
          status: 'running',
          startedAt: new Date()
        });
      } else {
        importJob.status = 'running';
        importJob.startedAt = new Date();
      }
      
      await importJob.save();
      
      // Report initial progress
      if (progressCallback) {
        progressCallback({
          phase: 'initialization',
          message: 'Starting category migration process'
        });
      }
      
      // Import categories
      if (progressCallback) {
        progressCallback({
          phase: 'categories',
          message: 'Starting category import'
        });
      }
      
      const categoryImportResult = await this.categoryImportService.importAllCategories(
        (progress) => {
          if (progressCallback) {
            progressCallback({
              phase: 'categories',
              progress: progress,
              message: `Importing categories: ${progress.processed}/${progress.total}`
            });
          }
        }
      );
      
      if (!categoryImportResult.success) {
        throw new Error(`Category import failed: ${categoryImportResult.error}`);
      }
      
      // Mark job as completed
      importJob.status = 'completed';
      importJob.completedAt = new Date();
      importJob.progress = 100;
      importJob.metadata = importJob.metadata || {};
      importJob.metadata.categoryImport = categoryImportResult.summary;
      await importJob.save();
      
      return {
        success: true,
        jobId: importJob.jobId,
        summary: categoryImportResult.summary
      };
    } catch (error) {
      // Mark job as failed
      if (importJob) {
        importJob.status = 'failed';
        importJob.failedAt = new Date();
        importJob.errorMessage = error.message;
        await importJob.save();
      }
      
      return {
        success: false,
        jobId: importJob ? importJob.jobId : null,
        error: error.message
      };
    }
  }

  /**
   * Execute product-only migration
   * @param {String} jobId - ID of the import job for tracking
   * @param {ObjectId} initiatedBy - User ID who initiated the import
   * @param {Function} progressCallback - Callback function to report progress
   * @returns {Object} Migration result
   */
  async executeProductMigration(jobId, initiatedBy, progressCallback = null) {
    let importJob = null;
    
    try {
      // Create or update import job tracking
      importJob = await importJobRepository.findOne({ jobId });
      
      if (!importJob) {
        importJob = importJobRepository.build({
          jobId,
          initiatedBy,
          source: 'wordpress',
          status: 'running',
          startedAt: new Date()
        });
      } else {
        importJob.status = 'running';
        importJob.startedAt = new Date();
      }
      
      await importJob.save();
      
      // Report initial progress
      if (progressCallback) {
        progressCallback({
          phase: 'initialization',
          message: 'Starting product migration process'
        });
      }
      
      // Import products
      if (progressCallback) {
        progressCallback({
          phase: 'products',
          message: 'Starting product import'
        });
      }
      
      const productImportResult = await this.productImportService.importAllProducts(
        jobId,
        initiatedBy,
        (progress) => {
          if (progressCallback) {
            progressCallback({
              phase: 'products',
              progress: progress,
              message: `Importing products: ${progress.imported}/${progress.totalProducts} imported`
            });
          }
        }
      );
      
      if (!productImportResult.success) {
        throw new Error(`Product import failed: ${productImportResult.error}`);
      }
      
      // Mark job as completed
      importJob.status = 'completed';
      importJob.completedAt = new Date();
      importJob.progress = 100;
      importJob.metadata = importJob.metadata || {};
      importJob.metadata.productImport = productImportResult.summary;
      await importJob.save();
      
      return {
        success: true,
        jobId: importJob.jobId,
        summary: productImportResult.summary
      };
    } catch (error) {
      // Mark job as failed
      if (importJob) {
        importJob.status = 'failed';
        importJob.failedAt = new Date();
        importJob.errorMessage = error.message;
        await importJob.save();
      }
      
      return {
        success: false,
        jobId: importJob ? importJob.jobId : null,
        error: error.message
      };
    }
  }
}

export default MigrationOrchestrationService;