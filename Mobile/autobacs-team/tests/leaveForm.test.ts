import type { LeaveType } from '../src/api/types';
import { estimateHalfDays, validateLeave, type LeaveDraft } from '../src/lib/leaveForm';

const casual: LeaveType = { id: 'cl', code: 'CL', name: 'Casual leave', paid: true, allowHalfDay: true, minNoticeDays: 1, allowNegative: false, active: true };
const earned: LeaveType = { ...casual, id: 'el', code: 'EL', name: 'Earned leave', allowHalfDay: false };

const draft = (over: Partial<LeaveDraft> = {}): LeaveDraft => ({
  leaveType: casual,
  from: '2026-12-04',
  to: '2026-12-04',
  part: 'full',
  reason: 'Family function',
  ...over,
});

describe('leave form validation', () => {
  test('a good full day passes and becomes the API body (no half flags)', () => {
    const r = validateLeave(draft());
    expect(r).toEqual({ ok: true, input: { leaveType: 'cl', from: '2026-12-04', to: '2026-12-04', reason: 'Family function' } });
  });

  test('first half / second half map to the server flags', () => {
    const a = validateLeave(draft({ part: 'first_half' }));
    const b = validateLeave(draft({ part: 'second_half' }));
    expect(a.ok && a.input.firstHalfOnly).toBe(true);
    expect(b.ok && b.input.secondHalfOnly).toBe(true);
    expect(a.ok && a.input.secondHalfOnly).toBeUndefined();
  });

  test('needs a leave type', () => {
    const r = validateLeave(draft({ leaveType: null }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.leaveType).toBeTruthy();
  });

  test('rejects impossible and badly formed dates', () => {
    const r = validateLeave(draft({ from: '2026-02-30', to: '4 Dec' }));
    expect(!r.ok && r.errors.from).toBeTruthy();
    expect(!r.ok && r.errors.to).toBeTruthy();
  });

  test('last day before first day', () => {
    const r = validateLeave(draft({ from: '2026-12-05', to: '2026-12-04' }));
    expect(!r.ok && r.errors.to).toMatch(/on or after/);
  });

  test('across the new year needs two requests', () => {
    const r = validateLeave(draft({ from: '2026-12-31', to: '2027-01-02' }));
    expect(!r.ok && r.errors.to).toMatch(/new year/);
  });

  test('a half day only on a one-date request', () => {
    const r = validateLeave(draft({ to: '2026-12-05', part: 'first_half' }));
    expect(!r.ok && r.errors.part).toMatch(/one date/);
  });

  test('a type that does not allow half days refuses a half day', () => {
    const r = validateLeave(draft({ leaveType: earned, part: 'second_half' }));
    expect(!r.ok && r.errors.part).toMatch(/full days/);
  });

  test('reason: required (trimmed) and capped', () => {
    expect(validateLeave(draft({ reason: '   ' })).ok).toBe(false);
    expect(validateLeave(draft({ reason: 'x'.repeat(501) })).ok).toBe(false);
    const r = validateLeave(draft({ reason: '  Wedding  ' }));
    expect(r.ok && r.input.reason).toBe('Wedding');
  });

  test('estimate: half day = 1, three calendar days = 6, bad range = null', () => {
    expect(estimateHalfDays({ from: '2026-12-04', to: '2026-12-04', part: 'first_half' })).toBe(1);
    expect(estimateHalfDays({ from: '2026-12-04', to: '2026-12-06', part: 'full' })).toBe(6);
    expect(estimateHalfDays({ from: '2026-12-06', to: '2026-12-04', part: 'full' })).toBeNull();
  });
});
