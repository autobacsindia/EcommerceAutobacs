import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/**
 * The Expo push token of one Autobacs Team install, per employee + device.
 * `deviceId` is the same per-install id the app sends with punches
 * (EmployeeDevice.deviceId), so "one token per EmployeeDevice" holds without
 * editing the attendance-owned EmployeeDevice model: a phone that never punched
 * yet can still get "leave approved".
 *
 * A token belongs to one install, so it is unique: when a shared phone signs in
 * as someone else, the row moves (services/hr/notify). Removed on sign-out and
 * when Expo says the device is gone.
 */
const EmployeePushTokenSchema = new mongoose.Schema({
  employee: { type: ObjectId, ref: 'EmployeeProfile', required: true },
  user: { type: ObjectId, ref: 'User', default: null },
  deviceId: { type: String, required: true, maxlength: 100 },
  token: { type: String, required: true, maxlength: 200 },
  platform: { type: String, enum: ['ios', 'android'], required: true },
  // Refusals in a row (not "gone"); MAX_FAILURES → removed. A delivery resets it.
  failures: { type: Number, default: 0 },
  lastSeenAt: { type: Date, required: true },
}, { timestamps: true });

EmployeePushTokenSchema.index({ employee: 1, deviceId: 1 }, { name: 'hr_push_employee_device', unique: true });
EmployeePushTokenSchema.index({ token: 1 }, { name: 'hr_push_token', unique: true });

export default mongoose.models.EmployeePushToken || mongoose.model('EmployeePushToken', EmployeePushTokenSchema);
