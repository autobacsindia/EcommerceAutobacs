import mongoose from 'mongoose';
import { DATE_RE } from '../../config/hr.js';

/**
 * A company holiday. `sites` empty = every site; otherwise only those sites
 * (a store open on Diwali can be excluded). Working on one = 'holiday_worked'.
 */
const HrHolidaySchema = new mongoose.Schema({
  date: { type: String, required: true, match: DATE_RE },
  year: { type: Number, required: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  sites: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'HrWorkSite' }], default: [] },
  optional: { type: Boolean, default: false }, // restricted holiday employees may pick
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

HrHolidaySchema.index({ date: 1, name: 1 }, { name: 'hr_holiday_date_name_unique', unique: true });
HrHolidaySchema.index({ year: 1, date: 1 }, { name: 'hr_holiday_year_date' });

export default mongoose.models.HrHoliday || mongoose.model('HrHoliday', HrHolidaySchema);
