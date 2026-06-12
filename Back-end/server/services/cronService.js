import cron from 'node-cron';
import Redis from 'ioredis';
import ImportJob from '../models/ImportJob.js';
import mongoose from 'mongoose';

class CronService {
  constructor() {
    this.scheduledTasks = [];

    // Redis client for distributed locks — prevents duplicate job execution when
    // Railway runs multiple replicas or during rolling deploys where two instances
    // overlap. If Redis is unavailable, jobs run without locking (single-instance safe).
    this.redis = null;
    if (process.env.REDIS_URL) {
      try {
        this.redis = new Redis(process.env.REDIS_URL, {
          maxRetriesPerRequest: 1,
          enableReadyCheck: false,
          lazyConnect: true,
          tls: process.env.REDIS_URL?.startsWith('rediss://') ? {} : undefined,
        });
        this.redis.on('error', err =>
          console.warn('[CronService] Redis error:', err.message)
        );
      } catch (err) {
        console.warn('[CronService] Redis init failed — jobs will run without distributed locks:', err.message);
      }
    }
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

    // scheduleFailedProductImport() is intentionally NOT registered here.
    // The implementation used Math.random() to fake results and was removed.
    // Re-enable once wpIntegrationService re-import logic is wired up.

    if (process.env.NODE_ENV !== 'test') {
      console.log('Cron jobs initialized');
    }
  }

  /**
   * Schedule the failed product import job
   * Runs daily at 11:10 AM
   */
  scheduleFailedProductImport() {
    try {
      // Cron expression for 11:10 AM daily: minute(10) hour(11) day(*) month(*) dayOfWeek(*)
      const task = cron.schedule('10 11 * * *', async () => {
        console.log('Running scheduled failed product import job at 11:10 AM');
        await this.withDistributedLock(
          'cron:lock:failedProductImport',
          3600, // 1 hour TTL — job cleared long before next daily run at 11:10 AM
          () => this.runFailedProductImport()
        );
      }, {
        scheduled: true,
        timezone: "Asia/Kolkata" // Set appropriate timezone
      });

      this.scheduledTasks.push({
        name: 'failedProductImport',
        task: task,
        schedule: '10 11 * * *',
        description: 'Daily import of failed products at 11:10 AM'
      });

      console.log('Scheduled failed product import job for 11:10 AM daily');
    } catch (error) {
      console.error('Failed to schedule failed product import job:', error.message);
    }
  }

  /**
   * Stub — real implementation pending.
   * Previous version used Math.random() to fake 70% success; removed to prevent false reporting.
   * TODO: implement using wpIntegrationService to re-fetch products by WooCommerce ID.
   */
  async runFailedProductImport() {
    return {
      success: false,
      error: 'Not implemented: re-import logic has not been built yet.'
    };
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