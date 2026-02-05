import express from "express";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import CronService from "../services/cronService.js";

const router = express.Router();

// Since we need to access the cron service instance from server.js,
// we'll need to pass it when registering this router
let cronServiceInstance = null;

export const setCronService = (cronService) => {
  cronServiceInstance = cronService;
};

// @route   GET /scheduled-tasks
// @desc    Get all scheduled tasks
// @access  Private/Admin
router.get("/", protect, admin, asyncHandler(async (req, res) => {
  try {
    if (!cronServiceInstance) {
      return res.status(500).json({
        success: false,
        message: 'Cron service not initialized'
      });
    }
    
    const tasks = cronServiceInstance.getScheduledTasks();
    
    res.json({
      success: true,
      tasks
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get scheduled tasks',
      error: error.message
    });
  }
}));

// @route   POST /scheduled-tasks/cancel/:taskName
// @desc    Cancel a scheduled task
// @access  Private/Admin
router.post("/cancel/:taskName", protect, admin, asyncHandler(async (req, res) => {
  try {
    if (!cronServiceInstance) {
      return res.status(500).json({
        success: false,
        message: 'Cron service not initialized'
      });
    }
    
    const { taskName } = req.params;
    const result = cronServiceInstance.cancelScheduledTask(taskName);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Task cancelled successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to cancel scheduled task',
      error: error.message
    });
  }
}));

// @route   POST /scheduled-tasks/run/:taskName
// @desc    Manually run a scheduled task
// @access  Private/Admin
router.post("/run/:taskName", protect, admin, asyncHandler(async (req, res) => {
  try {
    if (!cronServiceInstance) {
      return res.status(500).json({
        success: false,
        message: 'Cron service not initialized'
      });
    }
    
    const { taskName } = req.params;
    
    if (taskName === 'failedProductImport') {
      const result = await cronServiceInstance.runFailedProductImport();
      
      if (result.success) {
        // Log audit event
        auditLogger.logAction(
          req,
          'UPDATE',
          'ScheduledTask',
          null,
          { action: 'RUN_MANUAL', taskName },
          'SUCCESS'
        );

        res.json({
          success: true,
          message: 'Failed product import task executed successfully',
          result: result
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Failed to execute failed product import task',
          error: result.error
        });
      }
    } else {
      res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to run scheduled task',
      error: error.message
    });
  }
}));

export default router;