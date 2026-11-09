import mongoose from 'mongoose';
import { STAFF_TEAM_VALUES } from '../config/staff.js';

export const DEPARTURE_STATUSES = ['open', 'left', 'cancelled'];

/**
 * Someone is leaving. `reason` is the private part: only admin and the person's
 * head ever receive it (admin only when the person leaving is a head).
 * `lastDay` is an IST calendar date, YYYY-MM-DD, like a task's due date.
 * Recording this changes nothing about the person's access or their work.
 */
const StaffDepartureSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, default: '' },
    team: { type: String, enum: STAFF_TEAM_VALUES, required: true },
    wasHead: { type: Boolean, default: false },
    lastDay: { type: String, required: true },
    reason: { type: String, default: '' },
    successor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    successorName: { type: String, default: '' },
    note: { type: String, default: '' },
    noteByName: { type: String, default: '' },
    noteAt: { type: Date, default: null },
    status: { type: String, enum: DEPARTURE_STATUSES, default: 'open' },
    // True only while open; unset afterwards so a person who returns and leaves again can be recorded.
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, default: '' },
    rev: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Also built by config/db.js ensureCriticalIndexes under the same name (autoIndex is off in production).
StaffDepartureSchema.index({ user: 1 }, { unique: true, partialFilterExpression: { active: true }, name: 'staff_departure_one_open' });

// Measured in tests/staffDepartureIndexUsage.test.js; also in ensureCriticalIndexes.
StaffDepartureSchema.index({ team: 1, wasHead: 1, _id: -1 }, { name: 'staff_departure_team' });
StaffDepartureSchema.index({ active: 1, lastDay: 1, team: 1 }, { name: 'staff_departure_due' });
StaffDepartureSchema.index({ active: 1, successor: 1 }, { name: 'staff_departure_successor' });
StaffDepartureSchema.index({ active: 1, user: 1 }, { name: 'staff_departure_person' });

export default mongoose.model('StaffDeparture', StaffDepartureSchema);
