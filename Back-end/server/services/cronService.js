import cron from 'node-cron';
import { getRedisClient } from './redisClient.js';
import importJobRepository from '../repositories/importJobRepository.js';
import { runWordPressSync } from './wordpressSyncService.js';

class CronService {
  constructor() {
    this.scheduledTasks = [];

    this.redis = getRedisClient();
  }

  /**
   * Run fn inside a Redis distributed lock.
   * - If the lock is already held by another instance, logs and returns immediately.
   * - Always releases the lock in a finally block so a crash cannot permanently block future runs.
   * - Falls back to running fn directly when Redis is unavailable (single-instance safe).
   */
  async withDistributedLock(lockKey, ttlSeconds, fn) {
    if (!this.redis) {
      return fn();
    }

    const acquired = await this.redis.set(lockKey, '1', 'NX', 'EX', ttlSeconds).catch(() => null);
    if (!acquired) {
      console.log(`[CronService] Lock '${lockKey}' held by another instance — skipping this run`);
      return;
    }

    try {
      return await fn();
    } finally {
      await this.redis.del(lockKey).catch(err =>
        console.warn(`[CronService] Failed to release lock '${lockKey}':`, err.message)
      );
    }
  }

  /**
   * Initialize all cron jobs
   */
  initializeCronJobs() {
    if (process.env.NODE_ENV !== 'test') {
      console.log('Initializing cron jobs...');
    }

    this.scheduleWordPressSync();

    if (process.env.NODE_ENV !== 'test') {
      console.log('Cron jobs initialized');
    }
  }

  /**
   * Schedule the WordPress → MongoDB sync.
   *
   * TRANSITIONAL: keeps Mongo in step with WordPress while WP is still the place
   * content is edited. Once WP is decommissioned, delete this job + the service.
   *
   * Safety:
   *   • OFF unless WP_SYNC_ENABLED=true — never auto-writes to prod by surprise.
   *   • schedule from WP_SYNC_CRON (default every 6h); timezone Asia/Kolkata.
   *   • runs inside a Redis distributed lock so overlapping replicas don't double-run.
   *   • the sync itself is idempotent + non-destructive (upsert only).
   */
  scheduleWordPressSync() {
    if (process.env.WP_SYNC_ENABLED !== 'true') {
      if (process.env.NODE_ENV !== 'test') {
        console.log('[CronService] WordPress sync cron disabled (set WP_SYNC_ENABLED=true to enable)');
      }
      return;
    }
    const schedule = process.env.WP_SYNC_CRON || '0 */6 * * *'; // every 6 hours
    if (!cron.validate(schedule)) {
      console.error(`[CronService] Invalid WP_SYNC_CRON "${schedule}" — WordPress sync NOT scheduled`);
      return;
    }
    try {
      const task = cron.schedule(schedule, () =>
        this.withDistributedLock('cron:lock:wordpressSync', 3 * 3600, () => this.executeWordPressSync()),
        { scheduled: true, timezone: process.env.WP_SYNC_TZ || 'Asia/Kolkata' }
      );
      this.scheduledTasks.push({
        name: 'wordpressSync',
        task,
        schedule,
        description: 'WordPress → MongoDB sync (transitional)',
      });
      console.log(`[CronService] WordPress sync scheduled: "${schedule}"`);
    } catch (error) {
      console.error('[CronService] Failed to schedule WordPress sync:', error.message);
    }
  }

  /**
   * Run one WordPress → MongoDB sync, tracked as an ImportJob for observability.
   * Returns { success, stats }. Never throws — failures are recorded, not fatal.
   */
  async executeWordPressSync() {
    const jobId = `wp-sync-${Date.now()}`;
    let job = null;
    try {
      job = await importJobRepository.create({ jobId, source: 'scheduled', status: 'running', startedAt: new Date() });
    } catch (err) {
      console.warn('[CronService] Could not create ImportJob record:', err.message);
    }
    console.log(`[CronService] WordPress sync started (job ${jobId})`);
    try {
      const withImages = process.env.WP_SYNC_IMAGES !== 'false';
      const { ok, stats, durationMs } = await runWordPressSync({ dryRun: false, withImages, logger: console });
      if (job) {
        job.status = 'completed';
        job.completedAt = new Date();
        job.totalProducts = stats.products.fetched;
        job.processedProducts = stats.products.inserted + stats.products.updated;
        job.importedProducts = stats.products.inserted + stats.products.updated;
        job.failedProducts = stats.products.failed + stats.categories.failed;
        job.progress = 100;
        if (!ok) job.errorMessage = 'Verification incomplete (un-migrated images remain) — re-run will retry';
        await job.save().catch(() => {});
      }
      console.log(`[CronService] WordPress sync ${ok ? 'completed' : 'completed with warnings'} in ${(durationMs / 1000).toFixed(1)}s`);
      return { success: ok, stats };
    } catch (err) {
      console.error('[CronService] WordPress sync failed:', err.message);
      if (job) {
        job.status = 'failed';
        job.failedAt = new Date();
        job.errorMessage = err.message;
        await job.save().catch(() => {});
      }
      return { success: false, error: err.message };
    }
  }

  /**
   * Stop all scheduled tasks
   */
  shutdown() {
    if (process.env.NODE_ENV !== 'test') {
      console.log('Stopping all cron jobs...');
    }
    this.scheduledTasks.forEach(item => {
      if (item.task) {
        item.task.stop();
      }
    });
    this.scheduledTasks = [];
    if (process.env.NODE_ENV !== 'test') {
      console.log('All cron jobs stopped');
    }
  }

  /**
   * Get all scheduled tasks
   * @returns {Array} List of scheduled tasks
   */
  getScheduledTasks() {
    return this.scheduledTasks;
  }

  /**
   * Cancel a scheduled task
   * @param {String} taskName - Name of the task to cancel
   * @returns {Object} Result of cancellation
   */
  cancelScheduledTask(taskName) {
    try {
      const taskIndex = this.scheduledTasks.findIndex(t => t.name === taskName);
      
      if (taskIndex === -1) {
        return {
          success: false,
          message: 'Task not found'
        };
      }
      
      const task = this.scheduledTasks[taskIndex];
      task.task.stop();
      
      this.scheduledTasks.splice(taskIndex, 1);
      
      return {
        success: true,
        message: 'Task cancelled successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default CronService;