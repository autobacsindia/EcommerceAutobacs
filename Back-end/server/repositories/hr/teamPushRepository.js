/** Push tokens + notification rows (services/hr/notify) — data access only. */
import EmployeePushToken from '../../models/hr/EmployeePushToken.js';
import HrNotification from '../../models/hr/HrNotification.js';
import AttendanceDay from '../../models/hr/AttendanceDay.js';

const TOKENS_PER_EMPLOYEE = 10;

const teamPushRepository = {
  /** Move `token` to {employee, deviceId}: drop it anywhere else first (unique token). */
  releaseToken: (token, employeeId, deviceId) => EmployeePushToken.deleteMany({
    token, $or: [{ employee: { $ne: employeeId } }, { deviceId: { $ne: deviceId } }],
  }),
  upsertToken: (employeeId, deviceId, set) => EmployeePushToken.findOneAndUpdate(
    { employee: employeeId, deviceId },
    { $set: { ...set, failures: 0 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean(),
  removeDevice: (employeeId, deviceId) => EmployeePushToken.deleteOne({ employee: employeeId, deviceId }),
  removeTokens: (tokens) => EmployeePushToken.deleteMany({ token: { $in: tokens } }),
  tokensFor: (employeeId) => EmployeePushToken.find({ employee: employeeId })
    .select('token platform failures').sort({ lastSeenAt: -1 }).limit(TOKENS_PER_EMPLOYEE).lean(),
  countFor: (employeeId) => EmployeePushToken.countDocuments({ employee: employeeId }),
  bumpFailures: (tokens) => EmployeePushToken.updateMany({ token: { $in: tokens } }, { $inc: { failures: 1 } }),
  resetFailures: (tokens) => EmployeePushToken.updateMany({ token: { $in: tokens }, failures: { $gt: 0 } }, { $set: { failures: 0 } }),
  removeFailing: (max) => EmployeePushToken.deleteMany({ failures: { $gte: max } }),

  createNotification: (doc) => HrNotification.create(doc),
  findNotification: (id) => HrNotification.findById(id).lean(),
  findNotificationByKey: (key) => HrNotification.findOne({ key }).lean(),
  markSentTo: (id, tokens) => HrNotification.updateOne({ _id: id }, { $addToSet: { sentTo: { $each: tokens } } }),
  finishNotification: (id, set) => HrNotification.updateOne({ _id: id, status: 'queued' }, { $set: set }),

  /**
   * Days closed automatically (no clock-out) on `date`. Read-only; uses the
   * attendance-owned index hr_day_date_status (date prefix). Bounded.
   */
  autoClosedDays: (date, limit = 1000) => AttendanceDay.find({ date, autoClosed: true })
    .select('employee date').limit(limit).lean(),
};

export default teamPushRepository;
