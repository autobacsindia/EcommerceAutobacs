/**
 * The typed HR API the screens use. One interface, two implementations: the
 * real one below (talks to /api/v1) and the demo one in mock.ts (sample people
 * only, for previews while the backend branches are unmerged).
 */
import type { Http } from './http';
import type {
  AppCapabilities,
  Decision,
  EmployeeDocument,
  Holiday,
  OvertimeItem,
  PushRegistration,
  AttendanceStatus,
  Challenge,
  ChallengePurpose,
  Correction,
  CorrectionInput,
  Employee,
  FaceStatus,
  Frame,
  LeaveBalance,
  LeaveInput,
  LeaveRequest,
  LoginResult,
  MonthView,
  Page,
  Payslip,
  PunchInput,
  PunchResult,
} from './types';

export interface HrApi {
  login(identifier: string, password: string): Promise<LoginResult>;
  logout(): Promise<void>;
  me(): Promise<Employee>;
  status(): Promise<AttendanceStatus>;
  month(month: string): Promise<MonthView>;
  challenge(purpose: ChallengePurpose): Promise<Challenge>;
  consent(version: string, deviceId: string): Promise<FaceStatus>;
  enrol(challengeId: string, frames: Frame[], deviceId: string): Promise<FaceStatus>;
  punch(input: PunchInput): Promise<PunchResult>;
  requestReview(clientPunchId: string, frame: Frame): Promise<PunchResult>;
  corrections(): Promise<Page<Correction>>;
  createCorrection(input: CorrectionInput): Promise<{ correction: Correction; replay: boolean }>;
  leaveBalances(year: number): Promise<LeaveBalance[]>;
  myLeave(cursor?: string | null): Promise<Page<LeaveRequest>>;
  applyLeave(input: LeaveInput): Promise<{ request: LeaveRequest; replay: boolean }>;
  cancelLeave(id: string): Promise<void>;
  payslips(): Promise<Page<Payslip>>;
  /** Downloads the released payslip PDF to a local file; returns its uri. */
  payslipPdf(month: string): Promise<string>;

  // profile
  capabilities(): Promise<AppCapabilities>;
  documents(employeeId: string): Promise<Page<EmployeeDocument>>;
  /** A short-lived (5 min) link to open one document. */
  documentUrl(docId: string): Promise<{ url: string; fileName: string; mimeType: string }>;
  holidays(year: number): Promise<Holiday[]>;
  registerPush(input: PushRegistration): Promise<void>;
  unregisterPush(deviceId: string): Promise<void>;

  // approvals — every decision is the server's; the app never assumes it worked
  leaveInbox(): Promise<Page<LeaveRequest>>;
  decideLeave(id: string, decision: Decision, note: string, rev: number | undefined): Promise<LeaveRequest>;
  pendingCorrections(): Promise<Page<Correction>>;
  decideCorrection(id: string, decision: Decision, note: string, rev: number | undefined): Promise<void>;
  /** Name + code for one employee (HR sees all; used to label fix-day requests). */
  employeeName(employeeId: string): Promise<{ name: string; employeeCode: string }>;
  pendingOvertime(): Promise<Page<OvertimeItem>>;
  decideOvertime(item: OvertimeItem, decision: Decision, approvedMinutes: number, note: string): Promise<void>;
}

const enc = encodeURIComponent;

/** Turn local frames into multipart parts (React Native and web). */
export async function appendFrames(form: FormData, frames: Frame[], isWeb: boolean): Promise<void> {
  let i = 0;
  for (const f of frames) {
    i += 1;
    const name = `frame-${i}.jpg`;
    if (isWeb) {
      const blob = await (await fetch(f.uri)).blob();
      form.append('frames', blob, name);
    } else {
      // React Native's FormData takes this shape for a file on disk.
      form.append('frames', { uri: f.uri, name, type: f.mimeType } as unknown as Blob);
    }
  }
}

export function punchForm(input: PunchInput): FormData {
  const form = new FormData();
  const put = (k: string, v: string | number | boolean | null | undefined) => {
    if (v !== null && v !== undefined) form.append(k, String(v));
  };
  put('clientPunchId', input.clientPunchId);
  put('type', input.type);
  put('lat', input.lat);
  put('lng', input.lng);
  put('accuracyM', input.accuracyM);
  put('mocked', input.mocked);
  put('deviceId', input.deviceId);
  put('platform', input.platform);
  put('offline', input.offline);
  if (input.offline) put('at', input.at);
  put('challengeId', input.challengeId);
  // expo-camera returns un-mirrored pictures; say so explicitly.
  put('mirrored', false);
  return form;
}

type Deps = {
  http: Http;
  isWeb: boolean;
  downloadPdf: (url: string, headers: Record<string, string>, fileName: string) => Promise<string>;
  baseUrl: string;
};

