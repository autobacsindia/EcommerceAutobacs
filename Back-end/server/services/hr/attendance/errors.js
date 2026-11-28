/**
 * A punch (or face step) the server REFUSES: answered with 422 and a reason code
 * the app turns into a person-readable screen. Refusals are not stored (ADR §5.4
 * — the punch collection is the attendance record, not telemetry).
 *
 * Codes from the ADR: outside_fence, low_accuracy, mocked_location,
 * face_no_match, liveness_failed, not_enrolled, sequence. Added here:
 *   device_blocked     a second phone change inside the cooldown; HR must approve
 *   manual_attendance  HR records this person's attendance by hand
 *   bad_time           a punch time in the future or far in the past
 */
import AppError from '../../../utils/AppError.js';

export const REFUSAL_CODES = Object.freeze([
  'outside_fence', 'low_accuracy', 'mocked_location', 'face_no_match', 'liveness_failed', 'not_enrolled', 'sequence',
  'device_blocked', 'manual_attendance', 'bad_time',
]);

export class AttendanceRefusal extends AppError {
  constructor(code, message, extra = {}) {
    super(message, 422, { expose: true });
    this.name = 'AttendanceRefusal';
    this.code = code;
    this.extra = extra;
  }
}

export const refuse = (code, message, extra) => new AttendanceRefusal(code, message, extra);
export const fail = (message, status) => new AppError(message, status, { expose: true });
