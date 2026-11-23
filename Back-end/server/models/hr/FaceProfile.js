import mongoose from 'mongoose';
import { FACE_PROFILE_STATUSES } from '../../config/hr.js';

const { ObjectId } = mongoose.Schema.Types;

/**
 * An employee's enrolled face (biometric data under India's DPDP Act 2023).
 *
 *   - `templateEnc` is the face EMBEDDING (a vector of numbers that cannot be
 *     turned back into a photo), encrypted with utils/fieldEncryption.js and
 *     never selected by default. No enrolment photo is kept.
 *   - Consent is explicit and versioned; withdrawing it switches the employee to
 *     manual attendance and deletes the template.
 *   - On exit the template is erased (`templateEnc` unset, status 'deleted',
 *     `deletedAt` set) and the row is kept only as proof of deletion.
 *
 * Nothing outside services/hr/face* reads `templateEnc`; HR sees the status
 * and dates, never the template.
 */
const ConsentSchema = new mongoose.Schema({
  version: { type: String, required: true, maxlength: 20 },
  acceptedAt: { type: Date, required: true },
  deviceId: { type: String, default: '', maxlength: 100 },
  ip: { type: String, default: '', maxlength: 64 },
}, { _id: false });

const FaceProfileSchema = new mongoose.Schema({
  employee: { type: ObjectId, ref: 'EmployeeProfile', required: true },
  status: { type: String, enum: FACE_PROFILE_STATUSES, required: true },
  templateEnc: { type: String, default: '', select: false },
  modelVersion: { type: String, default: '', maxlength: 40 },
  enrolledAt: { type: Date, default: null },
  consent: { type: ConsentSchema, default: null },
  withdrawnAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
  deletedReason: { type: String, default: '', maxlength: 200 },
  reenrolAllowedBy: { type: ObjectId, ref: 'User', default: null },
  rev: { type: Number, default: 0 },
}, { timestamps: true });

FaceProfileSchema.index({ employee: 1 }, { name: 'hr_face_employee_unique', unique: true });
FaceProfileSchema.index({ status: 1 }, { name: 'hr_face_status' });

export default mongoose.models.FaceProfile || mongoose.model('FaceProfile', FaceProfileSchema);
