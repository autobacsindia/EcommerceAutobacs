import { canApproveAnything, clampOtMinutes, decisionError, NO_CAPS, visibleSections } from '../src/lib/approvals';
import { pushTarget } from '../src/push/routes';

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
