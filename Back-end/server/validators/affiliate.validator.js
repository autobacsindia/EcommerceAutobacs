/**
 * Affiliate validation (express-validator). Mirrors validators/coupon.validator.js.
 * Pair each chain with the shared `validateRequest` middleware to surface 400s.
 *
 * The application chain is the only one reachable without authentication, so it is the
 * strictest: every field is length-bounded, because an unbounded string on an
 * unauthenticated write is a storage-exhaustion vector as much as a validation gap.
 */

import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';
import { GST_STATE_BY_CODE } from '../config/gstStates.js';
import {
  AFFILIATE_STATUSES,
  CODE_REGEX,
  COMMISSION_STATUSES,
  PAYOUT_METHODS,
} from '../config/affiliate.js';

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);

// ── Public application ────────────────────────────────────────────────────────

const INDIAN_STATES = Object.freeze(Object.values(GST_STATE_BY_CODE));

/*
  The application now collects PAN, bank details and an address, because all three are
  needed the moment money moves and chasing them afterwards means chasing someone who has
  already earned and is waiting to be paid.

  ⚠️ THIS IS THE ONLY PLACE PAN AND THE ACCOUNT NUMBER ARE SEEN IN PLAINTEXT. The schema
  setter encrypts them on assignment, which means a `match` validator on the model would
  run against ciphertext and always fail. Format enforcement therefore has to live here,
  and must not be moved or weakened — it is the only thing standing between a typo and a
  failed bank transfer nobody can debug, because the stored value cannot be eyeballed.
*/
export const validateAffiliateApplication = [
  body('name')
    .trim().notEmpty().withMessage('Name is required')
    .isLength({ max: 120 }).withMessage('Name too long'),
  body('email')
    .trim().notEmpty().withMessage('Email is required')
    .isEmail().withMessage('A valid email is required')
    .isLength({ max: 200 }).withMessage('Email too long')
    .normalizeEmail({ gmail_remove_dots: false }),
  body('phone')
    .trim().notEmpty().withMessage('Phone is required')
    .matches(/^(\+?91[\s-]?)?[6-9]\d{9}$/).withMessage('Enter a valid 10-digit Indian mobile number'),
  body('website')
    .trim().notEmpty().withMessage('A channel or social link is required')
    .isLength({ max: 500 }).withMessage('Link too long')
    // Bounded to http(s) so the admin reviewing an application cannot be handed a
    // `javascript:` or `data:` URL to click.
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('Include the full link, starting with https://'),
  body('pitch').optional({ values: 'falsy' })
    .trim().isLength({ max: 2000 }).withMessage('Please keep this under 2000 characters'),

  // ── Tax identity ───────────────────────────────────────────────────────────
  // Mandatory: TDS applies once annual commission passes the threshold, and the rate
  // without a PAN is materially higher. Collecting it later means collecting it from
  // someone who has already earned and is waiting to be paid.
  body('panNumber')
    .trim().notEmpty().withMessage('PAN is required')
    .toUpperCase()
    .matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/).withMessage('Enter a valid 10-character PAN'),
  // Optional: most affiliates will be below the registration threshold.
  body('gstin').optional({ values: 'falsy' })
    .trim().toUpperCase()
    .matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/).withMessage('Enter a valid 15-character GSTIN'),

  // ── Payout destination ─────────────────────────────────────────────────────
  body('accountHolderName')
    .trim().notEmpty().withMessage('Account holder name is required')
    .isLength({ max: 120 }).withMessage('Account holder name too long'),
  body('accountNumber')
    .trim().notEmpty().withMessage('Bank account number is required')
    .matches(/^\d{6,20}$/).withMessage('Account number must be 6–20 digits'),
  body('ifsc')
    .trim().notEmpty().withMessage('IFSC is required')
    .toUpperCase()
    .matches(/^[A-Z]{4}0[A-Z0-9]{6}$/).withMessage('Enter a valid 11-character IFSC'),

  // ── Address (GST place of supply) ──────────────────────────────────────────
  body('address.line1')
    .trim().notEmpty().withMessage('Address is required')
    .isLength({ max: 200 }).withMessage('Address too long'),
  body('address.line2').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
  body('address.city')
    .trim().notEmpty().withMessage('City is required')
    .isLength({ max: 100 }).withMessage('City too long'),
  // Constrained to the canonical GST list rather than free text: place of supply is
  // decided by this value, and "Kerela" is not a state.
  body('address.state')
    .trim().notEmpty().withMessage('State is required')
    .isIn(INDIAN_STATES).withMessage('Select your state from the list'),
  body('address.postalCode')
    .trim().notEmpty().withMessage('PIN code is required')
    .matches(/^[1-9]\d{5}$/).withMessage('Enter a valid 6-digit PIN code'),

  // ── Terms ──────────────────────────────────────────────────────────────────
  // The VERSION accepted is stamped by the server, never read from the body — a client
  // that could name its own version could choose which contract to be bound by. All the
  // client asserts is that the box was ticked.
  body('acceptTerms')
    .custom((v) => v === true || v === 'true')
    .withMessage('You must accept the Affiliate Programme Terms to apply'),
];

