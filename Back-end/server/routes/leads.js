import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import {
  listLeads,
  getLeadStats,
  getLeadById,
  claimLead,
  releaseLead,
  assignLead,
  updateLeadStatus,
  addActivity,
  bulkClaim,
  bulkStatus,
} from '../controllers/leadController.js';

const router = express.Router();

// Sales CRM is admin-only (sales reps operate as admins — no separate role).
router.use(protect, admin);

router.get('/', asyncHandler(listLeads));
router.get('/stats', asyncHandler(getLeadStats));

// Bulk actions before the /:id routes so "bulk" isn't captured as an id.
router.post('/bulk/claim', asyncHandler(bulkClaim));
router.post('/bulk/status', asyncHandler(bulkStatus));

router.get('/:id', asyncHandler(getLeadById));
router.post('/:id/claim', asyncHandler(claimLead));
router.post('/:id/release', asyncHandler(releaseLead));
router.post('/:id/assign', asyncHandler(assignLead));
router.patch('/:id/status', asyncHandler(updateLeadStatus));
router.post('/:id/activity', asyncHandler(addActivity));

export default router;
