import mongoose from 'mongoose';
import { MONTH_DAY_BASES } from '../../config/hr.js';

/**
 * Company-wide HR settings: ONE document, key 'default' (same pattern as
 * models/TaskRulesConfig.js). Read through services/hr/settings.js, which fills
 * in these defaults when the document doesn't exist yet.
 *
 * Statutory rates are SETTINGS, not code, because the government changes them;
 * each payroll run snapshots what it used. Defaults are the published rates at
 * the time of writing and must be confirmed by the owner/CA before go-live.
 */
const PtSlabSchema = new mongoose.Schema({
  // Gross monthly wage from which this slab applies (paise), and the monthly PT.
  fromPaise: { type: Number, required: true, min: 0 },
  ptPaise: { type: Number, required: true, min: 0 },
}, { _id: false });

const HrSettingsSchema = new mongoose.Schema({
  key: { type: String, required: true, default: 'default' },

  // Attendance
  faceMatchThreshold: { type: Number, default: 0.6, min: 0, max: 1 },
  gpsMaxAccuracyM: { type: Number, default: 100, min: 10, max: 1000 },
  offlineMaxHours: { type: Number, default: 24, min: 1, max: 168 },
  maxFaceAttempts: { type: Number, default: 3, min: 1, max: 10 },
  faceReviewPhotoDays: { type: Number, default: 30, min: 1, max: 90 },
  deviceChangeCooldownDays: { type: Number, default: 30, min: 0, max: 365 },
  autoCloseTime: { type: String, default: '23:59' }, // IST; closes open days at the shift end

  // Attendance policy (owner decisions 2026-11-26). Day-level rules (grace,
  // early grace, half day, absent-below, overtime-after) live on HrShift.
  // Every this-many late/early marks in a payroll month = ½ day LOP (0 = never).
  marksPerHalfDayLop: { type: Number, default: 3, min: 0, max: 31 },
  // Approved overtime is paid at this × the hourly rate (payroll reads it).
  overtimeMultiplier: { type: Number, default: 2, min: 1, max: 5 },
  // Punctuality bonus per month: full for ≤ fullMaxMarks, half for ≤ halfMaxMarks,
  // none above that or with any unapproved absence (payroll reads it).
  punctualityBonusPaise: { type: Number, default: 50000, min: 0 }, // ₹500
  punctualityFullMaxMarks: { type: Number, default: 2, min: 0, max: 62 },
  punctualityHalfMaxMarks: { type: Number, default: 4, min: 0, max: 62 },

  // Leave approval chain: head then HR (headStep false = HR only).
  leaveHeadStep: { type: Boolean, default: true },

  // Payroll
  monthDayBasis: { type: String, enum: MONTH_DAY_BASES, default: 'calendar' },
  payday: { type: Number, default: 7, min: 1, max: 28 },
  pfEmployeeRate: { type: Number, default: 0.12, min: 0, max: 1 },
  pfEmployerRate: { type: Number, default: 0.12, min: 0, max: 1 },
  pfWageCeilingPaise: { type: Number, default: 1500000, min: 0 }, // ₹15,000
  esiEmployeeRate: { type: Number, default: 0.0075, min: 0, max: 1 },
  esiEmployerRate: { type: Number, default: 0.0325, min: 0, max: 1 },
  esiGrossThresholdPaise: { type: Number, default: 2100000, min: 0 }, // ₹21,000
  // State → PT slabs (ascending fromPaise). Empty until the owner confirms the state.
  ptSlabs: { type: Map, of: [PtSlabSchema], default: () => new Map() },
  // Include the approved Roav Points/incentive month on the payslip.
  includeIncentives: { type: Boolean, default: false },

  onboardingItems: {
    type: [new mongoose.Schema({
      key: { type: String, required: true, maxlength: 40 },
      label: { type: String, required: true, maxlength: 120 },
    }, { _id: false })],
    default: undefined, // undefined = config/hr.js DEFAULT_ONBOARDING_ITEMS
  },

  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  rev: { type: Number, default: 0 },
}, { timestamps: true });

HrSettingsSchema.index({ key: 1 }, { name: 'hr_settings_key_unique', unique: true });

export default mongoose.models.HrSettings || mongoose.model('HrSettings', HrSettingsSchema);
