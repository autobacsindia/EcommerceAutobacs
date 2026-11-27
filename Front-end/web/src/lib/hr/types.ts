/**
 * HR API shapes (docs/ADR-hr-system.md §4). Written against the contract and the
 * services on the foundation / attendance / leave branches.
 *
 * Conventions the server owns and the panel only DISPLAYS:
 *   - money is integer paise (`…Paise`); the panel never adds, multiplies or rounds pay
 *   - days are IST 'YYYY-MM-DD', months 'YYYY-MM'
 *   - leave is counted in half-days (integers)
 */

/** Every HR list: keyset cursor, `limit` ≤ 50. */
export type Page<T> = { items: T[]; nextCursor: string | null };

// ── Employees (foundation, built) ────────────────────────────────────────────
export type EmployeeStatus = 'onboarding' | 'active' | 'notice' | 'exited';
export type EmployeeListFilter = 'current' | 'all' | EmployeeStatus;
export type EmploymentType = 'full_time' | 'part_time' | 'intern' | 'contract';

export type EmployeeListRow = {
  id: string;
  employeeCode: string;
  status: EmployeeStatus;
  name: string;
  designation: string;
  team: string;
  joinDate: string | null;
  user: string | null;
  phone: string;
};

export type OnboardingItem = { key: string; label: string; done: boolean; doneAt: string | null };

