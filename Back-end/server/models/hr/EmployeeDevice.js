import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/**
 * The phone(s) an employee punches from. First login binds a device; a change is
 * allowed once (HR is told); a second change within 30 days needs HR's OK
 * (services/hr/attendance/devices.js). `deviceId` is the app's install id, not a hardware id.
 */
const EmployeeDeviceSchema = new mongoose.Schema({
  employee: { type: ObjectId, ref: 'EmployeeProfile', required: true },
  deviceId: { type: String, required: true, maxlength: 100 },
  platform: { type: String, enum: ['ios', 'android'], required: true },
  model: { type: String, default: '', maxlength: 100 },
  active: { type: Boolean, default: true },
  // A phone that tried to punch while a change was not allowed (second change
  // inside HrSettings.deviceChangeCooldownDays). HR approves it from the panel;
  // until then it is inactive and its punches are refused (not stored).
  pendingApproval: { type: Boolean, default: false },
  boundAt: { type: Date, required: true },
  approvedBy: { type: ObjectId, ref: 'User', default: null },
  revokedAt: { type: Date, default: null },
}, { timestamps: true });

EmployeeDeviceSchema.index({ employee: 1, deviceId: 1 }, { name: 'hr_device_employee_device', unique: true });
EmployeeDeviceSchema.index({ employee: 1, active: 1, boundAt: -1 }, { name: 'hr_device_employee_active' });
// HR's "phones waiting for approval" list.
EmployeeDeviceSchema.index(
  { pendingApproval: 1, updatedAt: -1, _id: -1 },
  { name: 'hr_device_pending', partialFilterExpression: { pendingApproval: true } },
);

export default mongoose.models.EmployeeDevice || mongoose.model('EmployeeDevice', EmployeeDeviceSchema);
