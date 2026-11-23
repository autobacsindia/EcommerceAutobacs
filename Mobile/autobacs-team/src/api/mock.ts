/**
 * Demo data for previews (EXPO_PUBLIC_TEAM_MOCK=1). Sample people and numbers
 * only — never real employees. Lives in memory, nothing is sent anywhere, and
 * the app shows a "DEMO DATA" ribbon whenever this is in use.
 */
import type { HrApi } from './hr';
import { ApiError } from './http';
import type {
  AttendanceDay,
  AttendanceStatus,
  LeaveBalance,
  LeaveRequest,
  MonthView,
  Payslip,
  Punch,
  PunchType,
} from './types';

const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);

const types = [
  { id: 'cl', code: 'CL', name: 'Casual leave', paid: true, allowHalfDay: true, minNoticeDays: 1, allowNegative: false, active: true },
  { id: 'sl', code: 'SL', name: 'Sick leave', paid: true, allowHalfDay: true, minNoticeDays: 0, allowNegative: false, active: true },
  { id: 'el', code: 'EL', name: 'Earned leave', paid: true, allowHalfDay: false, minNoticeDays: 7, allowNegative: false, active: true },
];

function day(date: string, status: string, inAt: string | null, outAt: string | null, worked: number, late = 0): AttendanceDay {
  return {
    date,
    status,
    firstIn: inAt ? `${date}T${inAt}:00+05:30` : null,
    lastOut: outAt ? `${date}T${outAt}:00+05:30` : null,
    workedMinutes: worked,
    breakMinutes: 0,
    lateMinutes: late,
    isLate: late > 0,
    overtimeMinutes: 0,
    autoClosed: false,
    needsReview: !!inAt && !outAt && status !== 'in_progress',
  };
}

