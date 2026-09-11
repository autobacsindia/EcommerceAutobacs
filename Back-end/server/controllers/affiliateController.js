/**
 * Affiliate controllers — thin over affiliateService / affiliateCommissionRepository.
 *
 * Response envelope follows the house convention: `{ success: true, ... }`, with lists
 * returning `{ <collection>, nextCursor }` rather than a page/total pair. No offset
 * pagination anywhere — see the root CLAUDE.md rule.
 */

import { asyncHandler } from '../middleware/errorMiddleware.js';
import affiliateService, { toSelfView } from '../services/affiliateService.js';
import affiliateCommissionRepository from '../repositories/affiliateCommissionRepository.js';
import affiliateRepository from '../repositories/affiliateRepository.js';
import affiliatePayoutService from '../services/affiliatePayoutService.js';
import affiliatePayoutRepository from '../repositories/affiliatePayoutRepository.js';
import AppError from '../utils/AppError.js';
import crypto from 'crypto';
import {
  STALE_PENDING_DAYS,
  DEFAULT_COMMISSION_PERCENT,
  DEFAULT_REPEAT_COMMISSION_PERCENT,
  DEFAULT_DISCOUNT_PERCENT,
} from '../config/affiliate.js';

const cursorFrom = (value) => (value ? new Date(value) : null);

const boundedLimit = (raw, fallback = 50, max = 100) =>
  Math.min(Math.max(1, Number(raw) || fallback), max);

/**
 * @desc    Submit an affiliate application
 * @route   POST /api/v1/affiliates/apply
 * @access  Public (rate-limited)
 */
export const applyAsAffiliate = asyncHandler(async (req, res) => {
  // The applicant's user id comes from the verified session, NEVER the body — it is a
  // self-referral match key, so letting the client name it would defeat the check.
  /*
    A sha256 of the applicant's IP — enough to evidence that a specific request accepted
    the terms, without holding an address against a name. Mirrors how an order hashes the
    buyer's IP for legal acceptance.
  */
  const ip = req.headers['cf-connecting-ip'] || req.ip || req.connection?.remoteAddress;
  const ipHash = ip ? crypto.createHash('sha256').update(String(ip)).digest('hex') : null;

  await affiliateService.apply(req.body, { userId: req.user?._id || null, ipHash });

  /*
    ⚠️ IDENTICAL FOR EVERY OUTCOME — body AND status code.

    This endpoint is unauthenticated, so anything that varies by the submitted email is a
    membership oracle: POST an address, read the difference, learn whether that person is
    an affiliate and whether they were turned down. The body was already contentless, but
    it echoed `affiliate.status` (pending / active / suspended / rejected) and the service
    threw distinct 409s — so the leak was intact through two other channels.

    A re-submission by an existing applicant is therefore indistinguishable from a first
    one. The service records the duplicate server-side for an admin to see.
  */
  res.status(201).json({
    success: true,
    message: 'Application received. We will be in touch once it has been reviewed.',
  });
});

/**
 * @desc    List affiliates (cursor-paginated)
 * @route   GET /api/v1/affiliates/admin
 * @access  Admin
 */
export const listAffiliates = asyncHandler(async (req, res) => {
  const { affiliates, nextCursor } = await affiliateService.listAdmin({
    limit: boundedLimit(req.query.limit),
    before: cursorFrom(req.query.before),
    status: req.query.status || null,
    search: req.query.search || null,
  });

  res.json({ success: true, affiliates, nextCursor });
});

/**
 * @desc    One affiliate, with its managed coupon and commission summary
 * @route   GET /api/v1/affiliates/admin/:id
 * @access  Admin
 */
export const getAffiliate = asyncHandler(async (req, res) => {
  const affiliate = await affiliateService.getById(req.params.id);
  const [summary, payableBalancePaise] = await Promise.all([
    affiliateCommissionRepository.summaryByStatus(affiliate._id),
    affiliateCommissionRepository.payableBalancePaise(affiliate._id),
  ]);

  /*
    The configured defaults, so the approval screen can SHOW the admin the rates they
    are about to agree to instead of hardcoding its own guesses. These are money terms:
    an admin approving someone must see the number, and a UI-side constant silently
    drifting from the server's config is how they would stop matching.
  */
  res.json({
    success: true,
    affiliate,
    summary,
    payableBalancePaise,
    defaults: {
      commissionPercent: DEFAULT_COMMISSION_PERCENT,
      repeatCommissionPercent: DEFAULT_REPEAT_COMMISSION_PERCENT,
      discountPercent: DEFAULT_DISCOUNT_PERCENT,
    },
  });
});

/**
 * @desc    Approve an application — mints the managed coupon and goes live
 * @route   POST /api/v1/affiliates/admin/:id/approve
 * @access  Admin
 */
export const approveAffiliate = asyncHandler(async (req, res) => {
  const affiliate = await affiliateService.approve(req.params.id, {
    code: req.body.code,
    commissionPercent: req.body.commissionPercent,
    repeatCommissionPercent: req.body.repeatCommissionPercent,
    discountPercent: req.body.discountPercent,
    adminId: req.user._id,
  });

  res.json({ success: true, affiliate });
});

