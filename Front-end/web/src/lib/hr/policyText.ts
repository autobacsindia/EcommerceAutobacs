/**
 * Plain-English example lines for the attendance rules page. These explain a
 * SETTING with counts and clock times only. They never work out a rupee amount
 * of pay; payroll does that on the server.
 */

/** 'HH:mm' + minutes → 'HH:mm' (wraps past midnight). */
export function addMinutes(hhmm: string, minutes: number): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const total = (((Number(m[1]) * 60 + Number(m[2]) + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Minutes → "9 h", "4 h 30 min", "45 min". */
export function hoursText(min: number): string {
  const n = Math.max(0, Math.round(Number(min) || 0));
  const h = Math.floor(n / 60);
  const r = n % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const policyText = {
  grace: (start: string, grace: number) =>
    `Shift starts ${start}. Coming in after ${addMinutes(start, n(grace))} = 1 mark.`,
  earlyGrace: (end: string, grace: number) =>
    `Shift ends ${end}. Leaving before ${addMinutes(end, -n(grace))} = 1 mark.`,
  absentBelow: (min: number) => `Worked less than ${hoursText(n(min))} in a day = absent (full day salary cut).`,
  halfDayMin: (min: number, absentBelow: number) =>
    `Worked ${hoursText(n(absentBelow))} to under ${hoursText(n(min))} = half day. A short day is not also a mark.`,
  overtimeAfter: (min: number) =>
    `Time worked after ${hoursText(n(min))} is overtime. It is paid only after HR or the team head approves it.`,
  marksPerHalfDay: (k: number) => {
    const v = n(k);
    if (v <= 0) return 'Marks never cut salary.';
    return `${v} marks = ½ day salary cut. ${v * 2} marks = 1 day. ${v - 1} marks = no cut.`;
  },
  overtimeMultiplier: (x: number) => `1 hour of approved overtime is paid as ${n(x)} hours of normal pay.`,
  bonus: (rupees: string, full: number, half: number) => {
    const f = n(full);
    const h = n(half);
    const halfBand = h > f ? ` Half for ${f + 1 === h ? h : `${f + 1}–${h}`} marks.` : '';
    const top = Math.max(f, h) + 1;
    return `${rupees} a month. Full for 0–${f} marks.${halfBand} None for ${top}+ marks or any absence without approved leave.`;
  },
};
