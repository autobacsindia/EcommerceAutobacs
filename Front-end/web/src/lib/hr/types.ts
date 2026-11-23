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
  rev: number;
};

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

// ── Payroll (not built yet: shapes follow the PayrollRun / Payslip models) ──
export type PayrollRunStatus = 'draft' | 'locked' | 'approved';

export type PayrollRun = {
  month: string;
  status: PayrollRunStatus;
  employeeCount: number;
  totals: {
    grossPaise: number;
    deductionsPaise: number;
    netPaise: number;
    employeePfPaise?: number;
    ptPaise?: number;
  };
  inputsFingerprint?: string;
  lockedAt: string | null;
  approvedAt: string | null;
  payoutsCreatedAt: string | null;
  /** Server-detected: attendance or leave changed after lock. */
  changedAfterLock?: boolean;
  rev: number;
};

export type PayslipRow = {
  id: string;
  employee: string;
  snapshot: { name: string; employeeCode: string; team?: string };
  attendance: { daysInMonth: number; paidDays: number; lateMarks?: number };
  grossPaise: number;
  deductionsPaise: number;
  netPaise: number;
  /** Server-written notes for HR ("Joined 14 Nov", "2 late = ½ day cut"). */
  notes?: string[];
};

export type PayrollMonth = Page<PayslipRow> & { run: PayrollRun | null };

// ── Session ──────────────────────────────────────────────────────────────────
/** The subset of /auth/me the HR panel decides on. */
export type HrViewer = {
  role?: string;
  staff?: { team: string; isHead?: boolean } | null;
};