export type Employee = EmployeeListRow & {
  workEmail: string;
  personalEmail: string;
  manager: string | null;
  employmentType: EmploymentType;
  exitDate: string | null;
  dob: string | null;
  gender: '' | 'male' | 'female' | 'other';
  address: string;
  emergencyContact: { name: string; relation: string; phone: string };
  shift: string | null;
  workSites: string[];
  anywhereAllowed: boolean;
  manualAttendance: boolean;
  /** Only the last four characters ever leave the server. */
  panLast4: string;
  aadhaarLast4: string;
  uan: string;
  esicNumber: string;
  taxRegime: 'new' | 'old';
  bank: { holderName: string; accountLast4: string; ifsc: string; hasUpi: boolean };
  onboarding: OnboardingItem[];
  rev: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * What the add / edit form may send. PAN, Aadhaar and the bank account are
 * write-only: the server encrypts them and returns only the last four.
 */
export type EmployeeInput = {
  name?: string;
  designation?: string;
  phone?: string;
  workEmail?: string;
  personalEmail?: string;
  joinDate?: string | null;
  employmentType?: EmploymentType;
  status?: 'onboarding' | 'active';
  pan?: string;
  aadhaar?: string;
  uan?: string;
  bank?: { holderName?: string; accountNumber?: string; ifsc?: string; upi?: string };
  shift?: string | null;
  workSites?: string[];
  anywhereAllowed?: boolean;
  manualAttendance?: boolean;
};

// ── Settings (foundation, built) ─────────────────────────────────────────────
export type HrSettings = {
  faceMatchThreshold: number;
  gpsMaxAccuracyM: number;
  offlineMaxHours: number;
  maxFaceAttempts: number;
  faceReviewPhotoDays: number;
  deviceChangeCooldownDays: number;
  autoCloseTime: string;
  leaveHeadStep: boolean;
  monthDayBasis: 'calendar' | 'fixed_30';
  payday: number;
  includeIncentives: boolean;
  onboardingItems: { key: string; label: string }[];
  /** Month rules (attendance policy, 2026-11-26). Every N marks = ½ day cut; 0 = never. */
  marksPerHalfDayLop: number;
  /** Approved overtime is paid at this × the hourly rate (payroll works the amount out). */
  overtimeMultiplier: number;
  punctualityBonusPaise: number;
  /** Full bonus at or below this many marks… */
  punctualityFullMaxMarks: number;
  /** …half bonus at or below this many; none above. */
  punctualityHalfMaxMarks: number;
  rev: number;
};

/** The month-level policy rules HR edits on the Attendance rules page. */
export type PolicySettingsInput = Partial<Pick<HrSettings,
  'marksPerHalfDayLop' | 'overtimeMultiplier' | 'punctualityBonusPaise' | 'punctualityFullMaxMarks' | 'punctualityHalfMaxMarks'>>;

/** The settings HR edits from the panel (the statutory rates stay with the owner/CA). */
export type HrSettingsInput = Partial<Pick<HrSettings,
  'maxFaceAttempts' | 'offlineMaxHours' | 'gpsMaxAccuracyM' | 'leaveHeadStep' | 'payday' | 'includeIncentives'>>;

// ── Attendance (hr-attendance) ───────────────────────────────────────────────
export type DayStatus =
  | 'present' | 'half_day' | 'absent' | 'leave' | 'half_leave' | 'holiday' | 'weekly_off' | 'holiday_worked';

export type AttendanceDay = {
  date: string;
  status: DayStatus;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  isLate: boolean;
  overtimeMinutes: number;
  autoClosed: boolean;
  needsReview: boolean;
  breakMinutes?: number;
  earlyMinutes?: number;
  isEarly?: boolean;
  lateMark?: boolean;
  earlyMark?: boolean;
  overtimeApprovedMinutes?: number;
  overtimeStatus?: 'none' | 'pending' | 'approved' | 'rejected';
};

export type TodayRow = {
  employee: { id: string; name: string; employeeCode: string; team: string; designation: string };
  day: AttendanceDay | null;
  state: 'not_in' | 'in' | 'out';
};

export type TodayBoard = Page<TodayRow> & { date: string };

export type WorkSite = {
  id: string; name: string; address: string; lat: number; lng: number; radiusM: number; active: boolean; rev: number;
};

export type Shift = {
  id: string;
  name: string;
  start: string;
  end: string;
  graceMinutes: number;
  /** Leaving earlier than end − this = 1 mark. */
  earlyGraceMinutes?: number;
  /** Worked less than this = absent. */
  absentBelowMinutes?: number;
  /** Worked less than this = half day. */
  halfDayMinMinutes?: number;
  fullDayMinutes?: number;
  /** Worked minutes beyond this are overtime (paid only once approved). */
  overtimeAfterMinutes?: number;
  /** Superseded by HrSettings.marksPerHalfDayLop; not read by the server any more. */
  latesPerHalfDayLop: number;
  weeklyOff: number[];
  isDefault: boolean;
  active: boolean;
  rev: number;
};

// ── Leave (hr-leave) ─────────────────────────────────────────────────────────
export type LeaveStatus = 'pending_head' | 'pending_hr' | 'approved' | 'rejected' | 'cancelled';

export type LeaveRequest = {
  id: string;
  number?: string;
  employee: string;
  employeeName?: string;
  employeeCode?: string;
  leaveType: string;
  leaveTypeCode?: string;
  leaveTypeName?: string;
  from: string;
  to: string;
  firstHalfOnly: boolean;
  secondHalfOnly: boolean;
  halfDays: number;
  paid: boolean;
  reason: string;
  status: LeaveStatus;
  decisions: { step: string; decision: string; byName: string; at: string; note: string }[];
  rev: number;
  createdAt: string;
};

export type LeaveDecision = 'approved' | 'rejected';

export type LeaveBalance = {
  leaveType: { id: string; code: string; name: string; paid: boolean };
  year: number;
  /** All half-days, server-computed. */
  granted: number;
  used: number;
  pending: number;
  balance: number;
  available: number;
};

// ── Overtime approvals (hr-attendance-policy, PR #658) ───────────────────
export type OvertimeItem = {
  id: string;
  employee: { id: string; name: string; employeeCode: string; team: string; designation: string };
  day: AttendanceDay;
};
export type OvertimeDecision = 'approve' | 'reject';

/** GET /hr/employees/:id/attendance?month — the counts the employee is paid on (server-computed). */
export type MonthSummary = {
  daysInMonth: number;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  lateCount?: number;
  earlyCount?: number;
  marks?: number;
  marksPerHalfDayLop?: number;
  marksLopDays?: number;
  otApprovedMinutes?: number;
  otPendingMinutes?: number;
  unresolvedDays?: number;
};
export type EmployeeMonth = { month: string; days: AttendanceDay[]; summary: MonthSummary };

// ── Payroll (hr-payroll, branch claude/hr-payroll-47d2ad) ────────────────────
export type PayrollRunStatus = 'draft' | 'locked' | 'approved';

/** One row of the run's payslip list (headcount-bounded, no paging). */
export type PayslipRow = {
  id: string;
  month: string;
  kind?: string;
  employee: string;
  name: string;
  employeeCode: string;
  grossPaise: number;
  deductionsPaise: number;
  netPaise: number;
  /** Server-written checks ("2 days need HR review"). */
  warnings: string[];
  released: boolean;
  payoutRequest: string | null;
};

export type PayrollRun = {
  id: string;
  month: string;
  status: PayrollRunStatus;
  rev: number;
  employeeCount: number;
  totals: { grossPaise: number; deductionsPaise: number; netPaise: number; employerPfPaise?: number; employerEsiPaise?: number };
  /** Payslips whose deductions are above earnings: lock is refused while > 0. */
  blockedCount: number;
  skipped: { employee: string; name: string; reason: string }[];
  /** Taken at compute; approve sends it back so the server can refuse a changed month. */
  fingerprint: string;
  computedAt: string | null;
  lockedAt: string | null;
  approvedAt: string | null;
  payoutsCreatedAt: string | null;
  payoutsCount: number;
  history: { action: string; at: string; byName: string; reason: string }[];
  payslips: PayslipRow[];
};

export type PayslipLine = {
  code: string;
  label: string;
  kind: 'earning' | 'deduction' | 'employer';
  amountPaise: number;
  /** The working, written by the server ("4 marks → ½ day LOP"). */
  calc: string;
  basis?: unknown;
};

export type Payslip = PayslipRow & {
  number: string;
  snapshot: { name: string; employeeCode: string; [k: string]: unknown };
  attendance: Record<string, unknown> | null;
  lines: PayslipLine[];
  employerPaise: number;
  releasedAt: string | null;
};

export type SalaryComponent = { code: string; label: string; kind: 'earning' | 'deduction'; monthlyPaise: number; prorate: boolean };

export type SalaryStructure = {
  id: string;
  employee: string;
  effectiveFrom: string;
  components: SalaryComponent[];
  /** Server sum of the earnings. */
  grossMonthlyPaise: number;
  pfApplicable: boolean;
  pfCapAtCeiling: boolean;
  esiApplicable: boolean;
  ptState: string;
  overtimeEligible: boolean;
  overtimeMultiplier: number | null;
  punctualityBonusEligible: boolean;
  tdsMonthlyPaise: number;
  reason: string;
  createdAt: string;
};

/** What HR types for a new salary row. Gross, net and statutory figures are never sent. */
export type SalaryInput = {
  effectiveFrom: string;
  components: SalaryComponent[];
  pfApplicable: boolean;
  pfCapAtCeiling: boolean;
  esiApplicable: boolean;
  ptState: string;
  overtimeEligible: boolean;
  overtimeMultiplier: number | null;
  punctualityBonusEligible: boolean;
  tdsMonthlyPaise: number;
  reason: string;
};

// ── Session ──────────────────────────────────────────────────────────────────
/** The subset of /auth/me the HR panel decides on. */
export type HrViewer = {
  role?: string;
  staff?: { team: string; isHead?: boolean } | null;
};