export function createMockApi(): HrApi {
  const punches: Punch[] = [];
  const seen = new Map<string, Punch>();
  let enrolled = false;
  let consent = false;
  const leave: LeaveRequest[] = [
    {
      id: 'l1', leaveType: 'cl', leaveTypeCode: 'CL', leaveTypeName: 'Casual leave', from: '2026-12-02', to: '2026-12-02',
      firstHalfOnly: false, secondHalfOnly: false, halfDays: 2, reason: 'Family function', status: 'approved', createdAt: '2026-11-18T10:00:00Z',
    },
    {
      id: 'l2', leaveType: 'sl', leaveTypeCode: 'SL', leaveTypeName: 'Sick leave', from: '2026-11-17', to: '2026-11-17',
      firstHalfOnly: false, secondHalfOnly: false, halfDays: 2, reason: 'Fever', status: 'approved', createdAt: '2026-11-17T08:00:00Z',
    },
  ];

  const state = () => {
    const last = punches[punches.length - 1]?.type;
    return last === 'in' || last === 'break_end' ? 'in' : last === 'break_start' ? 'break' : last === 'out' ? 'out' : 'none';
  };
  const allowed: Record<string, PunchType[]> = { none: ['in'], out: ['in'], in: ['break_start', 'out'], break: ['break_end', 'out'] };

  return {
    async login(identifier) {
      await wait();
      return { user: { id: 'u1', name: 'Arjun Demo', email: identifier, role: 'staff', username: null } };
    },
    logout: async () => {},
    async me() {
      await wait();
      return { id: 'e1', employeeCode: 'AB-0007', status: 'active', name: 'Arjun Demo', designation: 'Service advisor', team: 'service', joinDate: '2024-04-01' };
    },
    async status(): Promise<AttendanceStatus> {
      await wait();
      const first = punches.find((p) => p.type === 'in');
      const last = punches[punches.length - 1];
      return {
        date: today(),
        face: {
          status: enrolled ? 'enrolled' : 'none', consentVersion: consent ? '2026-11-v1' : null, consentCurrent: consent,
          currentConsentVersion: '2026-11-v1', enrolledAt: enrolled ? new Date().toISOString() : null,
        },
        manualAttendance: false,
        anywhereAllowed: false,
        shift: { id: 's1', name: 'Showroom', start: '10:00', end: '19:00', weeklyOff: [0] },
        sites: [{ id: 'w1', name: 'Main showroom', lat: 9.9816, lng: 76.2999, radiusM: 150 }],
        today: {
          state: state() as AttendanceStatus['today']['state'],
          allowedTypes: allowed[state()],
          punches,
          day: first
            ? { ...day(today(), last?.type === 'out' ? 'present' : 'in_progress', null, null, 0), firstIn: first.at, lastOut: last?.type === 'out' ? last.at : null }
            : null,
        },
      };
    },
    async month(month): Promise<MonthView> {
      await wait();
      const days = [
        day(`${month}-20`, 'present', '09:56', '19:04', 548),
        day(`${month}-19`, 'present', '10:22', '19:01', 519, 22),
        day(`${month}-18`, 'present', '09:50', '18:58', 548),
        day(`${month}-17`, 'leave', null, null, 0),
        day(`${month}-16`, 'present', '09:58', null, 0),
        day(`${month}-15`, 'weekly_off', null, null, 0),
      ];
      return {
        month,
        days,
        summary: { daysInMonth: 30, presentDays: 18, halfDays: 0, absentDays: 0, leaveDays: 1, holidayDays: 0, weeklyOffDays: 3, lateMarks: 2, unresolvedDays: 1 },
      };
    },
    async challenge(purpose) {
      await wait(150);
      const actions = ['turn_left', 'turn_right', 'move_closer'] as const;
      return {
        challengeId: `demo-${Math.random().toString(36).slice(2)}`,
        action: actions[Math.floor(Math.random() * actions.length)],
        purpose,
        expiresAt: new Date(Date.now() + (purpose === 'offline' ? 24 * 3600e3 : 120e3)).toISOString(),
      };
    },
    async consent() {
      await wait();
      consent = true;
      return { status: 'none', consentVersion: '2026-11-v1', consentCurrent: true, currentConsentVersion: '2026-11-v1', enrolledAt: null };
    },
    async enrol() {
      await wait(900);
      enrolled = true;
      return { status: 'enrolled', consentVersion: '2026-11-v1', consentCurrent: true, currentConsentVersion: '2026-11-v1', enrolledAt: new Date().toISOString() };
    },
    async punch(input) {
      await wait(900);
      const prior = seen.get(input.clientPunchId);
      if (prior) return { punch: prior, day: null, replay: true };
      if (!allowed[state()].includes(input.type)) {
        throw new ApiError('You are already clocked in.', 422, 'sequence', { allowedTypes: allowed[state()] });
      }
      const p: Punch = {
        id: `p${punches.length + 1}`, clientPunchId: input.clientPunchId, type: input.type, at: input.at ?? new Date().toISOString(),
        date: today(), source: 'app', offline: input.offline, status: 'accepted', site: 'w1',
        geo: { verdict: 'inside', distanceM: 40, accuracyM: input.accuracyM }, face: { verdict: 'match', score: 0.82, livenessPassed: true }, reviewNote: '',
      };
      punches.push(p);
      seen.set(p.clientPunchId, p);
      return { punch: p, day: null, replay: false };
    },
    async requestReview() {
      throw new ApiError('Not in the demo.', 400);
    },
    corrections: async () => ({ items: [], nextCursor: null }),
    async createCorrection(input) {
      await wait();
      return { correction: { id: 'c1', date: input.date, punchType: input.punchType, at: input.at, reason: input.reason, status: 'pending' }, replay: false };
    },
    async leaveBalances(year): Promise<LeaveBalance[]> {
      await wait();
      const pending = leave.filter((l) => l.status.startsWith('pending'));
      return types.map((t, i) => {
        const granted = [16, 12, 24][i];
        const used = [7, 0, 0][i];
        const p = pending.filter((l) => l.leaveType === t.id).reduce((s, l) => s + l.halfDays, 0);
        return { leaveType: t, year, granted, used, pending: p, balance: granted - used, available: granted - used - p };
      });
    },
    myLeave: async () => ({ items: [...leave].reverse(), nextCursor: null }),
    async applyLeave(input) {
      await wait(500);
      const existing = leave.find((l) => l.id === input.clientRequestId);
      if (existing) return { request: existing, replay: true };
      const t = types.find((x) => x.id === input.leaveType)!;
      const days = Math.round((Date.parse(input.to) - Date.parse(input.from)) / 864e5) + 1;
      const r: LeaveRequest = {
        id: input.clientRequestId, leaveType: t.id, leaveTypeCode: t.code, leaveTypeName: t.name, from: input.from, to: input.to,
        firstHalfOnly: !!input.firstHalfOnly, secondHalfOnly: !!input.secondHalfOnly,
        halfDays: days * 2 - (input.firstHalfOnly ? 1 : 0) - (input.secondHalfOnly ? 1 : 0),
        reason: input.reason, status: 'pending_hr', createdAt: new Date().toISOString(),
      };
      leave.push(r);
      return { request: r, replay: false };
    },
    async cancelLeave(id) {
      const r = leave.find((l) => l.id === id);
      if (r) r.status = 'cancelled';
    },
    async payslips() {
      await wait();
      const slip: Payslip = {
        month: '2026-10', number: 'PS-2026-10-0007', netPaise: 2784000, paidOn: '2026-11-07', grossPaise: 3104000,
        earnings: [
          { label: 'Basic', amountPaise: 1500000 },
          { label: 'HRA', amountPaise: 750000 },
          { label: 'Other allowance', amountPaise: 750000 },
          { label: 'Overtime (4 h)', amountPaise: 104000 },
        ],
        deductions: [
          { label: 'PF (12% of basic)', amountPaise: 180000 },
          { label: 'Professional tax', amountPaise: 20000 },
          { label: '1 day without pay', amountPaise: 100000 },
        ],
        daysInMonth: 31, paidDays: 30, bankLast4: '4821',
      };
      return { items: [slip], nextCursor: null };
    },
    async payslipPdf() {
      throw new ApiError('PDFs are not in the demo.', 400);
    },
  };
}
