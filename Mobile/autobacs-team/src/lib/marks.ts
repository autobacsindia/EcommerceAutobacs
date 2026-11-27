/**
 * Plain-English lines for "my late/early marks and overtime" (pure — tested in
 * tests/marks.test.ts). The SERVER counts marks, LOP and approved overtime;
 * this only words what it sent. Rule numbers come from the server's `rules`;
 * without them the copy stays general rather than guess a figure HR changed.
 */
import type { AttendanceDay, MonthSummary } from '../api/types';
import { formatPaise } from './format';

export type MarkRow = { date: string; late: number; early: number; otMinutes: number; otApproved: number; otStatus: string };

/** Days worth showing: a mark, or overtime (pending or decided). Newest first. */
export function markRows(days: AttendanceDay[]): MarkRow[] {
  return days
    .filter((d) => d.isLate || d.isEarly || d.overtimeMinutes > 0)
    .map((d) => ({
      date: d.date,
      late: d.isLate ? d.lateMinutes : 0,
      early: d.isEarly ? d.earlyMinutes ?? 0 : 0,
      otMinutes: d.overtimeMinutes,
      otApproved: d.overtimeApprovedMinutes ?? 0,
      otStatus: d.overtimeStatus ?? (d.overtimeMinutes > 0 ? 'pending' : 'none'),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Marks this month: the server's figure, else late days (older servers). */
export function totalMarks(s: MonthSummary): number {
  if (s.marks != null) return s.marks;
  if (s.lateCount != null || s.earlyCount != null) return (s.lateCount ?? 0) + (s.earlyCount ?? 0);
  return s.lateMarks;
}

const hm = (min: number) => {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
};
export const minutesText = hm;

/** "½ day", "1 day", "1½ days" */
export function daysText(days: number): string {
  const whole = Math.floor(days);
  const half = days - whole >= 0.5;
  if (!whole && half) return '½ day';
  return `${whole}${half ? '½' : ''} ${whole === 1 && !half ? 'day' : 'days'}`;
}

/** The rules, worded. */
export function ruleLines(s: MonthSummary): string[] {
  const r = s.rules;
  const lines: string[] = [];
  if (r?.graceMinutes != null) lines.push(`Coming in more than ${r.graceMinutes} min after your shift starts = 1 mark.`);
  else lines.push('Coming in late = 1 mark.');
  if (r?.earlyGraceMinutes != null) lines.push(`Leaving more than ${r.earlyGraceMinutes} min before your shift ends = 1 mark.`);
  else lines.push('Leaving early = 1 mark.');
  const perHalf = s.marksPerHalfDayLop ?? r?.marksPerHalfDayLop;
  if (perHalf) lines.push(`Every ${perHalf} marks in a month = ½ day of pay cut.`);
  else lines.push('Marks can cut pay at the end of the month.');
  if (r?.overtimeAfterMinutes != null) {
    lines.push(`Work after ${hm(r.overtimeAfterMinutes)} in a day is overtime${r.overtimeMultiplier ? `, paid at ${r.overtimeMultiplier}x` : ''} — only when your head or HR approves it.`);
  } else {
    lines.push('Overtime is paid only when your head or HR approves it.');
  }
  if (r?.punctualityBonusPaise) lines.push(`On-time bonus: ${formatPaise(r.punctualityBonusPaise)} a month when you have few or no marks.`);
  return lines;
}

/** One sentence on what the marks cost this month. */
export function marksVerdict(s: MonthSummary): string {
  const marks = totalMarks(s);
  if (!marks) return 'No marks this month. Well done.';
  const lop = s.marksLopDays ?? 0;
  const base = `${marks} ${marks === 1 ? 'mark' : 'marks'} this month.`;
  return lop > 0 ? `${base} That cuts ${daysText(lop)} of pay.` : `${base} No pay cut yet.`;
}
