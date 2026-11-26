/*
  "My delays" — the shapes /api/staff/delays/* returns (Back-end
  services/myDelaysService.js). Read-only, live state: v1 reads today's open
  work; the permanent delay records (follow-up engine) arrive in a later version.
*/

export type DelayBucket = 'late' | 'today' | 'pending';
export type DelayKind = 'order_step' | 'parcel' | 'task' | 'project';
export type DelayControl = 'inside' | 'outside';

export type DelayOwner = { id: string | null; name: string; team: string; via: 'moved' | 'head' | 'admins' };

export type DelayReason = { code: string; label: string; note: string; by: string; at: string | null; control: DelayControl };

export type DelayItem = {
  key: string;
  kind: DelayKind;
  bucket: DelayBucket;
  title: string;
  subtitle: string;
  stage: string;
  stageLabel: string;
  team: string | null;
  since: string | null;
  dueAt: string;
  minutesLate: number;
  reason: DelayReason | null;
  control: DelayControl;
  nextFollowUp: string | null;
  flags: { noEta: boolean };
  owner: DelayOwner;
  order: { id: string; number: string } | null;
  shipmentId: string | null;
  etaDay: string | null;
  task: { id: string; number: number; rev: number; project: string | null } | null;
  project: { id: string; code: string } | null;
};

export type DelaySummary = {
  late: number; today: number; pending: number; noReason: number; noEta: number; outside: number; minutesLate: number;
};

export type DelayPage = {
  person: { id: string; name: string; team: string | null };
  summary: DelaySummary;
  items: DelayItem[];
  nextCursor: string | null;
  truncated: boolean;
  asOf: string;
};

export type DelayPersonRow = DelaySummary & { key: string; id: string | null; name: string; team: string; teamLabel: string };

export type DelayRanking = {
  scope: { team: string | null };
  totals: DelaySummary;
  people: DelayPersonRow[];
  nextCursor: string | null;
  truncated: boolean;
  asOf: string;
};

export type DelayFilters = { control?: DelayControl | ''; from?: string; to?: string; team?: string };

export const TEAM_LABELS: Record<string, string> = {
  sales: 'GTM', procurement: 'Procurement', accounts: 'Accounts', operations: 'Operations',
  marketing: 'Marketing', developer: 'Developer', hr: 'HR', admin: 'Admin',
};
export const teamLabel = (t: string | null | undefined) => (t ? TEAM_LABELS[t] || t : '—');

const OFFICE_DAY_MIN = 9 * 60; // 09:30–18:30

/** "45m", "3h 20m", "2d 1h" — office time (an office day is 9 hours). */
export function officeDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  if (m < OFFICE_DAY_MIN) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }
  const d = Math.floor(m / OFFICE_DAY_MIN);
  const h = Math.floor((m % OFFICE_DAY_MIN) / 60);
  return h ? `${d}d ${h}h` : `${d}d`;
}

/** "25/11/2026" from 'YYYY-MM-DD'. */
export function formatDay(day: string | null | undefined): string {
  const [y, m, d] = String(day || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}

/** Only the filters that are set, as query-string pairs (so keys stay stable). */
export function filterParams(f: DelayFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.control) out.control = f.control;
  if (f.from) out.from = f.from;
  if (f.to) out.to = f.to;
  if (f.team) out.team = f.team;
  return out;
}
