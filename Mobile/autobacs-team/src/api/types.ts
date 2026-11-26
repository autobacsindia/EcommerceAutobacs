/**
 * Shapes of the HR API (/api/v1/hr), typed from docs/ADR-hr-system.md §4 and
 * the attendance / leave branches' route handlers. Dates are IST 'YYYY-MM-DD',
 * months 'YYYY-MM', instants ISO strings. Money is integer paise; leave is
 * integer half-days. The app never computes money or balances itself — it only
 * formats what the server sent.
 */

// ── foundation ───────────────────────────────────────────────────────────────

export type Employee = {
  id: string;
  employeeCode: string;
  status: 'onboarding' | 'active' | 'notice' | 'exited' | string;
  name: string;
  designation: string;
  team: string;
  joinDate: string | null;
  // Profile details (GET /hr/me, services/hr/employeeService.js shapeEmployee).
  // Optional: the demo data and older servers may leave them out.
  workEmail?: string;
  phone?: string;
  employmentType?: string;
  dob?: string | null;
  address?: string;
  emergencyContact?: { name: string; relation: string; phone: string };
  panLast4?: string;
  uan?: string;
  bank?: { holderName: string; accountLast4: string; ifsc: string; hasUpi: boolean };
};

/** GET /hr/me/app — what this login may do. Only decides what the app SHOWS. */
export type AppCapabilities = {
  canApprove: { leave: boolean; fixDay: boolean; overtime: boolean };
  isHr: boolean;
  isHead: boolean;
};

export type PushRegistration = { deviceId: string; token: string; platform: 'ios' | 'android' };

/** POST /auth/login → the staff login (email or company username). */
export type LoginUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  username: string | null;
};

export type LoginResult = {
  user: LoginUser;
  /**
   * Present only if the server hands the app a Bearer pair. Today /auth/login
   * sets httpOnly cookies instead (the native cookie jar keeps them); see
   * api/client.ts "Auth".
   */
  accessToken?: string;
  refreshToken?: string;
};

// ── attendance ───────────────────────────────────────────────────────────────

export type PunchType = 'in' | 'out' | 'break_start' | 'break_end';
export type PunchState = 'none' | 'in' | 'break' | 'out';
export type GeoVerdict = 'inside' | 'anywhere_allowed' | 'outside' | 'mocked' | 'low_accuracy' | 'none';

export type Punch = {
  id: string;
  clientPunchId: string;
  type: PunchType;
  at: string;
  date: string;
  source: string;
  offline: boolean;
  status: 'accepted' | 'pending_review' | 'rejected';
  site: string | null;
  geo: { verdict: GeoVerdict; distanceM: number | null; accuracyM: number | null };
  face: { verdict: string; score: number | null; livenessPassed: boolean };
  reviewNote: string;
};

export type DayStatus =
  | 'present'
  | 'half_day'
  | 'absent'
  | 'leave'
  | 'half_leave'
  | 'holiday'
  | 'holiday_worked'
  | 'weekly_off'
  | 'in_progress'
  | string;

export type AttendanceDay = {
  date: string;
  status: DayStatus;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  isLate: boolean;
  earlyMinutes?: number;
  isEarly?: boolean;
  overtimeMinutes: number;
  overtimeApprovedMinutes?: number;
  overtimeStatus?: 'none' | 'pending' | 'approved' | 'rejected' | string;
  autoClosed: boolean;
  needsReview: boolean;
};

export type FaceStatus = {
  status: 'none' | 'enrolled' | 'reenrol_allowed' | 'withdrawn' | 'deleted';
  consentVersion: string | null;
  consentCurrent: boolean;
  currentConsentVersion: string;
  enrolledAt: string | null;
};

export type WorkSite = { id: string; name: string; lat: number; lng: number; radiusM: number };

export type Shift = { id: string | null; name: string; start: string; end: string; weeklyOff: number[] };

/** GET /me/attendance/status — everything the Today screen needs, one call. */
export type AttendanceStatus = {
  date: string;
  face: FaceStatus;
  manualAttendance: boolean;
  anywhereAllowed: boolean;
  shift: Shift;
  sites: WorkSite[];
  today: { state: PunchState; allowedTypes: PunchType[]; punches: Punch[]; day: AttendanceDay | null };
};

export type MonthSummary = {
  daysInMonth: number;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  holidayDays: number;
  weeklyOffDays: number;
  lateMarks: number;
  unresolvedDays: number;
  // Attendance policy (late/early marks, overtime) — optional until that
  // server branch lands. The app only shows what the server counted.
  lateCount?: number;
  earlyCount?: number;
  marks?: number;
  marksPerHalfDayLop?: number;
  marksLopDays?: number;
  otApprovedMinutes?: number;
  otPendingMinutes?: number;
  rules?: MarkRules;
};

