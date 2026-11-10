/** Past team members (GET /staff/past-members). Mirrors services/staffPastMemberService.js. */
export type PastMember = {
  id: string;
  name: string;
  team: string;
  teamLabel: string;
  roleLabel: string;
  joinedOn: string | null;
  lastDay: string | null;
  daysOnTeam: number | null;
};

export type PastMemberSales = {
  orders: { paid: number; paidValue: number; notPaid: number; returned: number; cancelled: number };
  quotations: { sent: number; accepted: number };
  leads: { total: number; won: number; lost: number };
};

export type PastMemberProfile = PastMember & {
  takenOverBy: string;
  sales: PastMemberSales | null;
  tasksDone: number;
  training: { id: string; title: string; status: string; signedOffAt: string | null; signedOffByName: string }[];
  lessons: { id: string; title: string; audience: string; createdAt: string }[];
  handover: {
    note: string;
    noteByName: string;
    noteAt: string | null;
    takenOverBy: string;
    moved: { kind: 'task' | 'lead' | 'quotation' | 'lesson'; label: string; toName: string; at: string }[];
  } | null;
};

export type PastMemberNote = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
  editedAt: string | null;
  rev: number;
  can: { edit: boolean; delete: boolean };
};

export type PastTask = { id: string; number: number; title: string; completedAt: string | null };
export type PastOrder = { id: string; number: string; createdAt: string; totalAmount: number; status: string; paymentStatus: string };

export const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
export const dateLabel = (iso: string | null) => (iso
  ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
  : '—');

/** "1 year 2 months", "3 months", "12 days". */
export function timeOnTeam(days: number | null): string {
  if (days === null) return 'Not known';
  if (days < 31) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30.44);
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const part = (n: number, w: string) => (n ? `${n} ${w}${n === 1 ? '' : 's'}` : '');
  return [part(years, 'year'), part(rest, 'month')].filter(Boolean).join(' ');
}

const ORDER_STATUS: Record<string, string> = {
  awaiting_payment: 'Waiting for payment', processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', returned: 'Returned', cancelled: 'Cancelled',
};
export const orderStatusLabel = (s: string) => ORDER_STATUS[s] ?? s;

const TRAINING_STATUS: Record<string, string> = {
  learning: 'Still learning', marking: 'Test being marked', ready_for_signoff: 'Waiting for sign-off', needs_help: 'Needed help', signed_off: 'Signed off',
};
export const trainingStatusLabel = (s: string) => TRAINING_STATUS[s] ?? s;

export const MOVE_KIND_LABEL = { task: 'Task', lead: 'Lead', quotation: 'Quotation', lesson: 'Lesson' } as const;
