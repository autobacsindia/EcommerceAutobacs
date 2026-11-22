import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/**
 * The phone(s) an employee punches from. First login binds a device; a change is
 * allowed once (HR is told); a second change within 30 days needs HR's OK
 * (services/hr/devices). `deviceId` is the app's install id, not a hardware id.
 */
const EmployeeDeviceSchema = new mongoose.Schema({
  employee: { type: ObjectId, ref: 'EmployeeProfile', required: true },
  deviceId: { type: String, required: true, maxlength: 100 },
  platform: { type: String, enum: ['ios', 'android'], required: true },
  model: { type: String, default: '', maxlength: 100 },
  active: { type: Boolean, default: true },
  boundAt: { type: Date, required: true },
  approvedBy: { type: ObjectId, ref: 'User', default: null },
  revokedAt: { type: Date, default: null },
}, { timestamps: true });

EmployeeDeviceSchema.index({ employee: 1, deviceId: 1 }, { name: 'hr_device_employee_device', unique: true });
EmployeeDeviceSchema.index({ employee: 1, active: 1, boundAt: -1 }, { name: 'hr_device_employee_active' });

export default mongoose.models.EmployeeDevice || mongoose.model('EmployeeDevice', EmployeeDeviceSchema);
