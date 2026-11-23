import mongoose from 'mongoose';
import {
  PUNCH_TYPES, PUNCH_STATUSES, PUNCH_SOURCES, GEO_VERDICTS, FACE_VERDICTS, DATE_RE,
} from '../../config/hr.js';

const { ObjectId } = mongoose.Schema.Types;

/**
 * One clock-in / clock-out / break start / break end.
 *
 * IDEMPOTENT: the app generates `clientPunchId` (UUID) once per tap and reuses it
 * on every retry and on offline sync; { employee, clientPunchId } is unique, so a
 * double tap or a replayed sync yields exactly one punch (the service returns the
 * existing row on a duplicate-key error).
 *
 * Only punches that are ACCEPTED or need HR review are stored. A failed attempt
 * (outside the fence, face mismatch before the employee asks for review) is
 * answered and not persisted — these rows are the attendance record, not
 * telemetry.
 *
 * `at` is when it happened (device clock, sanity-checked against `receivedAt`
 * by the service); `date` is the IST workday it belongs to.
 */
const PunchSchema = new mongoose.Schema({
  employee: { type: ObjectId, ref: 'EmployeeProfile', required: true },
  user: { type: ObjectId, ref: 'User', default: null },
  clientPunchId: { type: String, required: true, maxlength: 64 },
  type: { type: String, enum: PUNCH_TYPES, required: true },
  at: { type: Date, required: true },
  receivedAt: { type: Date, required: true },
  date: { type: String, required: true, match: DATE_RE },
  source: { type: String, enum: PUNCH_SOURCES, default: 'app' },
  offline: { type: Boolean, default: false }, // queued on the phone, synced later

  site: { type: ObjectId, ref: 'HrWorkSite', default: null },
  geo: {
    type: new mongoose.Schema({
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      accuracyM: { type: Number, default: null },
      mocked: { type: Boolean, default: false },
      distanceM: { type: Number, default: null },
      verdict: { type: String, enum: GEO_VERDICTS, default: 'none' },
    }, { _id: false }),
    default: () => ({}),
  },
  face: {
    type: new mongoose.Schema({
      verdict: { type: String, enum: FACE_VERDICTS, default: 'skipped' },
      score: { type: Number, default: null },
      livenessPassed: { type: Boolean, default: false },
      modelVersion: { type: String, default: '' },
    }, { _id: false }),
    default: () => ({}),
  },
  deviceId: { type: String, default: '', maxlength: 100 },

  status: { type: String, enum: PUNCH_STATUSES, default: 'accepted', required: true },
  reviewNote: { type: String, default: '', maxlength: 500 },
  reviewedBy: { type: ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  createdBy: { type: ObjectId, ref: 'User', default: null }, // HR for manual/correction punches
}, { timestamps: true });

PunchSchema.index({ employee: 1, clientPunchId: 1 }, { name: 'hr_punch_idempotency', unique: true });
PunchSchema.index({ employee: 1, date: 1, at: 1 }, { name: 'hr_punch_employee_date_at' });
PunchSchema.index({ status: 1, receivedAt: -1, _id: -1 }, { name: 'hr_punch_status_received' });
PunchSchema.index({ date: 1, employee: 1 }, { name: 'hr_punch_date_employee' });

export default mongoose.models.AttendancePunch || mongoose.model('AttendancePunch', PunchSchema);
