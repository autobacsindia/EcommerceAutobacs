/**
 * Work sites (models/hr/HrWorkSite.js) and shifts (models/hr/HrShift.js).
 * Data access only — rules live in services/hr/attendance/setupService.js.
 * Both collections are small (a handful of rows) and admin-edited.
 */
import HrWorkSite from '../../models/hr/HrWorkSite.js';
import HrShift from '../../models/hr/HrShift.js';

const casUpdate = (Model) => (id, rev, set) => Model.findOneAndUpdate(
  { _id: id, rev },
  { $set: set, $inc: { rev: 1 } },
  { new: true, runValidators: true },
).lean();

const attendanceSetupRepository = {
  // ── Sites ────────────────────────────────────────────────────────────────
  listSites: (query, { sort, limit }) => HrWorkSite.find(query).sort(sort).limit(limit).lean(),
  findSiteById: (id) => HrWorkSite.findById(id).lean(),
  /** The active sites among `ids` (an employee's allowed sites), only what the fence needs. */
  findActiveSitesByIds: (ids) => HrWorkSite.find({ _id: { $in: ids }, active: true })
    .select('name lat lng radiusM').lean(),
  createSite: async (doc) => (await HrWorkSite.create(doc)).toObject(),
  updateSiteIfRev: casUpdate(HrWorkSite),
  validateSite: (doc) => new HrWorkSite(doc).validate(),

  // ── Shifts ───────────────────────────────────────────────────────────────
  listShifts: (query, { sort, limit }) => HrShift.find(query).sort(sort).limit(limit).lean(),
  findShiftById: (id) => HrShift.findById(id).lean(),
  findDefaultShift: () => HrShift.findOne({ isDefault: true, active: true }).lean(),
  createShift: async (doc, session = null) => {
    const [row] = await HrShift.create([doc], session ? { session } : {});
    return row.toObject();
  },
  updateShiftIfRev: (id, rev, set, session = null) => HrShift.findOneAndUpdate(
    { _id: id, rev },
    { $set: set, $inc: { rev: 1 } },
    { new: true, runValidators: true, session },
  ).lean(),
  /** Clears the default flag from every other shift (inside the caller's transaction). */
  clearDefaultExcept: (id, session = null) => HrShift.updateMany(
    { isDefault: true, _id: { $ne: id } },
    { $set: { isDefault: false }, $inc: { rev: 1 } },
    { session },
  ),
  validateShift: (doc) => new HrShift(doc).validate(),
};

export default attendanceSetupRepository;
