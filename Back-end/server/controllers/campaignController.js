/**
 * Campaign HTTP handlers — two audiences in one file, kept visibly separate.
 *
 * The PUBLIC handlers are what a customer's browser touches after scanning the printed
 * QR. They are per-user by construction and must never be edge-cached under a shared
 * key: caching one buyer's eligibility would hand it to everyone.
 *
 * The ADMIN handlers are the operator's controls — create, tune, switch on and off,
 * import the allowlist, and watch the spend against the cap.
 */

import { asyncHandler } from '../middleware/errorMiddleware.js';
import campaignService from '../services/campaignService.js';
import campaignProductTierService from '../services/campaignProductTierService.js';
import campaignRepository from '../repositories/campaignRepository.js';
import AppError from '../utils/AppError.js';
import { CAMPAIGN_STATUSES } from '../config/campaign.js';

// Per-user responses must not be stored by any shared cache between us and the browser.
const noStore = (res) => res.set('Cache-Control', 'no-store, private');

// ── Public ────────────────────────────────────────────────────────────────────

// @desc    Eligibility + tier ladder for the signed-in visitor. Drives the landing
//          page, the site-wide banner, and the cart savings meter.
// @route   GET /campaigns/:slug/me
// @access  Public (optionalAuth — a logged-out visitor gets eligible:false + a reason)
export const getMyCampaignStatus = asyncHandler(async (req, res) => {
  const cartValue = Math.max(0, Number(req.query.cartValue) || 0);
  const status = await campaignService.statusForUser(
    req.params.slug,
    req.user?.id || req.user?._id?.toString() || null,
    Math.round(cartValue * 100),
  );
  noStore(res);
  res.json({ success: true, campaign: status });
});

// @desc    What rate these products earn under the running campaign, for badges on the
//          product page and listings.
// @route   GET /campaigns/:slug/product-rates?ids=a,b,c
// @access  Public
//
// Deliberately identity-free and therefore cacheable, unlike /me: a product's rate is a
// property of the catalogue and the ladder, not of who is asking. The per-user question
// — may THIS shopper still claim it — is answered by /me, which stays private and
// no-store. Answering `rates: {}` rather than 404 when nothing is running lets the
// client render nothing without branching on an error.
export const getCampaignProductRates = asyncHandler(async (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const result = await campaignService.productRates(req.params.slug, ids);
  res.json({ success: true, campaign: result });
});

// @desc    "Am I on the list, and what do I do next?" — the landing page's first step.
// @route   POST /campaigns/:slug/check-email
// @access  Public (strictly rate-limited; see campaignService.checkEmail on the trade-off)
export const checkCampaignEmail = asyncHandler(async (req, res) => {
  const result = await campaignService.checkEmail(req.params.slug, req.body.email);
  noStore(res);
  res.json({ success: true, ...result });
});

// ── Admin ─────────────────────────────────────────────────────────────────────

// @desc    List campaigns
// @route   GET /campaigns
// @access  Private/Admin
export const listCampaigns = asyncHandler(async (req, res) => {
  const campaigns = await campaignRepository.listAdmin({ limit: Number(req.query.limit) || 50 });
  res.json({ success: true, campaigns });
});

// @desc    Full campaign document for the editor
// @route   GET /campaigns/:slug/admin
// @access  Private/Admin
export const getCampaignAdmin = asyncHandler(async (req, res) => {
  const campaign = await campaignService.getBySlug(req.params.slug);
  res.json({ success: true, campaign });
});

// @desc    Funnel + spend against the cap
// @route   GET /campaigns/:slug/report
// @access  Private/Admin
export const getCampaignReport = asyncHandler(async (req, res) => {
  const report = await campaignService.report(req.params.slug);
  res.json({ success: true, report });
});

// @desc    One page of the campaign's allowlist (keyset-paginated, searchable)
// @route   GET /campaigns/:id/members
// @access  Private/Admin
export const listCampaignMembers = asyncHandler(async (req, res) => {
  const result = await campaignService.listMembers(req.params.id, {
    cursor: req.query.cursor || null,
    limit: req.query.limit,
    status: req.query.status || null,
    q: req.query.q || null,
  });
  // Per-campaign operational data about named customers — never cache it anywhere
  // shared, and never let an intermediary hold a copy.
  res.set('Cache-Control', 'no-store, private');
  res.json({ success: true, ...result });
});

// @desc    Create a campaign (always starts as a draft unless a status is supplied)
// @route   POST /campaigns
// @access  Private/Admin
export const createCampaign = asyncHandler(async (req, res) => {
  const campaign = await campaignService.create(req.body, req.user?.id);
  res.status(201).json({ success: true, campaign });
});

// @desc    Update a campaign's configuration (tiers, caps, dates, audience)
// @route   PUT /campaigns/:id
// @access  Private/Admin
export const updateCampaign = asyncHandler(async (req, res) => {
  const campaign = await campaignService.update(req.params.id, req.body, req.user?.id);
  res.json({ success: true, campaign });
});

