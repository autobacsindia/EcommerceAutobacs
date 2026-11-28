/**
 * Read-only access to the employee's SHIFT for leave day-counting (weekly offs).
 * HrShift belongs to the attendance session; leave only reads two fields, so
 * the read lives here rather than reaching into their repository.
 */
import HrShift from '../../models/hr/HrShift.js';

const leaveCalendarRepository = {
  findShift: (id) => HrShift.findById(id).select('weeklyOff active').lean(),
  findDefaultShift: () => HrShift.findOne({ isDefault: true, active: true }).select('weeklyOff').lean(),
};

export default leaveCalendarRepository;
