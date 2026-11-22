import mongoose from 'mongoose';
import { HHMM_RE } from '../../config/hr.js';

/**
 * A shift and its attendance rules. Example: 10:00–19:00, 10 min grace,
 * 3 lates = ½ day LOP, under 270 min = half day, over 540 min = overtime
 * (paid only when HR approves it). Times are IST wall-clock 'HH:mm'.
 * Overnight shifts (end < start) are allowed; the workday is the start date.
 */
const HrShiftSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  start: { type: String, required: true, match: HHMM_RE },
  end: { type: String, required: true, match: HHMM_RE },
  graceMinutes: { type: Number, default: 10, min: 0, max: 120 },
  // Late marks in a month that cost half a day of pay (0 = never).
  latesPerHalfDayLop: { type: Number, default: 3, min: 0, max: 31 },
  halfDayMinMinutes: { type: Number, default: 270, min: 0, max: 1440 },
  fullDayMinutes: { type: Number, default: 540, min: 1, max: 1440 },
  // Worked minutes beyond this count as overtime (before HR approval).
  overtimeAfterMinutes: { type: Number, default: 540, min: 1, max: 1440 },
  breakAllowanceMinutes: { type: Number, default: 60, min: 0, max: 600 },
  // 0 = Sunday … 6 = Saturday.
  weeklyOff: { type: [{ type: Number, min: 0, max: 6 }], default: [0] },
  isDefault: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rev: { type: Number, default: 0 },
}, { timestamps: true });

HrShiftSchema.index({ active: 1, name: 1 }, { name: 'hr_shift_active_name' });
// At most one default shift.
HrShiftSchema.index(
  { isDefault: 1 },
  { name: 'hr_shift_one_default', unique: true, partialFilterExpression: { isDefault: true } },
);

export default mongoose.models.HrShift || mongoose.model('HrShift', HrShiftSchema);
