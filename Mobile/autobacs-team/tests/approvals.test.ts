import { canApproveAnything, clampOtMinutes, decisionError, NO_CAPS, visibleSections } from '../src/lib/approvals';
import { pushTarget } from '../src/push/routes';
import { toOvertimePage, toPayslip, toPayslipPage } from '../src/api/hr';

const caps = (leave: boolean, fixDay: boolean, overtime: boolean) => ({ canApprove: { leave, fixDay, overtime }, isHr: false, isHead: false });

describe('approvals', () => {
  test('the tab shows only when the server allows something', () => {
    expect(canApproveAnything(NO_CAPS)).toBe(false);
    expect(canApproveAnything(undefined)).toBe(false);
    expect(canApproveAnything(caps(true, false, true))).toBe(true);
  });
  test('sections follow the server, in a fixed order', () => {
    expect(visibleSections(caps(true, false, true))).toEqual(['leave', 'overtime']);
    expect(visibleSections(caps(true, true, true))).toEqual(['leave', 'fixDay', 'overtime']);
    expect(visibleSections(NO_CAPS)).toEqual([]);
  });
  test('a rejection needs a reason; an approval does not', () => {
    expect(decisionError('rejected', '  ')).toMatch(/reason/);
    expect(decisionError('rejected', 'busy week')).toBeNull();
    expect(decisionError('approved', '')).toBeNull();
  });
  test('approved overtime: 15-minute steps, never negative, never above what was worked', () => {
    expect(clampOtMinutes(130, 130)).toBe(130);
    expect(clampOtMinutes(140, 130)).toBe(130);
    expect(clampOtMinutes(-15, 130)).toBe(0);
    expect(clampOtMinutes(52, 130)).toBe(45);
  });
});

describe('notification taps', () => {
  test('only known screens open; anything else is ignored', () => {
    expect(pushTarget({ path: '/payslips' })).toBe('/payslips');
    expect(pushTarget({ path: '/leave' })).toBe('/leave');
    expect(pushTarget({ path: 'https://evil.example' })).toBeNull();
    expect(pushTarget({ path: '/face/check' })).toBeNull();
    expect(pushTarget(null)).toBeNull();
    expect(pushTarget({})).toBeNull();
  });
});

describe('overtime list mapping (attendance-policy shape)', () => {
  test('maps id/employee/day into the flat item the screen uses', () => {
    const page = toOvertimePage({
      items: [{ id: 'd1', employee: { id: 'e1', name: 'Sample Person', employeeCode: 'AB-1' }, day: { date: '2026-11-22', workedMinutes: 660, overtimeMinutes: 120 } }],
      nextCursor: 'c',
    });
    expect(page).toEqual({
      items: [{ dayId: 'd1', employeeId: 'e1', employeeName: 'Sample Person', employeeCode: 'AB-1', date: '2026-11-22', workedMinutes: 660, overtimeMinutes: 120 }],
      nextCursor: 'c',
    });
  });
});

describe('payslip mapping (payroll shape)', () => {
  test('splits lines by kind, uses calc as the note, drops employer lines', () => {
    const slip = toPayslip({
      id: 'p1', number: 'PS-2026-10-AB1', month: '2026-10', kind: 'monthly',
      grossPaise: 300000, deductionsPaise: 50000, netPaise: 250000, releasedAt: '2026-11-05T09:00:00Z',
      attendance: { daysInMonth: 31, paidDays: 30.5, marks: 4 },
      lines: [
        { code: 'BASIC', label: 'Basic', kind: 'earning', amountPaise: 300000 },
        { code: 'LOP', label: 'Late/early marks', kind: 'deduction', amountPaise: 50000, calc: 'Late/early marks: 4 → ½ day LOP' },
        { code: 'EPF_ER', label: 'Employer PF', kind: 'employer', amountPaise: 36000 },
      ],
    });
    expect(slip.earnings).toEqual([{ label: 'Basic', amountPaise: 300000 }]);
    expect(slip.deductions).toEqual([{ label: 'Late/early marks', amountPaise: 50000, note: 'Late/early marks: 4 → ½ day LOP' }]);
    expect(slip.attendance.paidDays).toBe(30.5);
  });
  test('list rows keep only summary fields; unknown kind reads as monthly', () => {
    const page = toPayslipPage({ items: [{ id: 'p1', number: 'n', month: '2026-10', kind: 'x' as never, grossPaise: 1, deductionsPaise: 0, netPaise: 1 }], nextCursor: null });
    expect(page.items[0]).toEqual({ id: 'p1', number: 'n', month: '2026-10', kind: 'monthly', grossPaise: 1, deductionsPaise: 0, netPaise: 1 });
  });
});
