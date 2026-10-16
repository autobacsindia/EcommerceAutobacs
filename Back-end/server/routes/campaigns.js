import express from 'express';
import { protect, admin, adminOrMarketing } from '../middleware/authMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { contactFormRateLimit, authenticatedUserRateLimit } from '../middleware/rate-limit/index.js';
import {
  getMyCampaignStatus, checkCampaignEmail, getCampaignProductRates, activateCampaign,
  listCampaigns, getCampaignAdmin, getCampaignReport,
  createCampaign, updateCampaign, setCampaignStatus, listCampaignRedemptions,
  importCampaignMembers, listCampaignMembers, simulateCampaign,
  previewProductTier, simulateProductTiers, commitProductTier, listProductTiers,
  getProductTierDrift, unassignProductTier,
} from '../controllers/campaignController.js';
import {
  validateCampaignSlug, validateCampaignId, validateCampaignCreate,
  validateCampaignUpdate, validateCampaignStatus, validateCampaignEmailCheck,
  validateCampaignMembers, validateCampaignMemberQuery, validateCampaignSimulate,
  validateCampaignRedemptionQuery,
  validateProductTierPreview, validateProductTierSimulate, validateProductTierCommit,
  validateProductTierQuery, validateProductTierCode, validateProductRates,
} from '../validators/campaign.validator.js';

const router = express.Router();

// ── Public (the printed QR lands here) ────────────────────────────────────────
// optionalAuth is applied at mount so a logged-out visitor still gets a useful
// answer ("log in with the email your offer was sent to") rather than a 401.
router.get('/:slug/me', validateCampaignSlug, validateRequest, getMyCampaignStatus);

// Per-product campaign rates for badges. Identity-free by construction — see the
// controller — so unlike /:slug/me it carries no per-user data and needs no auth.
router.get(
  '/:slug/product-rates',
  validateCampaignSlug, validateProductRates, validateRequest,
  getCampaignProductRates,
);

// The customer claiming the offer off the printed card. `protect`, not optionalAuth:
// activation is recorded against an account, so an anonymous caller must get a 401 and
// be sent to sign in rather than a 200 that recorded nothing (auth failure never
// returns 200). Idempotent, so the landing page can call it on every visit.
//
// Declared before the admin block for the same reason as the routes above — it is a
// `:slug` suffix and cannot be shadowed by them.
router.post(
  '/:slug/activate',
  protect, authenticatedUserRateLimit,
  validateCampaignSlug, validateRequest,
  activateCampaign,
);

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
router.get('/', protect, adminOrMarketing, listCampaigns);
router.post('/', protect, adminOrMarketing, validateCampaignCreate, validateRequest, createCampaign);

router.get('/:slug/admin', protect, adminOrMarketing, validateCampaignSlug, validateRequest, getCampaignAdmin);
router.get('/:slug/report', protect, adminOrMarketing, validateCampaignSlug, validateRequest, getCampaignReport);
// Also a `:slug` suffix, for the same reason `/report` is: it cannot be shadowed by the
// bare public `/:slug/me` above.
router.get(
  '/:slug/redemptions',
  protect, adminOrMarketing,
  validateCampaignSlug, validateCampaignRedemptionQuery, validateRequest,
  listCampaignRedemptions,
);

router.put('/:id', protect, adminOrMarketing, validateCampaignId, validateCampaignUpdate, validateRequest, updateCampaign);
router.patch('/:id/status', protect, adminOrMarketing, validateCampaignId, validateCampaignStatus, validateRequest, setCampaignStatus);
router.get('/:id/members', protect, adminOrMarketing, validateCampaignId, validateCampaignMemberQuery, validateRequest, listCampaignMembers);
router.post('/:id/members', protect, adminOrMarketing, validateCampaignId, validateCampaignMembers, validateRequest, importCampaignMembers);
router.post('/:id/simulate', protect, adminOrMarketing, validateCampaignId, validateCampaignSimulate, validateRequest, simulateCampaign);

// Product tiers. `/preview` and `/drift` are declared BEFORE the bare collection route
// so neither can be swallowed by a `:tierCode` segment, and both are GETs that write
// nothing — previewing a destructive-looking query must never be destructive.
router.get('/:id/product-tiers/preview', protect, adminOrMarketing, validateCampaignId, validateProductTierPreview, validateRequest, previewProductTier);
router.get('/:id/product-tiers/simulate', protect, adminOrMarketing, validateCampaignId, validateProductTierSimulate, validateRequest, simulateProductTiers);
router.get('/:id/product-tiers/drift', protect, adminOrMarketing, validateCampaignId, validateRequest, getProductTierDrift);
router.get('/:id/product-tiers', protect, adminOrMarketing, validateCampaignId, validateProductTierQuery, validateRequest, listProductTiers);
router.post('/:id/product-tiers', protect, adminOrMarketing, validateCampaignId, validateProductTierCommit, validateRequest, commitProductTier);
router.delete('/:id/product-tiers/:tierCode', protect, admin, validateCampaignId, validateProductTierCode, validateRequest, unassignProductTier);

export default router;
