import mongoose from 'mongoose';

/**
 * A person-to-person call in a team-chat DM (services/chatCallService.js).
 *
 * The audio and video never touch our servers: the two browsers connect to
 * each other with WebRTC. This record is the call's *management* — who rang
 * whom, whether it was answered, when it ended and why — and the authority for
 * who may exchange connection-setup messages ("signals") for it.
 *
 * Lifecycle: ringing → active → ended (or ringing → ended for declined /
 * missed / cancelled / busy). `live` is true until the call ends, and every
 * transition is a conditional update on the current state, so two racing
 * requests (both hang up, a hang-up and the ring timeout…) settle to one
 * outcome and one chat line.
 */
export const CALL_MEDIA = Object.freeze(['audio', 'video']);
export const CALL_STATUSES = Object.freeze(['ringing', 'active', 'ended']);
export const CALL_END_REASONS = Object.freeze([
  'completed', // answered, then someone hung up
  'declined',  // the person called said no
  'missed',    // nobody answered in time
  'cancelled', // the caller hung up before an answer
  'failed',    // a side vanished mid-call (tab closed, network gone)
]);

const ChatCallSchema = new mongoose.Schema(
  {
    channel: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatChannel', required: true },
    caller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    callee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    media: { type: String, enum: CALL_MEDIA, default: 'video' },
    status: { type: String, enum: CALL_STATUSES, default: 'ringing' },
    // true while ringing or active. The unique partial index below makes "one
    // live call per conversation" a database guarantee, not a check-then-write.
    live: { type: Boolean, default: true },
    // Which browser tab of each person is in the call. Signals are addressed to
    // a tab, so a second open tab of the same person never answers or listens in.
    callerDevice: { type: String, default: null, maxlength: 64 },
    calleeDevice: { type: String, default: null, maxlength: 64 },
    // Heartbeats while the call is up; a side silent for too long is gone.
    callerSeenAt: { type: Date, default: null },
    calleeSeenAt: { type: Date, default: null },
    ringUntil: { type: Date, required: true },
    answeredAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    endReason: { type: String, enum: CALL_END_REASONS, default: undefined },
    endedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// One live call per DM. Equality in the partial filter ($ne is not allowed there).
ChatCallSchema.index(
  { channel: 1 },
  { name: 'chat_call_live_channel', unique: true, partialFilterExpression: { live: true } }
);
// "Is this person already on a call?" (busy) and "do I have a call to rejoin?".
ChatCallSchema.index(
  { caller: 1 },
  { name: 'chat_call_live_caller', partialFilterExpression: { live: true } }
);
ChatCallSchema.index(
  { callee: 1 },
  { name: 'chat_call_live_callee', partialFilterExpression: { live: true } }
);

// The sweep: live calls whose ring ran out or whose heartbeats stopped.
ChatCallSchema.index(
  { status: 1 },
  { name: 'chat_call_live_status', partialFilterExpression: { live: true } }
);

const ChatCall = mongoose.models.ChatCall || mongoose.model('ChatCall', ChatCallSchema);
export default ChatCall;
