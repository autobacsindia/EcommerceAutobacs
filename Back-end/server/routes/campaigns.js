import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { contactFormRateLimit } from '../middleware/rate-limit/index.js';
import {
  getMyCampaignStatus, checkCampaignEmail,
  listCampaigns, getCampaignAdmin, getCampaignReport,
  createCampaign, updateCampaign, setCampaignStatus,
  importCampaignMembers, listCampaignMembers, simulateCampaign,
  previewProductTier, simulateProductTiers, commitProductTier, listProductTiers,
  getProductTierDrift, unassignProductTier,
} from '../controllers/campaignController.js';
import {
  validateCampaignSlug, validateCampaignId, validateCampaignCreate,
  validateCampaignUpdate, validateCampaignStatus, validateCampaignEmailCheck,
  validateCampaignMembers, validateCampaignMemberQuery, validateCampaignSimulate,
  validateProductTierPreview, validateProductTierSimulate, validateProductTierCommit,
  validateProductTierQuery, validateProductTierCode,
} from '../validators/campaign.validator.js';

const router = express.Router();

// ── Public (the printed QR lands here) ────────────────────────────────────────
// optionalAuth is applied at mount so a logged-out visitor still gets a useful
// answer ("log in with the email your offer was sent to") rather than a 401.
router.get('/:slug/me', validateCampaignSlug, validateRequest, getMyCampaignStatus);

// Reveals whether an address is on the allowlist, so it is an enumeration oracle by
// design (the UX requires an unambiguous "you're in"). Held to the strictest public
// limiter available — keyed on cf-connecting-ip by the limiter core, per house rule.
router.post(
  '/:slug/check-email',
  contactFormRateLimit,
  validateCampaignSlug, validateCampaignEmailCheck, validateRequest,
  checkCampaignEmail,
);

// ── Admin ─────────────────────────────────────────────────────────────────────
// Declared AFTER the public routes but with non-colliding paths. `/admin` and
// `/report` are suffixes on :slug so they cannot be shadowed by the bare `/:slug/me`.
router.get('/', protect, admin, listCampaigns);
router.post('/', protect, admin, validateCampaignCreate, validateRequest, createCampaign);

router.get('/:slug/admin', protect, admin, validateCampaignSlug, validateRequest, getCampaignAdmin);
router.get('/:slug/report', protect, admin, validateCampaignSlug, validateRequest, getCampaignReport);

router.put('/:id', protect, admin, validateCampaignId, validateCampaignUpdate, validateRequest, updateCampaign);
router.patch('/:id/status', protect, admin, validateCampaignId, validateCampaignStatus, validateRequest, setCampaignStatus);
router.get('/:id/members', protect, admin, validateCampaignId, validateCampaignMemberQuery, validateRequest, listCampaignMembers);
router.post('/:id/members', protect, admin, validateCampaignId, validateCampaignMembers, validateRequest, importCampaignMembers);
router.post('/:id/simulate', protect, admin, validateCampaignId, validateCampaignSimulate, validateRequest, simulateCampaign);

// Product tiers. `/preview` and `/drift` are declared BEFORE the bare collection route
// so neither can be swallowed by a `:tierCode` segment, and both are GETs that write
// nothing — previewing a destructive-looking query must never be destructive.
router.get('/:id/product-tiers/preview', protect, admin, validateCampaignId, validateProductTierPreview, validateRequest, previewProductTier);
router.get('/:id/product-tiers/simulate', protect, admin, validateCampaignId, validateProductTierSimulate, validateRequest, simulateProductTiers);
router.get('/:id/product-tiers/drift', protect, admin, validateCampaignId, validateRequest, getProductTierDrift);
router.get('/:id/product-tiers', protect, admin, validateCampaignId, validateProductTierQuery, validateRequest, listProductTiers);
router.post('/:id/product-tiers', protect, admin, validateCampaignId, validateProductTierCommit, validateRequest, commitProductTier);
router.delete('/:id/product-tiers/:tierCode', protect, admin, validateCampaignId, validateProductTierCode, validateRequest, unassignProductTier);

export default router;
