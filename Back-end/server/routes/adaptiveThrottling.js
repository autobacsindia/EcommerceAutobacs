import express from 'express';
import {
  getAllProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  activateProfile,
  deactivateProfile,
  getStatus,
  createFlashSalePreset
} from '../controllers/adaptiveThrottlingController.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import { adminRateLimit } from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

// All routes require admin authentication
router.use(protect, admin, adminRateLimit);

// Profile management
router.get('/profiles', getAllProfiles);
router.get('/profiles/:id', getProfile);
router.post('/profiles', createProfile);
router.put('/profiles/:id', updateProfile);
router.delete('/profiles/:id', deleteProfile);

// Activation/deactivation
router.post('/profiles/:id/activate', activateProfile);
router.post('/deactivate', deactivateProfile);

// Status
router.get('/status', getStatus);

// Preset creation
router.post('/profiles/presets/flash-sale', createFlashSalePreset);

export default router;
