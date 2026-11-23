/**
 * HR system constants (docs/ADR-hr-system.md). One list per concept, shared by the
 * models (enums), the services (rules) and the tests, so a value can't drift
 * between the schema and the code that writes it.
 *
 * Conventions used across every HR collection:
 *   - Money is integer PAISE (`…Paise`). Never floats, never rupees.
 *   - Calendar days are IST strings 'YYYY-MM-DD'; payroll months are 'YYYY-MM'.
 *   - Leave is counted in HALF-DAYS (integer), so ½-day leave needs no floats.
 *   - Instants (`at`, `createdAt`) are real Dates (UTC).
 */

export const EMPLOYEE_STATUSES = Object.freeze(['onboarding', 'active', 'notice', 'exited']);
export const EMPLOYMENT_TYPES = Object.freeze(['full_time', 'part_time', 'intern', 'contract']);
export const TAX_REGIMES = Object.freeze(['new', 'old']);

export const EMPLOYEE_DOCUMENT_KINDS = Object.freeze([
  'offer_letter', 'appointment_letter', 'pan', 'aadhaar', 'bank_proof', 'photo',
  'resume', 'education', 'experience', 'relieving_letter', 'other',
]);

/** Default onboarding checklist; HrSettings may override the list. */
export const DEFAULT_ONBOARDING_ITEMS = Object.freeze([
  Object.freeze({ key: 'offer_signed', label: 'Offer letter signed' }),
  Object.freeze({ key: 'pan', label: 'PAN uploaded' }),
  Object.freeze({ key: 'bank', label: 'Bank / UPI details added' }),
  Object.freeze({ key: 'face', label: 'Face enrolled in the app' }),
  Object.freeze({ key: 'login', label: 'Login created' }),
  Object.freeze({ key: 'welcome', label: 'Welcome call done' }),
]);

// ── Attendance ───────────────────────────────────────────────────────────────
export const PUNCH_TYPES = Object.freeze(['in', 'out', 'break_start', 'break_end']);
export const PUNCH_STATUSES = Object.freeze(['accepted', 'pending_review', 'rejected']);
export const PUNCH_SOURCES = Object.freeze(['app', 'hr_manual', 'correction', 'auto_close', 'jibble_import']);
export const GEO_VERDICTS = Object.freeze(['inside', 'anywhere_allowed', 'outside', 'mocked', 'low_accuracy', 'none']);
export const FACE_VERDICTS = Object.freeze(['match', 'no_match', 'liveness_failed', 'not_enrolled', 'skipped']);
export const DAY_STATUSES = Object.freeze([
  'present', 'half_day', 'absent', 'leave', 'half_leave', 'holiday', 'weekly_off', 'holiday_worked',
]);
export const CORRECTION_STATUSES = Object.freeze(['pending', 'approved', 'rejected', 'cancelled']);
export const FACE_PROFILE_STATUSES = Object.freeze(['enrolled', 'reenrol_allowed', 'withdrawn', 'deleted']);

/** Site radius bounds (metres). Under 50 m GPS noise alone fails honest punches. */
export const SITE_RADIUS_MIN_M = 50;
export const SITE_RADIUS_MAX_M = 2000;

// ── Leave ────────────────────────────────────────────────────────────────────
export const LEAVE_STATUSES = Object.freeze(['pending_head', 'pending_hr', 'approved', 'rejected', 'cancelled']);
export const LEAVE_LEDGER_REASONS = Object.freeze([
  'grant', 'use', 'restore', 'adjust', 'carry_forward', 'lapse', 'encash', 'opening_balance',
]);
export const LEAVE_ACCRUALS = Object.freeze(['yearly_upfront', 'monthly']);

// ── Payroll ──────────────────────────────────────────────────────────────────
export const PAYROLL_RUN_STATUSES = Object.freeze(['draft', 'locked', 'approved']);
export const PAYROLL_HISTORY_ACTIONS = Object.freeze(['prepared', 'recomputed', 'locked', 'unlocked', 'approved', 'reopened', 'payouts_created']);
export const PAYSLIP_KINDS = Object.freeze(['monthly', 'final_settlement']);
export const SALARY_COMPONENT_KINDS = Object.freeze(['earning', 'deduction']);
export const PAYROLL_ADJUSTMENT_KINDS = Object.freeze([
  'bonus', 'arrears', 'other_earning', 'advance_recovery', 'other_deduction', 'leave_encashment',
]);
export const MONTH_DAY_BASES = Object.freeze(['calendar', 'fixed_30']);

// ── Exit ─────────────────────────────────────────────────────────────────────
export const EXIT_STATUSES = Object.freeze(['requested', 'accepted', 'settled', 'withdrawn']);
export const EXIT_TYPES = Object.freeze(['resignation', 'termination', 'contract_end', 'absconding']);

/** IST calendar date / month shapes. */
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