/**
 * @desc    Decline an application
 * @route   POST /api/v1/affiliates/admin/:id/reject
 * @access  Admin
 */
export const rejectAffiliate = asyncHandler(async (req, res) => {
  const affiliate = await affiliateService.reject(req.params.id, req.body.notes);
  res.json({ success: true, affiliate });
});

/**
 * @desc    Suspend an affiliate — also deactivates their coupon, atomically
 * @route   POST /api/v1/affiliates/admin/:id/suspend
 * @access  Admin
 */
export const suspendAffiliate = asyncHandler(async (req, res) => {
  const affiliate = await affiliateService.suspend(req.params.id, req.body.reason);
  res.json({ success: true, affiliate });
});

/**
 * @desc    Undo a suspension
 * @route   POST /api/v1/affiliates/admin/:id/reinstate
 * @access  Admin
 */
export const reinstateAffiliate = asyncHandler(async (req, res) => {
  const affiliate = await affiliateService.reinstate(req.params.id);
  res.json({ success: true, affiliate });
});

/**
 * @desc    Change commercial terms (commission %, buyer discount %, TDS %)
 * @route   PATCH /api/v1/affiliates/admin/:id/terms
 * @access  Admin
 */
export const updateAffiliateTerms = asyncHandler(async (req, res) => {
  const affiliate = await affiliateService.updateTerms(req.params.id, req.body);
  res.json({ success: true, affiliate });
});

/**
 * @desc    Record bank / UPI details for payouts
 * @route   PUT /api/v1/affiliates/admin/:id/payout-details
 * @access  Admin
 */
export const updateAffiliatePayoutDetails = asyncHandler(async (req, res) => {
  const affiliate = await affiliateService.updatePayoutDetails(req.params.id, req.body);
  // `affiliate` here is a re-read WITHOUT the sensitive projection, so the response
  // carries accountLast4 and never the full number. See affiliateService.
  res.json({ success: true, affiliate });
});

/**
 * @desc    An affiliate's commission ledger (cursor-paginated)
 * @route   GET /api/v1/affiliates/admin/:id/commissions
 * @access  Admin
 */
export const listAffiliateCommissions = asyncHandler(async (req, res) => {
  const limit = boundedLimit(req.query.limit);
  const rows = await affiliateCommissionRepository.findPage({
    affiliate: req.params.id,
    status: req.query.status || null,
    limit: limit + 1, // one extra reveals a next page without a count query
    before: cursorFrom(req.query.before),
  });

  const hasMore = rows.length > limit;
  const commissions = hasMore ? rows.slice(0, limit) : rows;

  res.json({
    success: true,
    commissions,
    nextCursor: hasMore ? commissions.at(-1).createdAt : null,
  });
});

/**
 * @desc    Commissions that will never mature on their own
 * @route   GET /api/v1/affiliates/admin/stale-pending
 * @access  Admin
 *
 * Orders that were PAID but never marked delivered. They stay pending forever, which
 * is the correct fail-closed behaviour — we never pay for an undelivered order — but
 * it is silent, so it needs a place to be seen. Nothing here approves anything: an
 * order undelivered for two months is an operations problem, not a payable.
 */
export const listStalePendingCommissions = asyncHandler(async (req, res) => {
  const cutoff = new Date(Date.now() - STALE_PENDING_DAYS * 24 * 60 * 60 * 1000);
  const commissions = await affiliateCommissionRepository.findStalePending(
    cutoff,
    boundedLimit(req.query.limit, 100)
  );

  res.json({ success: true, commissions, cutoff, staleAfterDays: STALE_PENDING_DAYS });
});

/**
 * @desc    The signed-in user's own affiliate profile + earnings
 * @route   GET /api/v1/affiliates/me
 * @access  Private
 */
export const getMyAffiliate = asyncHandler(async (req, res) => {
  const affiliate = await affiliateRepository.findByUser(req.user._id);
  if (!affiliate) {
    /*
      Not an error: "you are not an affiliate" is a perfectly normal answer, and a 404
      would make the portal page render an error state for every ordinary customer.

      But it is the WRONG answer for one person: an applicant who applied while signed
      out, from this same address, and has not verified it yet. Their application exists
      and may already be approved; we simply cannot prove they own the inbox, so we will
      not hand them the ledger. Telling them "you're not an affiliate yet" would be flatly
      false and send them to re-apply, which the duplicate guard then refuses — a dead end
      with no explanation.

      `needsEmailVerification` is a BOOLEAN and nothing else. No code, no rates, no
      earnings: this caller has not proven the address is theirs, so they get the one bit
      that tells them what to do next and not a byte more. Scoped to `!isVerified` so a
      verified user never triggers it — by then the link exists (routes/auth.js) or the
      backfill script has repaired it.
    */
    const needsEmailVerification = !req.user.isVerified
      && await affiliateRepository.hasUnlinkedApplicationForEmail(req.user.email);

    return res.json({ success: true, affiliate: null, needsEmailVerification });
  }

  const [summary, payableBalancePaise] = await Promise.all([
    affiliateCommissionRepository.summaryByStatus(affiliate._id),
    affiliateCommissionRepository.payableBalancePaise(affiliate._id),
  ]);

  // Whitelisted projection, NOT the raw document: the schema's toJSON strips only the
  // encrypted bank/PAN fields, so returning `affiliate` here leaked the admin-only
  // `notes` and `termsAcceptance.ipHash`. See toSelfView.
  res.json({ success: true, affiliate: toSelfView(affiliate), summary, payableBalancePaise });
});

