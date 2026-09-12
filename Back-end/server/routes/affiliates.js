import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  contactFormRateLimit,
  authenticatedUserRateLimit,
  adminRouteRateLimit,
} from '../middleware/rate-limit/index.js';
import {
  applyAsAffiliate,
  listAffiliates,
  getAffiliate,
  approveAffiliate,
  rejectAffiliate,
  suspendAffiliate,
  reinstateAffiliate,
  updateAffiliateTerms,
  updateAffiliatePayoutDetails,
  listAffiliateCommissions,
  listStalePendingCommissions,
  getMyAffiliate,
  listMyCommissions,
  requestMyPayout,
  listPayoutQueue,
  buildAffiliatePayout,
  listAffiliatePayouts,
  getAffiliatePayout,
  markAffiliatePayoutPaid,
  markAffiliatePayoutFailed,
  exportAffiliateTds,
} from '../controllers/affiliateController.js';
import {
  validateAffiliateApplication,
  validateAffiliateId,
  validateAffiliateList,
  validateAffiliateApprove,
  validateAffiliateTerms,
  validateAffiliateSuspend,
  validateAffiliateReject,
  validateAffiliatePayoutDetails,
  validateCommissionList,
  validatePayoutId,
  validatePayoutList,
  validatePayoutMarkPaid,
  validatePayoutMarkFailed,
} from '../validators/affiliate.validator.js';

const router = express.Router();

/*
  Mounted with `publicBrowsingRateLimit` + `optionalAuth` (routes/index.js), because
  this router is MIXED: one public write, two authenticated self-serve reads, and an
  admin surface. Admin routes are namespaced under /admin and each carries its own
  `protect, admin` guard plus `adminRouteRateLimit` — the promoBanners shape, not the
  router-level `router.use(protect, admin)` shape, which would lock out the public
  application form.
*/

// ── Public ────────────────────────────────────────────────────────────────────

/*
  The application form. Unauthenticated by design — someone who wants to promote the
  store may not have an account yet, and requiring one loses applicants at the door.

  Safe because approval grants everything and this endpoint grants nothing: a `pending`
  affiliate has no coupon, attributes no sale and earns no commission. It is still an
  unauthenticated WRITE, so it takes the contact-form limiter (keyed on
  cf-connecting-ip, per the house rule) to stop the applications table being used as
  free storage.

  `optionalAuth` is applied at mount, so a signed-in applicant is linked to their
  account automatically — which is what makes the self-referral check work later.
*/
router.post(
  '/apply',
  contactFormRateLimit,
  validateAffiliateApplication,
  validateRequest,
  applyAsAffiliate,
);

// ── Affiliate self-serve (the /account/affiliate portal) ──────────────────────
//
// `protect`, not optionalAuth: these return one person's earnings. Every one is scoped
// to req.user inside the controller — the affiliate id is never read from the query
// string, so no affiliate can page through another's ledger.

router.get('/me', protect, authenticatedUserRateLimit, getMyAffiliate);
router.get(
  '/me/commissions',
  protect, authenticatedUserRateLimit,
  validateCommissionList, validateRequest,
  listMyCommissions,
);

/*
  "Please pay me." A SIGNAL, NOT A MONEY ACTION — it sets a flag an admin can see. The
  payout is still built by an admin and settled by a human bank transfer.

  No body: the balance is re-read from the ledger server-side. A client-sent amount would
  be a number we do not trust anyway, so there is nothing for it to send.

  `contactFormRateLimit` rather than the looser authenticated limiter: this is a write
  that pages a human, and a stuck retry loop should not be able to fill the queue.
*/
router.post(
  '/me/payout-request',
  protect, contactFormRateLimit,
  requestMyPayout,
);

// ── Admin ─────────────────────────────────────────────────────────────────────
//
// Declared BEFORE any '/:id'-shaped route would be, so a literal path segment can
// never be swallowed as an id (the ordering bug routes/leads.js documents).

router.get(
  '/admin',
  protect, admin, adminRouteRateLimit,
  validateAffiliateList, validateRequest,
  listAffiliates,
);

router.get(
  '/admin/stale-pending',
  protect, admin, adminRouteRateLimit,
  listStalePendingCommissions,
);

// Who is owed money right now. Declared before '/admin/:id' so the literal segment is
// not swallowed as an ObjectId — the ordering rule this file documents above.
router.get(
  '/admin/payout-queue',
  protect, admin, adminRouteRateLimit,
  listPayoutQueue,
);

/*
  ── Payouts ─────────────────────────────────────────────────────────────────────
  Declared BEFORE '/admin/:id' on purpose: Express matches in order, so
  `/admin/payouts` would otherwise be captured as an affiliate id and 400 on the
  ObjectId validator. Same ordering rule routes/leads.js documents for its bulk routes.
*/
router.get(
  '/admin/payouts/tds-export',
  protect, admin, adminRouteRateLimit,
  exportAffiliateTds,
);

router.get(
  '/admin/payouts',
  protect, admin, adminRouteRateLimit,
  validatePayoutList, validateRequest,
  listAffiliatePayouts,
);

router.get(
  '/admin/payouts/:payoutId',
  protect, admin, adminRouteRateLimit,
  validatePayoutId, validateRequest,
  getAffiliatePayout,
);

router.post(
  '/admin/payouts/:payoutId/paid',
  protect, admin, adminRouteRateLimit,
  validatePayoutId, validatePayoutMarkPaid, validateRequest,
  markAffiliatePayoutPaid,
);

router.post(
  '/admin/payouts/:payoutId/failed',
  protect, admin, adminRouteRateLimit,
  validatePayoutId, validatePayoutMarkFailed, validateRequest,
  markAffiliatePayoutFailed,
);

router.get(
  '/admin/:id',
  protect, admin, adminRouteRateLimit,
  validateAffiliateId, validateRequest,
  getAffiliate,
);

router.get(
  '/admin/:id/commissions',
  protect, admin, adminRouteRateLimit,
  validateAffiliateId, validateCommissionList, validateRequest,
  listAffiliateCommissions,
);

router.post(
  '/admin/:id/approve',
  protect, admin, adminRouteRateLimit,
  validateAffiliateId, validateAffiliateApprove, validateRequest,
  approveAffiliate,
);

router.post(
  '/admin/:id/reject',
  protect, admin, adminRouteRateLimit,
  validateAffiliateId, validateAffiliateReject, validateRequest,
  rejectAffiliate,
);

router.post(
  '/admin/:id/suspend',
  protect, admin, adminRouteRateLimit,
  validateAffiliateId, validateAffiliateSuspend, validateRequest,
  suspendAffiliate,
);

router.post(
  '/admin/:id/reinstate',
  protect, admin, adminRouteRateLimit,
  validateAffiliateId, validateRequest,
  reinstateAffiliate,
);

router.patch(
  '/admin/:id/terms',
  protect, admin, adminRouteRateLimit,
  validateAffiliateId, validateAffiliateTerms, validateRequest,
  updateAffiliateTerms,
);

// Claims every payable row for this affiliate into one batch. 409 if another admin
// already did — the guard is the rows' `payout: null`, not a lock here.
router.post(
  '/admin/:id/payouts',
  protect, admin, adminRouteRateLimit,
  validateAffiliateId, validateRequest,
  buildAffiliatePayout,
);

// Financial PII in the body. The response is a re-read without the sensitive
// projection, so the full account number is write-only from the API's point of view.
router.put(
  '/admin/:id/payout-details',
  protect, admin, adminRouteRateLimit,
  validateAffiliateId, validateAffiliatePayoutDetails, validateRequest,
  updateAffiliatePayoutDetails,
);

export default router;