// ── Admin ─────────────────────────────────────────────────────────────────────

export const validateAffiliateId = [
  param('id').custom(isObjectId).withMessage('Invalid affiliate id'),
];

export const validateAffiliateList = [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be 1–100'),
  query('before').optional().isISO8601().withMessage('before must be a date cursor'),
  query('status').optional().isIn(AFFILIATE_STATUSES).withMessage('Invalid status'),
  query('search').optional().trim().isLength({ max: 100 }),
];

/**
 * Query validation for a COMMISSION ledger listing.
 *
 * Deliberately separate from `validateAffiliateList`, which was being reused here and
 * was wrong in both directions: it validates `status` against AFFILIATE statuses, so a
 * real filter like `?status=approved` 400'd, while `?status=suspended` sailed through
 * and silently returned an empty ledger — a filter that looks like it works and is not
 * filtering on anything that exists.
 */
export const validateCommissionList = [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be 1–100'),
  query('before').optional().isISO8601().withMessage('before must be a date cursor'),
  query('status').optional().isIn(COMMISSION_STATUSES).withMessage('Invalid commission status'),
];

export const validateAffiliateApprove = [
  // Optional: omitted means "derive one from their name" (affiliateService.codeFromName).
  body('code').optional({ values: 'falsy' })
    .trim().toUpperCase()
    .matches(CODE_REGEX)
    .withMessage('Code must be 3–24 characters: A–Z, 0–9, - or _, starting alphanumeric'),
  body('commissionPercent').optional().isFloat({ min: 0, max: 100 })
    .withMessage('commissionPercent must be 0–100'),
  body('repeatCommissionPercent').optional().isFloat({ min: 0, max: 100 })
    .withMessage('repeatCommissionPercent must be 0–100'),
  body('discountPercent').optional().isFloat({ min: 0, max: 100 })
    .withMessage('discountPercent must be 0–100'),
];

export const validateAffiliateTerms = [
  body('commissionPercent').optional().isFloat({ min: 0, max: 100 })
    .withMessage('commissionPercent must be 0–100'),
  // 0 is meaningful here: "pay nothing on repeat orders". isFloat({min:0}) keeps it.
  body('repeatCommissionPercent').optional().isFloat({ min: 0, max: 100 })
    .withMessage('repeatCommissionPercent must be 0–100'),
  body('discountPercent').optional().isFloat({ min: 0, max: 100 })
    .withMessage('discountPercent must be 0–100'),
  // Recorded, never derived — see the note on Affiliate.tdsPercent.
  body('tdsPercent').optional().isFloat({ min: 0, max: 100 })
    .withMessage('tdsPercent must be 0–100'),
  body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
];

export const validateAffiliateSuspend = [
  body('reason').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
];

export const validateAffiliateReject = [
  body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
];

/**
 * Bank details.
 *
 * Format checks ONLY. A well-formed IFSC is not a real branch and a well-formed PAN is
 * not a verified identity — there is no penny-drop or NPCI lookup here, and a passing
 * validation must never be read as "this account is confirmed".
 */
export const validateAffiliatePayoutDetails = [
  body('accountHolderName').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
  body('accountNumber').optional({ values: 'falsy' })
    .trim().matches(/^\d{6,20}$/).withMessage('Account number must be 6–20 digits'),
  body('ifsc').optional({ values: 'falsy' })
    .trim().toUpperCase().matches(/^[A-Z]{4}0[A-Z0-9]{6}$/).withMessage('Invalid IFSC code'),
  body('upiId').optional({ values: 'falsy' })
    .trim().isLength({ max: 120 })
    .matches(/^[\w.\-]{2,64}@[A-Za-z]{2,64}$/).withMessage('Invalid UPI ID'),
  body('panNumber').optional({ values: 'falsy' })
    .trim().toUpperCase().matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/).withMessage('Invalid PAN'),
];

// ── Payouts (Phase 4) ─────────────────────────────────────────────────────────

export const validatePayoutId = [
  param('payoutId').custom(isObjectId).withMessage('Invalid payout id'),
];

export const validatePayoutMarkPaid = [
  body('reference')
    .trim().notEmpty().withMessage('A bank reference (UTR) is required')
    .isLength({ max: 120 }).withMessage('Reference too long'),
  body('method').optional().isIn(PAYOUT_METHODS).withMessage('Invalid payout method'),
  body('notes').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
];

export const validatePayoutMarkFailed = [
  body('failureReason').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
];

export const validatePayoutList = [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be 1–100'),
  query('before').optional().isISO8601().withMessage('before must be a date cursor'),
  query('status').optional().trim().isLength({ max: 30 }),
  query('affiliate').optional().custom(isObjectId).withMessage('Invalid affiliate id'),
];
