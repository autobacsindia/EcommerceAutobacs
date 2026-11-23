/**
 * Leave form checks done on the phone — only the ones that save a round trip
 * for an obvious mistake. The SERVER decides everything else (balance, notice,
 * overlaps, weekly offs and holidays) and computes the real half-day count.
 */
import type { LeaveInput, LeaveType } from '../api/types';
import { isRealDate } from './dates';

export type DayPart = 'full' | 'first_half' | 'second_half';

export type LeaveDraft = {
  leaveType: LeaveType | null;
  from: string;
  to: string;
  part: DayPart;
  reason: string;
};

export type LeaveErrors = Partial<Record<'leaveType' | 'from' | 'to' | 'part' | 'reason', string>>;

export type LeaveCheck = { ok: true; input: Omit<LeaveInput, 'clientRequestId'> } | { ok: false; errors: LeaveErrors };

export const REASON_MIN = 3;
export const REASON_MAX = 500;

export function validateLeave(d: LeaveDraft): LeaveCheck {
  const errors: LeaveErrors = {};
  const reason = d.reason.trim();

  if (!d.leaveType) errors.leaveType = 'Pick a leave type.';
  if (!isRealDate(d.from)) errors.from = 'Pick the first day.';
  if (!isRealDate(d.to)) errors.to = 'Pick the last day.';
  if (!errors.from && !errors.to) {
    if (d.to < d.from) errors.to = 'The last day must be on or after the first day.';
    else if (d.from.slice(0, 4) !== d.to.slice(0, 4)) errors.to = 'Leave across the new year needs two requests, one per year.';
  }
  if (d.part !== 'full') {
    if (d.from !== d.to) errors.part = 'A half day is for one date only. Make the first and last day the same.';
    else if (d.leaveType && !d.leaveType.allowHalfDay) errors.part = `${d.leaveType.name} can only be taken in full days.`;
  }
  if (reason.length < REASON_MIN) errors.reason = 'Please write a short reason.';
  else if (reason.length > REASON_MAX) errors.reason = `Keep the reason under ${REASON_MAX} letters.`;

  if (Object.keys(errors).length || !d.leaveType) return { ok: false, errors };
  return {
    ok: true,
    input: {
      leaveType: d.leaveType.id,
      from: d.from,
      to: d.to,
      ...(d.part === 'first_half' ? { firstHalfOnly: true } : {}),
      ...(d.part === 'second_half' ? { secondHalfOnly: true } : {}),
      reason,
    },
  };
}

/** Calendar estimate for the hint line only; the server's count is the real one. */
export function estimateHalfDays(d: Pick<LeaveDraft, 'from' | 'to' | 'part'>): number | null {
  if (!isRealDate(d.from) || !isRealDate(d.to) || d.to < d.from) return null;
  if (d.part !== 'full') return 1;
  const days = Math.round((Date.parse(`${d.to}T00:00:00Z`) - Date.parse(`${d.from}T00:00:00Z`)) / 86_400_000) + 1;
  return days * 2;
}