/**
 * @desc    The signed-in affiliate's own commission ledger (cursor-paginated)
 * @route   GET /api/v1/affiliates/me/commissions
 * @access  Private
 */
export const listMyCommissions = asyncHandler(async (req, res) => {
  const affiliate = await affiliateRepository.findByUser(req.user._id);
  if (!affiliate) throw new AppError('You are not an affiliate.', 403, { expose: true });

  const limit = boundedLimit(req.query.limit);
  const rows = await affiliateCommissionRepository.findPage({
    affiliate: affiliate._id, // scoped to the caller — never read from the query string
    status: req.query.status || null,
    limit: limit + 1,
    before: cursorFrom(req.query.before),
  });

  const hasMore = rows.length > limit;
  const commissions = hasMore ? rows.slice(0, limit) : rows;

  res.json({
    success: true,
    commissions,
    nextCursor: hasMore ? commissions.at(-1).createdAt : null,
  });
});

// ── Payouts ───────────────────────────────────────────────────────────────────

/**
 * @desc    Build a payout batch, claiming everything payable for one affiliate
 * @route   POST /api/v1/affiliates/admin/:id/payouts
 * @access  Admin
 *
 * 409 when another admin has already claimed these rows — the claim lives in the
 * commission rows, so the loser's updateMany matches nothing and no second payout
 * with money on it can exist.
 */
export const buildAffiliatePayout = asyncHandler(async (req, res) => {
  const payout = await affiliatePayoutService.buildBatch(req.params.id, { adminId: req.user._id });
  res.status(201).json({ success: true, payout });
});

/**
 * @desc    List payout batches (cursor-paginated)
 * @route   GET /api/v1/affiliates/admin/payouts
 * @access  Admin
 */
export const listAffiliatePayouts = asyncHandler(async (req, res) => {
  const { payouts, nextCursor } = await affiliatePayoutService.listAdmin({
    limit: boundedLimit(req.query.limit),
    before: cursorFrom(req.query.before),
    status: req.query.status || null,
    affiliate: req.query.affiliate || null,
  });
  res.json({ success: true, payouts, nextCursor });
});

/**
 * @desc    One payout batch and the commission rows it claimed
 * @route   GET /api/v1/affiliates/admin/payouts/:payoutId
 * @access  Admin
 */
export const getAffiliatePayout = asyncHandler(async (req, res) => {
  const payout = await affiliatePayoutRepository.findByIdPopulated(req.params.payoutId);
  if (!payout) throw new AppError('Payout not found', 404);

  const commissions = await affiliateCommissionRepository.findByPayout(payout._id);
  res.json({ success: true, payout, commissions });
});

/**
 * @desc    Record that the bank transfer landed
 * @route   POST /api/v1/affiliates/admin/payouts/:payoutId/paid
 * @access  Admin
 */
export const markAffiliatePayoutPaid = asyncHandler(async (req, res) => {
  const payout = await affiliatePayoutService.markPaid(req.params.payoutId, {
    reference: req.body.reference,
    method: req.body.method,
    notes: req.body.notes,
    adminId: req.user._id,
  });
  res.json({ success: true, payout });
});

/**
 * @desc    Record that the transfer failed — RELEASES the claimed rows back to payable
 * @route   POST /api/v1/affiliates/admin/payouts/:payoutId/failed
 * @access  Admin
 */
export const markAffiliatePayoutFailed = asyncHandler(async (req, res) => {
  const payout = await affiliatePayoutService.markFailed(req.params.payoutId, {
    failureReason: req.body.failureReason,
  });
  res.json({ success: true, payout });
});

/**
 * @desc    Form-26Q-ready CSV of paid payouts
 * @route   GET /api/v1/affiliates/admin/payouts/tds-export
 * @access  Admin
 *
 * A REPORT of what was recorded, not a filing — it does not decide the section, the
 * rate, or whether a threshold was crossed. See the note on Affiliate.tdsPercent.
 */
export const exportAffiliateTds = asyncHandler(async (req, res) => {
  const csv = await affiliatePayoutService.exportTdsCsv({
    from: req.query.from || null,
    to: req.query.to || null,
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="affiliate-tds.csv"');
  // Financial PII in the body — never let a proxy or the browser retain it.
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
});
