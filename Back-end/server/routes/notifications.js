/**
 * The staff bell: one cheap call that says what is waiting for the caller.
 *
 * Polled by every open staff tab, so it stays a handful of counts and never
 * grows a body. See services/notificationService.js for the scoping rules.
 */
import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, staffOrAdmin } from '../middleware/authMiddleware.js';
import { summaryFor } from '../services/notificationService.js';

const router = express.Router();

// @route   GET /notifications/summary
// @desc    Counts of work waiting on the caller, by queue
// @access  Private (staff and admin)
router.get('/summary', protect, staffOrAdmin, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await summaryFor(req.user)) });
}));

export default router;
