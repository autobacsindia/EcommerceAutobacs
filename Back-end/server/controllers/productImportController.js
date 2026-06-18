import importJobRepository from '../repositories/importJobRepository.js';
import ProductImportService from '../services/productImportService.js';
import BrandProductImportService from '../services/brandProductImportService.js';
import ScheduledImportService from '../services/scheduledImportService.js';

// ── helpers ────────────────────────────────────────────────────────────────────

function makeJobId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// @route   POST /products/import/wordpress
// @desc    Import products from WordPress
// @access  Private/Admin
export async function importWordPressProducts(req, res) {
  const importService = new ProductImportService();
  const jobId = makeJobId('import');

  const importResult = await importService.importAllProducts(jobId, req.user._id, (progress) => {
    console.log(`Import progress: ${progress.progress}%`);
  });

  if (importResult.success) {
    return res.status(200).json({
      success: true,
      message: 'Products imported successfully',
      jobId: importResult.jobId,
      summary: importResult.summary,
    });
  }

  res.status(500).json({
    success: false,
    message: 'Failed to import products',
    jobId: importResult.jobId,
    error: importResult.error,
  });
}

// @route   GET /products/import/wordpress/missing
// @desc    List WordPress products not yet in the local DB
// @access  Private/Admin
export async function getMissingWordPressProducts(req, res) {
  const importService = new ProductImportService();
  const result = await importService.findMissingWordPressProducts();

  res.json({
    success: true,
    summary: {
      totalWordPressProducts: result.totalWordPressProducts,
      totalLocalProducts: result.totalLocalProducts,
      missingCount: result.missingCount,
    },
    missingProducts: result.missingProducts,
  });
}

// @route   GET /products/import/wordpress/preview
// @desc    Preview what a WordPress import would create/update
// @access  Private/Admin
export async function previewWordPressImport(req, res) {
  const importService = new ProductImportService();
  const result = await importService.previewImport();

  res.json({
    success: true,
    summary: {
      totalWordPressProducts: result.totalWordPressProducts,
      toCreateCount: result.toCreateCount,
      toUpdateCount: result.toUpdateCount,
      failedCount: result.failedCount,
    },
    toCreate: result.toCreate,
    toUpdate: result.toUpdate,
    failed: result.failed,
  });
}

// @route   POST /products/import/brand/:brandName
// @desc    Import products for a specific brand from WordPress
// @access  Private/Admin
export async function importBrandProducts(req, res) {
  const { brandName } = req.params;
  const importService = new BrandProductImportService();
  const jobId = makeJobId(`import-brand-${brandName}`);

  const importResult = await importService.importBrandProducts(
    jobId,
    brandName,
    req.user._id,
    (progress) => {
      console.log(`Import progress for ${brandName}: ${progress.progress}%`);
    }
  );

  if (importResult.success) {
    return res.status(200).json({
      success: true,
      message: `Products for brand ${brandName} imported successfully`,
      jobId: importResult.jobId,
      summary: importResult.summary,
    });
  }

  res.status(500).json({
    success: false,
    message: `Failed to import products for brand ${brandName}`,
    jobId: importResult.jobId,
    error: importResult.error,
  });
}

// @route   GET /products/import/status
// @desc    Get recent import job list
// @access  Private/Admin
export async function getImportStatus(req, res) {
  const importJobs = await importJobRepository.find({}).sort({ createdAt: -1 }).limit(10);

  if (!importJobs.length) {
    return res.json({ success: true, jobs: [], message: 'No import jobs found' });
  }

  res.json({ success: true, jobs: importJobs });
}

// @route   GET /products/import/status/:jobId
// @desc    Get a specific import job status
// @access  Private/Admin
export async function getImportJobStatus(req, res) {
  const importJob = await importJobRepository.findOne({ jobId: req.params.jobId });

  if (!importJob) {
    return res.status(404).json({ success: false, message: 'Import job not found' });
  }

  res.json({ success: true, job: importJob });
}

// @route   GET /products/import/schedule
// @desc    List all scheduled imports
// @access  Private/Admin
export async function getScheduledImports(req, res) {
  const scheduledImportService = new ScheduledImportService();
  const schedules = scheduledImportService.getScheduledImports();
  res.json({ success: true, schedules });
}

// @route   POST /products/import/schedule
// @desc    Schedule recurring imports
// @access  Private/Admin
export async function scheduleImport(req, res) {
  const { frequency, time } = req.body;

  if (!frequency || !time) {
    return res.status(400).json({
      success: false,
      message: 'Frequency and time are required',
    });
  }

  const scheduledImportService = new ScheduledImportService();
  const result = await scheduledImportService.scheduleImport(frequency, time, req.user._id);

  if (result.success) {
    return res.status(200).json({
      success: true,
      message: 'Import scheduled successfully',
      schedule: result.schedule,
    });
  }

  res.status(500).json({
    success: false,
    message: 'Failed to schedule import',
    error: result.error,
  });
}

// @route   POST /products/import/wordpress/full
// @desc    Import all products and categories from WordPress
// @access  Private/Admin
export async function importWordPressFull(req, res) {
  const MigrationOrchestrationService = (
    await import('../services/migrationOrchestrationService.js')
  ).default;
  const migrationService = new MigrationOrchestrationService();
  const jobId = makeJobId('import-full');

  const migrationResult = await migrationService.executeFullMigration(
    jobId,
    req.user._id,
    (progress) => {
      console.log(`Migration progress - ${progress.phase}: ${progress.message}`);
    }
  );

  if (migrationResult.success) {
    return res.status(200).json({
      success: true,
      message: 'Full migration completed successfully',
      jobId: migrationResult.jobId,
      summary: migrationResult.summary,
    });
  }

  res.status(500).json({
    success: false,
    message: 'Failed to complete full migration',
    jobId: migrationResult.jobId,
    error: migrationResult.error,
  });
}

// @route   POST /products/import/wordpress/categories
// @desc    Import only categories from WordPress
// @access  Private/Admin
export async function importWordPressCategories(req, res) {
  const MigrationOrchestrationService = (
    await import('../services/migrationOrchestrationService.js')
  ).default;
  const migrationService = new MigrationOrchestrationService();
  const jobId = makeJobId('import-categories');

  const migrationResult = await migrationService.executeCategoryMigration(
    jobId,
    req.user._id,
    (progress) => {
      console.log(`Category migration progress: ${progress.message}`);
    }
  );

  if (migrationResult.success) {
    return res.status(200).json({
      success: true,
      message: 'Category migration completed successfully',
      jobId: migrationResult.jobId,
      summary: migrationResult.summary,
    });
  }

  res.status(500).json({
    success: false,
    message: 'Failed to complete category migration',
    jobId: migrationResult.jobId,
    error: migrationResult.error,
  });
}
