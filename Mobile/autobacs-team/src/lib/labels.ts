/** Plain-English labels for server states. */
import type { ChallengeAction, DayStatus, LeaveStatus, PunchType } from '../api/types';
import type { Tone } from '../ui';
import { formatMinutes } from './dates';

export function dayChip(d: { status: DayStatus; isLate: boolean; lateMinutes: number; needsReview: boolean; firstIn: string | null; lastOut: string | null }): {
  label: string;
  tone: Tone;
} {
  if (d.needsReview && d.firstIn && !d.lastOut) return { label: 'No clock-out', tone: 'bad' };
  if (d.needsReview) return { label: 'With HR', tone: 'warn' };
  switch (d.status) {
    case 'present':
      return d.isLate ? { label: `Late ${formatMinutes(d.lateMinutes).replace(/^0h /, '')}`, tone: 'warn' } : { label: 'On time', tone: 'ok' };
    case 'half_day':
      return { label: 'Half day', tone: 'warn' };
    case 'absent':
      return { label: 'Absent', tone: 'bad' };
    case 'leave':
      return { label: 'Leave', tone: 'info' };
    case 'half_leave':
      return { label: 'Half-day leave', tone: 'info' };
    case 'holiday':
    case 'holiday_worked':
      return { label: 'Holiday', tone: 'info' };
    case 'weekly_off':
      return { label: 'Weekly off', tone: 'grey' };
    case 'in_progress':
      return { label: 'Working', tone: 'ok' };
    default:
      return { label: String(d.status).replace(/_/g, ' '), tone: 'grey' };
  }
}

export function leaveChip(s: LeaveStatus): { label: string; tone: Tone } {
  switch (s) {
    case 'approved':
      return { label: 'Approved', tone: 'ok' };
    case 'rejected':
      return { label: 'Not approved', tone: 'bad' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'grey' };
    case 'pending_head':
      return { label: 'Waiting for team head', tone: 'warn' };
    default:
      return { label: 'Waiting for HR', tone: 'warn' };
  }
}

export const PUNCH_LABEL: Record<PunchType, string> = {
  in: 'Clock in',
  out: 'Clock out',
  break_start: 'Start break',
  break_end: 'End break',
};

export const PUNCH_DONE: Record<PunchType, string> = {
  in: 'Clocked in',
  out: 'Clocked out',
  break_start: 'Break started',
  break_end: 'Break ended',
};

export const ACTION_PROMPT: Record<ChallengeAction, string> = {
  turn_left: 'Now turn your head slowly to your left',
  turn_right: 'Now turn your head slowly to your right',
  move_closer: 'Now bring the phone closer to your face',
};

/** What to do after a refused punch (server reason codes). */
export function refusalHelp(code: string | undefined): string | null {
  switch (code) {
    case 'outside_fence':
      return 'You need to be at your work site to clock in.';
    case 'low_accuracy':
      return 'Your location is not clear. Step outside or near a window and try again.';
    case 'mocked_location':
      return 'A fake-location app is on. Turn it off and try again.';
    case 'face_no_match':
    case 'liveness_failed':
      return 'Try again in good light, face straight to the camera. If it keeps failing, ask HR to check it.';
    case 'not_enrolled':
      return 'Set up your face first.';
    case 'device_blocked':
      return 'This phone is not approved yet. Ask HR to approve it.';
    case 'manual_attendance':
      return 'HR marks your attendance by hand. You do not need to clock in.';
    default:
      return null;
  }
}
