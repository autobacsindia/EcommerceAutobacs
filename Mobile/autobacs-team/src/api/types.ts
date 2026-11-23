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
};

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
  overtimeMinutes: number;
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

// ── payslips (payroll not built yet — shape from the ADR, provisional) ────────

export type PayslipLine = { label: string; amountPaise: number };

export type PayslipSummary = {
  month: string;
  number: string;
  netPaise: number;
  paidOn: string | null;
};

export type Payslip = PayslipSummary & {
  grossPaise: number;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  daysInMonth: number;
  paidDays: number;
  bankLast4?: string;
};

export type Page<T> = { items: T[]; nextCursor: string | null };
