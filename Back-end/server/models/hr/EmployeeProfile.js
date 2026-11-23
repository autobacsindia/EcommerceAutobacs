import mongoose from 'mongoose';
import {
  EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, TAX_REGIMES, DATE_RE,
} from '../../config/hr.js';

const { ObjectId } = mongoose.Schema.Types;

/**
 * One employee as HR knows them (docs/ADR-hr-system.md). The LOGIN stays on User
 * (role 'staff' + staff.team); this is the HR record beside it.
 *
 * `user` is optional so HR can start onboarding a new joiner before their login
 * exists; it is linked when the staff invite is accepted. One profile per user
 * (unique, scoped with $type so the many not-yet-linked profiles don't collide —
 * `$ne` is not allowed in a partialFilterExpression).
 *
 * Sensitive identifiers (PAN, bank account, UPI) are stored ENCRYPTED with
 * utils/fieldEncryption.js and never selected by default; Aadhaar is kept as the
 * last four digits only. Lists project a small field set; nothing here is ever
 * sent to a user other than HR/admin and the employee themself.
 */
const OnboardingItemSchema = new mongoose.Schema({
  key: { type: String, required: true, maxlength: 40 },
  label: { type: String, required: true, maxlength: 120 },
  done: { type: Boolean, default: false },
  doneAt: { type: Date, default: null },
  doneBy: { type: ObjectId, ref: 'User', default: null },
}, { _id: false });

const EmployeeProfileSchema = new mongoose.Schema({
  user: { type: ObjectId, ref: 'User', default: null },
  // EMP-0001 … from the 'employee_code' counter.
  employeeCode: { type: String, required: true },
  status: { type: String, enum: EMPLOYEE_STATUSES, default: 'onboarding', required: true },

  name: { type: String, required: true, trim: true, maxlength: 120 },
  workEmail: { type: String, default: '', lowercase: true, trim: true, maxlength: 200 },
  personalEmail: { type: String, default: '', lowercase: true, trim: true, maxlength: 200 },
  phone: { type: String, default: '', maxlength: 20 },
  designation: { type: String, default: '', maxlength: 120 },
  team: { type: String, default: '', maxlength: 40 }, // snapshot of User.staff.team for lists
  manager: { type: ObjectId, ref: 'User', default: null },
  employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: 'full_time' },
  joinDate: { type: String, default: null, match: DATE_RE },
  exitDate: { type: String, default: null, match: DATE_RE },
  dob: { type: String, default: null, match: DATE_RE },
  gender: { type: String, enum: ['male', 'female', 'other', ''], default: '' },
  address: { type: String, default: '', maxlength: 500 },
  emergencyContact: {
    type: new mongoose.Schema({
      name: { type: String, default: '', maxlength: 120 },
      relation: { type: String, default: '', maxlength: 40 },
      phone: { type: String, default: '', maxlength: 20 },
    }, { _id: false }),
    default: () => ({}),
  },

  // Attendance setup (attendance session owns the rules that read these).
  shift: { type: ObjectId, ref: 'HrShift', default: null },
  workSites: { type: [{ type: ObjectId, ref: 'HrWorkSite' }], default: [] },
  // Field staff: may punch anywhere (still face-checked, marked "outside site").
  anywhereAllowed: { type: Boolean, default: false },
  // No face consent / can't use the app: HR records attendance by hand.
  manualAttendance: { type: Boolean, default: false },

  // Statutory + pay details. *Enc fields: utils/fieldEncryption.js.
  panEnc: { type: String, default: '', select: false },
  panLast4: { type: String, default: '', maxlength: 4 },
  aadhaarLast4: { type: String, default: '', maxlength: 4 },
  uan: { type: String, default: '', maxlength: 12 },
  esicNumber: { type: String, default: '', maxlength: 17 },
  taxRegime: { type: String, enum: TAX_REGIMES, default: 'new' },
  bank: {
    type: new mongoose.Schema({
      holderName: { type: String, default: '', maxlength: 120 },
      accountEnc: { type: String, default: '', select: false },
      accountLast4: { type: String, default: '', maxlength: 4 },
      ifsc: { type: String, default: '', uppercase: true, maxlength: 11 },
      upiEnc: { type: String, default: '', select: false },
      hasUpi: { type: Boolean, default: false },
    }, { _id: false }),
    default: () => ({}),
  },

  // Small, bounded (≤ 30 items, enforced in the service).
  onboarding: { type: [OnboardingItemSchema], default: [] },

  createdBy: { type: ObjectId, ref: 'User', required: true },
  updatedBy: { type: ObjectId, ref: 'User', default: null },
  // Optimistic concurrency: every write is `{ _id, rev }` → `$inc: { rev: 1 }`.
  rev: { type: Number, default: 0 },
}, { timestamps: true });

EmployeeProfileSchema.index(
  { user: 1 },
  { name: 'hr_employee_user_unique', unique: true, partialFilterExpression: { user: { $type: 'objectId' } } },
);
EmployeeProfileSchema.index({ employeeCode: 1 }, { name: 'hr_employee_code_unique', unique: true });
// HR list: by status, A→Z by name, keyset on (name, _id).
EmployeeProfileSchema.index({ status: 1, name: 1, _id: 1 }, { name: 'hr_employee_status_name' });
EmployeeProfileSchema.index({ team: 1, status: 1, name: 1, _id: 1 }, { name: 'hr_employee_team_status_name' });
EmployeeProfileSchema.index({ manager: 1, status: 1 }, { name: 'hr_employee_manager_status' });

export default mongoose.models.EmployeeProfile || mongoose.model('EmployeeProfile', EmployeeProfileSchema);
