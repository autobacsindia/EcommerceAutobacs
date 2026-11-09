/** Training, as the API sends it (routes/staffTraining.js). */
export type Stage = 'day1' | 'week1' | 'month1';
export type TrainingStatus = 'learning' | 'marking' | 'ready_for_signoff' | 'needs_help' | 'signed_off' | 'cancelled';

export const STAGES: { key: Stage; label: string }[] = [
  { key: 'day1', label: 'Day 1' }, { key: 'week1', label: 'Week 1' }, { key: 'month1', label: 'Month 1' },
];

export const STATUS: Record<TrainingStatus, { label: string; pill: string }> = {
  learning: { label: 'Learning', pill: 'bg-sky-100 text-sky-800' },
  marking: { label: 'Waiting for marking', pill: 'bg-amber-100 text-amber-800' },
  ready_for_signoff: { label: 'Passed: ready for sign-off', pill: 'bg-amber-100 text-amber-800' },
  needs_help: { label: 'Out of attempts', pill: 'bg-red-100 text-red-800' },
  signed_off: { label: 'Trained and signed off', pill: 'bg-emerald-100 text-emerald-800' },
  cancelled: { label: 'Cancelled', pill: 'bg-gray-100 text-gray-700' },
};

export interface TrainingMeta { teams: { key: string; label: string }[]; passMark: number; attemptsAllowed: number }
export interface PathItem { stage: Stage; lessonId: string; title: string }
export interface PathQuestion { id?: string; type: 'choice' | 'written'; text: string; options: string[]; correct: number | null; lessonId: string; lessonTitle?: string }
export interface PathSummary { id: string; title: string; team: string; teamLabel: string; rev: number; lessonCount: number; questionCount: number; createdByName: string; createdAt: string }
export interface Path extends PathSummary { items: PathItem[]; questions: PathQuestion[] }

export interface AssignmentSummary {
  id: string; pathTitle: string; team: string; teamLabel: string;
  user: { id: string; name: string }; buddy: { id: string; name: string };
  status: TrainingStatus; lessonsDone: number; lessonsTotal: number;
  signedOffByName: string; signedOffAt: string | null; createdAt: string;
}
export interface PlanItem { stage: Stage; lessonId: string; title: string; available: boolean; done: boolean }
export interface AttemptQuestion { id: string; type: 'choice' | 'written'; text: string; options: string[]; correct: number | null; answer: number | string | null; right: boolean | null }
export interface Attempt { id: string; number: number; status: 'marking' | 'graded'; score: number | null; passed: boolean | null; submittedAt: string; toReview: string[]; questions?: AttemptQuestion[]; markedByName?: string }
export interface OpenAttempt { id: string; number: number; questions: { id: string; type: 'choice' | 'written'; text: string; options: string[] }[] }
export interface Assignment extends AssignmentSummary {
  items: PlanItem[]; passMark: number; attemptsUsed?: number; attemptsAllowed?: number; attempts: Attempt[]; openAttempt: OpenAttempt | null;
  can: { startTest: boolean; mark: boolean; allowRetry: boolean; signOff: boolean; cancel: boolean };
}

export const quietButton = 'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50';
export const primaryButton = 'inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50';
export const field = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900';
