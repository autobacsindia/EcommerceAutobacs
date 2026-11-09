import mongoose from 'mongoose';

export const HANDOVER_KINDS = ['task', 'lead', 'quotation', 'lesson'];

/**
 * One piece of work in one handover: who had it, who it went to, and whether it
 * got there. This is the permanent record of who started a deal once the new
 * person has the credit for closing it.
 */
const StaffHandoverMoveSchema = new mongoose.Schema({
  departure: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffDeparture', required: true },
  kind: { type: String, enum: HANDOVER_KINDS, required: true },
  ref: { type: mongoose.Schema.Types.ObjectId, required: true },
  label: { type: String, default: '' },
  fromName: { type: String, default: '' },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  toName: { type: String, default: '' },
  byName: { type: String, default: '' },
  // 'pending' is written first, so a crash mid-move leaves a trace.
  state: { type: String, enum: ['pending', 'moved', 'failed'], default: 'pending' },
  error: { type: String, default: '' },
  at: { type: Date, required: true },
}, { collection: 'staffhandovermoves' });

// Also built by config/db.js ensureCriticalIndexes under the same name.
StaffHandoverMoveSchema.index({ departure: 1, kind: 1, ref: 1 }, { unique: true, name: 'staff_handover_move_one' });

export default mongoose.model('StaffHandoverMove', StaffHandoverMoveSchema);