export function createHrApi({ http, isWeb, downloadPdf, baseUrl }: Deps): HrApi {
  return {
    async login(identifier, password) {
      // Same staff login as the panel: email, or a company-account username.
      const r = await http.request<LoginResult & { accessToken?: string; refreshToken?: string }>('/auth/login', {
        method: 'POST',
        body: { email: identifier.trim(), password },
        noAuthRetry: true,
      });
      await http.setTokens({
        accessToken: r.accessToken ?? null,
        refreshToken: r.refreshToken ?? null,
        signedIn: true,
      });
      return r;
    },
    logout: () => http.logout(),
    me: async () => (await http.get<{ employee: Employee }>('/hr/me')).employee,
    status: () => http.get<AttendanceStatus>('/hr/me/attendance/status'),
    month: (month) => http.get<MonthView>(`/hr/me/attendance?month=${encodeURIComponent(month)}`),
    challenge: async (purpose) =>
      (await http.post<{ challenge: Challenge }>('/hr/me/face/challenge', { purpose })).challenge,
    consent: async (version, deviceId) =>
      (await http.post<{ face: FaceStatus }>('/hr/me/face/consent', { version, deviceId })).face,
    async enrol(challengeId, frames, deviceId) {
      const form = new FormData();
      form.append('challengeId', challengeId);
      form.append('deviceId', deviceId);
      form.append('mirrored', 'false');
      await appendFrames(form, frames, isWeb);
      return (await http.upload<{ face: FaceStatus }>('/hr/me/face/enrol', form)).face;
    },
    async punch(input) {
      const form = punchForm(input);
      await appendFrames(form, input.frames, isWeb);
      return http.upload<PunchResult>('/hr/me/punches', form);
    },
    async requestReview(clientPunchId, frame) {
      const form = new FormData();
      await appendFrames(form, [frame], isWeb);
      return http.upload<PunchResult>(`/hr/me/punches/${encodeURIComponent(clientPunchId)}/review`, form);
    },
    corrections: () => http.get<Page<Correction>>('/hr/me/corrections'),
    createCorrection: (input) => http.post<{ correction: Correction; replay: boolean }>('/hr/me/corrections', input),
    leaveBalances: async (year) => (await http.get<Page<LeaveBalance>>(`/hr/me/leave/balances?year=${year}`)).items,
    myLeave: (cursor) => http.get<Page<LeaveRequest>>(`/hr/me/leave${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
    applyLeave: (input) => http.post<{ request: LeaveRequest; replay: boolean }>('/hr/me/leave', input),
    cancelLeave: async (id) => {
      await http.post(`/hr/me/leave/${encodeURIComponent(id)}/cancel`);
    },
    payslips: () => http.get<Page<Payslip>>('/hr/me/payslips'),
    async payslipPdf(month) {
      return downloadPdf(
        `${baseUrl}/hr/me/payslips/${encodeURIComponent(month)}/pdf`,
        await http.authHeader(),
        `payslip-${month}.pdf`,
      );
    },

    capabilities: () => http.get<AppCapabilities>('/hr/me/app'),
    documents: (employeeId) => http.get<Page<EmployeeDocument>>(`/hr/employees/${enc(employeeId)}/documents`),
    documentUrl: (docId) => http.get<{ url: string; fileName: string; mimeType: string }>(`/hr/documents/${enc(docId)}/url`),
    holidays: async (year) => (await http.get<Page<Holiday>>(`/hr/holidays?year=${year}&limit=50`)).items,
    registerPush: async (input) => {
      await http.put('/hr/me/push-token', input);
    },
    unregisterPush: async (deviceId) => {
      await http.del('/hr/me/push-token', { deviceId });
    },

    leaveInbox: () => http.get<Page<LeaveRequest>>('/hr/leave/inbox?limit=50'),
    decideLeave: async (id, decision, note, rev) =>
      (await http.post<{ request: LeaveRequest }>(`/hr/leave/${enc(id)}/decide`, { decision, note, rev })).request,
    pendingCorrections: () => http.get<Page<Correction>>('/hr/corrections?status=pending&limit=50'),
    decideCorrection: async (id, decision, note, rev) => {
      // The corrections route speaks 'approve' | 'reject'.
      await http.post(`/hr/corrections/${enc(id)}/decide`, { decision: decision === 'approved' ? 'approve' : 'reject', note, rev });
    },
    employeeName: async (employeeId) => {
      const { employee } = await http.get<{ employee: { name: string; employeeCode: string } }>(`/hr/employees/${enc(employeeId)}`);
      return { name: employee.name, employeeCode: employee.employeeCode };
    },
    pendingOvertime: () => http.get<Page<OvertimeItem>>('/hr/overtime/pending?limit=50'),
    decideOvertime: async (item, decision, approvedMinutes, note) => {
      await http.post(`/hr/attendance/${enc(item.dayId)}/overtime/decide`, {
        decision,
        approvedMinutes: decision === 'approved' ? approvedMinutes : 0,
        note,
        rev: item.rev,
      });
    },
  };
}
