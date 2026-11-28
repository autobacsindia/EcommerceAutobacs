/** EmployeeDevice — data access only (services/hr/attendance/devices.js). */
import EmployeeDevice from '../../models/hr/EmployeeDevice.js';

const attendanceDeviceRepository = {
  listForEmployee: (employeeId, session = null) => EmployeeDevice.find({ employee: employeeId })
    .sort({ boundAt: -1, _id: -1 }).limit(50).session(session).lean(),
  find: (employeeId, deviceId, session = null) => EmployeeDevice
    .findOne({ employee: employeeId, deviceId }).session(session).lean(),
  /** Bind (or re-activate) a device. Unique {employee, deviceId}. */
  upsertActive: (employeeId, deviceId, set, session = null) => EmployeeDevice.findOneAndUpdate(
    { employee: employeeId, deviceId },
    { $set: { ...set, active: true, pendingApproval: false, revokedAt: null } },
    { upsert: true, new: true, setDefaultsOnInsert: true, session },
  ).lean(),
  markPending: (employeeId, deviceId, set) => EmployeeDevice.findOneAndUpdate(
    { employee: employeeId, deviceId, active: false },
    { $set: { ...set, pendingApproval: true }, $setOnInsert: { active: false } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean(),
  deactivateOthers: (employeeId, keepDeviceId, at, session = null) => EmployeeDevice.updateMany(
    { employee: employeeId, deviceId: { $ne: keepDeviceId }, active: true },
    { $set: { active: false, revokedAt: at } },
    { session },
  ),
  revokeAll: (employeeId, at, session = null) => EmployeeDevice.updateMany(
    { employee: employeeId, $or: [{ active: true }, { pendingApproval: true }] },
    { $set: { active: false, pendingApproval: false, revokedAt: at } },
    { session },
  ),
  listPending: (query, { sort, limit }) => EmployeeDevice.find(query).sort(sort).limit(limit).lean(),
};

export default attendanceDeviceRepository;
