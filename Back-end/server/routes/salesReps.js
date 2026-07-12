import express from 'express';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import {
  listSalesReps,
  createSalesRep,
  updateSalesRep,
} from '../controllers/salesRepController.js';

const router = express.Router();

// Name-only rep profiles are admin-managed (no separate role — same guard as the CRM).
router.use(protect, admin);

router.get('/', asyncHandler(listSalesReps));
router.post('/', asyncHandler(createSalesRep));
router.patch('/:id', asyncHandler(updateSalesRep));

export default router;
