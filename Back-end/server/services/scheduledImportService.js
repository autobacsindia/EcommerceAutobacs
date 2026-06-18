import ProductImportService from './productImportService.js';

class ScheduledImportService {
  constructor() {
    this.importService = new ProductImportService();
    this.scheduledImports = [];
  }

  /**
   * Schedule a recurring import
   * @param {String} frequency - How often to run (daily, weekly, monthly)
   * @param {String} time - Time to run (HH:MM format)
   * @param {ObjectId} initiatedBy - User ID who scheduled the import
   * @returns {Object} Schedule information
   */
  async scheduleImport(frequency, time, initiatedBy) {
    try {
      // In a real implementation, we would use a job scheduler like node-cron or agenda
      // For now, we'll just store the schedule information
      
      const schedule = {
        id: `schedule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        frequency,
        time,
        initiatedBy,
        createdAt: new Date(),
        enabled: true
      };
      
      this.scheduledImports.push(schedule);
      
      return {
        success: true,
        schedule
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get all scheduled imports
   * @returns {Array} List of scheduled imports
   */
  getScheduledImports() {
    return this.scheduledImports.filter(schedule => schedule.enabled);
  }

  /**
   * Cancel a scheduled import
   * @param {String} scheduleId - ID of the schedule to cancel
   * @returns {Object} Result of cancellation
   */
  cancelScheduledImport(scheduleId) {
    try {
      const scheduleIndex = this.scheduledImports.findIndex(s => s.id === scheduleId);
      
      if (scheduleIndex === -1) {
        return {
          success: false,
          message: 'Schedule not found'
        };
      }
      
      this.scheduledImports[scheduleIndex].enabled = false;
      
      return {
        success: true,
        message: 'Schedule cancelled successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Run a scheduled import
   * @param {ObjectId} initiatedBy - User ID who initiated the import
   * @returns {Object} Import result
   */
  async runScheduledImport(initiatedBy) {
    try {
      const jobId = `scheduled-import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Run the import
      const importResult = await this.importService.importAllProducts(
        jobId, 
        initiatedBy,
        (progress) => {
          console.log(`Scheduled import progress: ${progress.progress}%`);
        }
      );
      
      return importResult;
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default ScheduledImportService;