// @desc    The kill switch. Separate from update() so turning a campaign OFF can never
//          be blocked by a validation error in some unrelated field.
// @route   PATCH /campaigns/:id/status
// @access  Private/Admin
export const setCampaignStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!CAMPAIGN_STATUSES.includes(status)) {
    throw new AppError(`status must be one of: ${CAMPAIGN_STATUSES.join(', ')}`, 400);
  }
  const campaign = await campaignService.setStatus(req.params.id, status, req.user?.id);
  res.json({ success: true, campaign });
});

// @desc    Import the allowlist from an operations spreadsheet. Upserts, so a corrected
//          list can be re-imported without wiping claim or redemption history.
// @route   POST /campaigns/:id/members
// @access  Private/Admin
export const importCampaignMembers = asyncHandler(async (req, res) => {
  const { members } = req.body;
  if (!Array.isArray(members) || members.length === 0) {
    throw new AppError('Provide a non-empty members array', 400);
  }
  if (members.length > 5000) {
    throw new AppError('Import at most 5000 members at a time', 400);
  }
  const result = await campaignService.importMembers(req.params.id, members);
  res.json({ success: true, ...result });
});

// @desc    The cart calculator — what a given cart value would earn. Lets an operator
//          sanity-check a tier ladder in seconds instead of in a customer's cart.
// @route   POST /campaigns/:id/simulate
// @access  Private/Admin
export const simulateCampaign = asyncHandler(async (req, res) => {
  const campaign = await campaignRepository.findById(req.params.id);
  if (!campaign) throw new AppError('Campaign not found', 404);

  const values = Array.isArray(req.body.cartValues) && req.body.cartValues.length
    ? req.body.cartValues.slice(0, 25)
    : [25000, 50000, 100000, 150000, 200000, 300000, 500000];

  res.json({
    success: true,
    results: values.map(v => campaignService.simulate(campaign, v)),
  });
});

// ── Admin: product tiers ──────────────────────────────────────────────────────
// The authoring surface for per-product discount rates. Every response here is
// operator-only and reflects state an admin has just changed, so none of it may be
// stored by a shared cache.

// @desc    Dry-run a tier's search query: what WOULD be assigned, and what overlap
//          would keep where it is. Writes nothing.
// @route   GET /campaigns/:id/product-tiers/preview?tierCode=&query=
// @access  Admin
export const previewProductTier = asyncHandler(async (req, res) => {
  const result = await campaignProductTierService.preview(req.params.id, {
    tierCode: req.query.tierCode,
    query: req.query.query,
  });
  noStore(res);
  res.json({ success: true, ...result });
});

// @desc    Resolve real products against the SAVED product ladder — the admin
//          calculator for a product-tier campaign. Writes nothing.
// @route   GET /campaigns/:id/product-tiers/simulate?query=&quantity=
// @access  Admin
export const simulateProductTiers = asyncHandler(async (req, res) => {
  const result = await campaignProductTierService.simulateProducts(req.params.id, {
    query: req.query.query,
    quantity: req.query.quantity,
  });
  noStore(res);
  res.json({ success: true, ...result });
});

// @desc    Commit an assignment — the reviewed selection, or the whole query match.
// @route   POST /campaigns/:id/product-tiers
// @access  Admin
export const commitProductTier = asyncHandler(async (req, res) => {
  const result = await campaignProductTierService.commit(req.params.id, {
    tierCode: req.body.tierCode,
    query: req.body.query,
    productIds: req.body.productIds,
    // Explicit opt-in past the "this query matches most of the catalogue" refusal.
    confirm: req.body.confirm === true,
    assignedBy: req.user?._id || null,
  });
  noStore(res);
  res.status(201).json({ success: true, ...result });
});

// @desc    One keyset page of a campaign's assignments (+ per-tier counts on page one).
// @route   GET /campaigns/:id/product-tiers
// @access  Admin
export const listProductTiers = asyncHandler(async (req, res) => {
  const result = await campaignProductTierService.list(req.params.id, {
    cursor: req.query.cursor || null,
    limit: req.query.limit,
    tierCode: req.query.tierCode || null,
  });
  noStore(res);
  res.json({ success: true, ...result });
});

// @desc    Products matching a tier's saved queries that carry no assignment — the
//          report that stops a materialized scheme rotting as the catalogue grows.
// @route   GET /campaigns/:id/product-tiers/drift
// @access  Admin
export const getProductTierDrift = asyncHandler(async (req, res) => {
  const result = await campaignProductTierService.drift(req.params.id);
  noStore(res);
  res.json({ success: true, ...result });
});

// @desc    Remove one tier's membership, re-resolving products that also matched
//          another tier rather than blanket-deleting them.
// @route   DELETE /campaigns/:id/product-tiers/:tierCode
// @access  Admin
export const unassignProductTier = asyncHandler(async (req, res) => {
  const result = await campaignProductTierService.unassign(req.params.id, req.params.tierCode);
  noStore(res);
  res.json({ success: true, ...result });
});