/** The pay rules as the server applies them (HrSettings). */
export type MarkRules = {
  graceMinutes?: number;
  earlyGraceMinutes?: number;
  marksPerHalfDayLop?: number;
  overtimeAfterMinutes?: number;
  overtimeMultiplier?: number;
  punctualityBonusPaise?: number;
};

export type MonthView = { month: string; days: AttendanceDay[]; summary: MonthSummary };

export type ChallengeAction = 'turn_left' | 'turn_right' | 'move_closer';
export type ChallengePurpose = 'punch' | 'enrol' | 'offline';
export type Challenge = { challengeId: string; action: ChallengeAction; purpose: ChallengePurpose; expiresAt: string };

/** A captured camera frame on disk (deleted right after upload). */
export type Frame = { uri: string; mimeType: 'image/jpeg' };

export type PunchInput = {
  clientPunchId: string;
  type: PunchType;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  mocked: boolean;
  deviceId: string;
  platform: 'ios' | 'android' | 'web';
  offline: boolean;
  /** Only for offline punches: when it really happened. */
  at?: string;
  challengeId: string;
  frames: Frame[];
};

export type PunchResult = { punch: Punch; day: AttendanceDay | null; replay: boolean };

/** 422 reason codes (attendance hand-over notes). */
export type RefusalCode =
  | 'outside_fence'
  | 'low_accuracy'
  | 'mocked_location'
  | 'face_no_match'
  | 'liveness_failed'
  | 'not_enrolled'
  | 'sequence'
  | 'device_blocked'
  | 'manual_attendance'
  | 'bad_time';

export type CorrectionInput = {
  clientRequestId: string;
  date: string;
  punchType: PunchType;
  at: string;
  reason: string;
};

export type Correction = {
  id: string;
  employee?: string;
  rev?: number;
  createdAt?: string;
  date: string;
  punchType: PunchType;
  at: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | string;
};

// ── leave ────────────────────────────────────────────────────────────────────

export type LeaveType = {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  allowHalfDay: boolean;
  minNoticeDays: number;
  allowNegative: boolean;
  active: boolean;
};

/** All figures in half-days. `available` = balance − pending. */
export type LeaveBalance = {
  leaveType: LeaveType;
  year: number;
  granted: number;
  used: number;
  pending: number;
  balance: number;
  available: number;
};

export type LeaveStatus = 'pending_head' | 'pending_hr' | 'approved' | 'rejected' | 'cancelled';

export type LeaveRequest = {
  id: string;
  rev?: number;
  employee?: string;
  employeeName?: string;
  employeeCode?: string;
  number?: string;
  leaveType: string;
  leaveTypeCode?: string;
  leaveTypeName?: string;
  from: string;
  to: string;
  firstHalfOnly: boolean;
  secondHalfOnly: boolean;
  halfDays: number;
  reason: string;
  status: LeaveStatus;
  createdAt: string;
};

export type LeaveInput = {
  clientRequestId: string;
  leaveType: string;
  from: string;
  to: string;
  firstHalfOnly?: boolean;
  secondHalfOnly?: boolean;
  reason: string;
};

// ── payslips (payroll branch shapes, mapped in api/hr.ts) ────────────────────

/** `note` explains the figure, e.g. "Late/early marks: 4 → ½ day LOP". */
export type PayslipLine = { label: string; amountPaise: number; note?: string };

/** One row of GET /hr/me/payslips. Only released payslips are listed. */
export type PayslipSummary = {
  id: string;
  number: string;
  month: string;
  kind: 'monthly' | 'final_settlement';
  grossPaise: number;
  deductionsPaise: number;
  netPaise: number;
};

export type PayslipAttendance = {
  daysInMonth?: number;
  paidDays?: number;
  lopDays?: number;
  marks?: number;
  lateCount?: number;
  earlyCount?: number;
  overtimeMinutes?: number;
};

/** GET /hr/me/payslips/:id, with lines split into earnings and deductions. */
export type Payslip = PayslipSummary & {
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  attendance: PayslipAttendance;
  releasedAt: string | null;
};

export type Page<T> = { items: T[]; nextCursor: string | null };

// ── profile extras ───────────────────────────────────────────────────────────

export type EmployeeDocument = {
  id: string;
  kind: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  note: string;
  createdAt: string;
};

export type Holiday = { id: string; date: string; year: number; name: string; optional: boolean };

// ── approvals (heads / HR) ───────────────────────────────────────────────────

/** One pending overtime day (mapped from GET /hr/overtime/pending, api/hr.ts). */
export type OvertimeItem = {
  dayId: string;
  employeeId: string;
  employeeName?: string;
  employeeCode?: string;
  date: string;
  workedMinutes: number;
  overtimeMinutes: number;
};

export type Decision = 'approved' | 'rejected';
