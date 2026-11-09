/** A resignation and its handover, as the API sends it (routes/staffDepartures.js). */
export type DepartureStatus = 'open' | 'left' | 'cancelled';

export interface Departure {
  id: string;
  user: { id: string; name: string };
  team: string;
  teamLabel: string;
  lastDay: string;
  daysLeft: number;
  status: DepartureStatus;
  successor: { id: string; name: string } | null;
  rev: number;
  createdAt: string;
  /** Sent only to the head and admins. */
  reason?: string;
  createdByName?: string;
  note?: string;
  noteByName?: string;
  noteAt?: string | null;
  mine?: 'leaving' | 'taking_over';
  can: { manage: boolean; writeNote: boolean; handover?: boolean };
}

export interface WorkItem { id: string; label: string; status?: string }
export interface HandoverMove { id: string; kind: 'task' | 'lead' | 'quotation' | 'lesson'; label: string; fromName: string; toName: string; byName: string; state: 'pending' | 'moved' | 'failed'; error: string; at: string }
export interface HandoverWork {
  work: { tasks: WorkItem[]; leads: WorkItem[]; quotations: WorkItem[]; lessons: WorkItem[]; orders: WorkItem[] };
  goesTo: { id: string; name: string } | null;
  canStart: boolean;
  moves: HandoverMove[];
}

export const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function timing(d: Pick<Departure, 'status' | 'daysLeft'>): { label: string; pill: string } {
  if (d.status === 'left') return { label: 'Access removed', pill: 'bg-gray-100 text-gray-700' };
  if (d.status === 'cancelled') return { label: 'Cancelled', pill: 'bg-gray-100 text-gray-700' };
  if (d.daysLeft < 0) return { label: 'Last day has passed', pill: 'bg-red-100 text-red-800' };
  if (d.daysLeft === 0) return { label: 'Last day is today', pill: 'bg-red-100 text-red-800' };
  if (d.daysLeft <= 3) return { label: `${d.daysLeft} day${d.daysLeft === 1 ? '' : 's'} left`, pill: 'bg-amber-100 text-amber-800' };
  return { label: `${d.daysLeft} days left`, pill: 'bg-sky-100 text-sky-800' };
}
