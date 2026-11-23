/** Company holidays (models/hr/HrHoliday.js). */
import HrHoliday from '../../models/hr/HrHoliday.js';

const holidayRepository = {
  findById: (id) => HrHoliday.findById(id).lean(),
  create: async (doc, session = null) => {
    const [row] = await HrHoliday.create([doc], session ? { session } : {});
    return row.toObject();
  },
  deleteById: (id, session = null) => HrHoliday.findOneAndDelete({ _id: id }, { session }).lean(),
  page: (query, { sort, limit }) => HrHoliday.find(query).select('date year name sites optional').sort(sort).limit(limit).lean(),
  /** Non-optional holidays in [from, to] (bounded: at most a year's worth). */
  inRange: (from, to) => HrHoliday.find({ date: { $gte: from, $lte: to }, optional: false })
    .select('date name sites').sort({ date: 1 }).limit(400).lean(),
};

export default holidayRepository;
