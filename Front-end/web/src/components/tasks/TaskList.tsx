'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Columns3, Info, List, Loader2, MessageSquare, Plus, X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import TaskForm from './TaskForm';
import TaskBoard from './TaskBoard';
import { ChecklistChip, DueLabel } from './DueLabel';
import {
  PRIORITY_BADGE, STATUS_BADGE, TASK_STATUSES, isConflict,
  type Task, type TaskBucket, type TaskDue, type TaskPage, type TaskStatus, type TaskView,
} from './types';

/** The three lists, in plain words. The team list is "My team" for a head, "All teams" for the admin. */
function viewsFor(isAdmin: boolean): { value: TaskView; label: string; hint: string }[] {
  return [
    { value: 'mine', label: 'For me', hint: 'Jobs someone gave to you (and jobs you added for yourself).' },
    { value: 'created', label: 'I gave out', hint: 'Jobs you gave to other people — check whether they are done.' },
    isAdmin
      ? { value: 'team', label: 'All teams', hint: 'Every job in every team.' }
      : { value: 'team', label: 'My team', hint: 'Every job given to someone in your team.' },
  ];
}
const STATES: { value: TaskBucket; label: string }[] = [
  { value: 'open', label: 'Not done yet' },
  { value: 'done', label: 'Done' },
  { value: 'archived', label: 'Archived' },
];
const DUES: { value: TaskDue | ''; label: string }[] = [
  { value: '', label: 'Any date' },
  { value: 'late', label: 'Late or due today' },
  { value: 'overdue', label: 'Late' },
  { value: 'today', label: 'Due today' },
];

const HELP_KEY = 'tasks-help-hidden';
const MODE_KEY = 'tasks-view-mode';
type Mode = 'list' | 'board';

/** "How tasks work" — shown until the person hides it (remembered on this device). */
function HowItWorks({ canGive }: { canGive: boolean }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try { setHidden(localStorage.getItem(HELP_KEY) === '1'); } catch { setHidden(false); }
  }, []);
  if (hidden) return null;
  const hide = () => {
    setHidden(true);
    try { localStorage.setItem(HELP_KEY, '1'); } catch { /* private window: hide for this visit only */ }
  };
  return (
    <aside className="relative rounded-xl border border-blue-100 bg-blue-50 p-4 pr-10 text-sm text-blue-900">
      <button onClick={hide} aria-label="Hide how tasks work" className="absolute right-2 top-2 rounded p-1 text-blue-700 hover:bg-blue-100">
        <X className="h-4 w-4" />
      </button>
      <p className="mb-2 flex items-center gap-1.5 font-semibold"><Info className="h-4 w-4" /> How tasks work</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Press <strong>New task</strong>, write what needs doing{canGive ? ', choose who should do it' : ''} and pick a due date.</li>
        <li>{canGive ? 'That person gets a pop-up and finds it under ' : 'It appears under '}<strong>For me</strong>. They change the status as they work: To do → In progress → Done.</li>
        <li>Open a task to write a comment or see what changed. Late jobs show in red and in the bell.</li>
      </ol>
      {!canGive && <p className="mt-2 text-blue-800">Team heads and the admin can give jobs to other people; you can add jobs for yourself.</p>}
    </aside>
  );
}

const asDue = (v: string | null): TaskDue | '' => (v === 'late' || v === 'overdue' || v === 'today' ? v : '');

function TaskRow({ t, base, showAssignee }: { t: Task; base: string; showAssignee: boolean }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const move = useMutation({
    mutationFn: (status: TaskStatus) => apiClient.patch<{ task: Task }>(`/staff/tasks/${encodeURIComponent(t.id)}`, { rev: t.rev, status }),
    onSuccess: () => { setError(''); queryClient.invalidateQueries({ queryKey: taskKeys.all }); },
    onError: (e) => {
      setError(errorMessage(e, 'Could not change the status.'));
      // Someone changed it first: show what it is now.
      if (isConflict(e)) queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link href={`${base}/${t.id}`} className="min-w-0 flex-1">
          <p className="text-xs text-gray-400">{t.code}</p>
          <p className={`font-medium text-gray-900 hover:text-blue-700 ${t.bucket === 'done' ? 'line-through decoration-gray-400' : ''}`}>{t.title}</p>
          {t.summary && <p className="mt-0.5 line-clamp-1 text-sm text-gray-500">{t.summary}</p>}
        </Link>
        {t.can.status ? (
          <select
            value={t.status}
            onChange={(e) => move.mutate(e.target.value as TaskStatus)}
            disabled={move.isPending}
            aria-label={`Status of ${t.code}`}
            className={`rounded-full border-0 px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[t.status]}`}
          >
            {TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        ) : (
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[t.status]}`}>{t.statusLabel}</span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
        {t.priority !== 'normal' && <span className={`rounded px-1.5 py-0.5 font-medium ${PRIORITY_BADGE[t.priority]}`}>{t.priorityLabel}</span>}
        <DueLabel t={t} />
        <ChecklistChip t={t} />
        {showAssignee && <span>→ {t.assignee.name}</span>}
        {t.createdBy.id !== t.assignee.id && <span>from {t.createdBy.name}</span>}
        {t.order && <span className="text-blue-700">Order {t.order.code}</span>}
        {t.group && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">👥 {t.group.size} people</span>}
        {t.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" />{t.commentCount}</span>}
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </li>
  );
}

/**
 * The tasks screen: my tasks, tasks I gave out, and (heads, admin) the team's.
 * `base` is where task pages live: /team/tasks or /admin/tasks.
 */
export default function TaskList({ base, canSeeTeam }: { base: string; canSeeTeam: boolean }) {
  const isAdmin = base.startsWith('/admin');
  const params = useSearchParams();
  const [view, setView] = useState<TaskView>('mine');
  const [state, setState] = useState<TaskBucket>('open');
  // ?due=late from the bell: start on what is due now.
  const [due, setDue] = useState<TaskDue | ''>(asDue(params.get('due')));
  const [creating, setCreating] = useState(false);
  // List or board, remembered on this device.
  const [mode, setModeState] = useState<Mode>('list');
  useEffect(() => {
    try { if (localStorage.getItem(MODE_KEY) === 'board') setModeState('board'); } catch { /* storage blocked: list */ }
  }, []);
  const setMode = (m: Mode) => {
    setModeState(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* storage blocked: this visit only */ }
  };

  const filters = { view, state, ...(state === 'open' && due ? { due } : {}) };
  const q = useInfiniteQuery({
    queryKey: taskKeys.list(filters),
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) });
      return apiClient.get<TaskPage>(`/staff/tasks?${qs}`);
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    refetchInterval: 60_000,
    // The board runs its own queries (same keys for open jobs).
    enabled: mode === 'list',
  });
  const rows = q.data?.pages.flatMap((p) => p.tasks) ?? [];
  const views = viewsFor(isAdmin).filter((v) => v.value !== 'team' || canSeeTeam);
  const current = views.find((v) => v.value === view) ?? views[0];

  const pill = (active: boolean) =>
    `rounded-full px-3 py-1 text-sm font-medium ${active ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50'}`;

  return (
    <div className="space-y-4">
      {/* Heads and the admin give jobs to others: exactly the people who see the team list. */}
      <HowItWorks canGive={canSeeTeam} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Whose tasks">
          {views.map((v) => (
            <button key={v.value} role="tab" aria-selected={view === v.value} onClick={() => setView(v.value)} className={pill(view === v.value)}>
              {v.label}
            </button>
          ))}
        </div>
        {!creating && (
          <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" /> New task
          </button>
        )}
      </div>

      <p className="-mt-2 text-sm text-gray-500">{current.hint}</p>

      {creating && <TaskForm onDone={() => setCreating(false)} onCancel={() => setCreating(false)} />}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="mr-1 inline-flex overflow-hidden rounded-lg ring-1 ring-gray-200" role="group" aria-label="Show as">
          <button onClick={() => setMode('list')} aria-pressed={mode === 'list'} className={`inline-flex items-center gap-1 px-2.5 py-1.5 ${mode === 'list' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700'}`}>
            <List className="h-4 w-4" /> List
          </button>
          <button onClick={() => setMode('board')} aria-pressed={mode === 'board'} className={`inline-flex items-center gap-1 px-2.5 py-1.5 ${mode === 'board' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700'}`}>
            <Columns3 className="h-4 w-4" /> Board
          </button>
        </div>
        {/* The board always shows open jobs plus the latest done ones. */}
        {mode === 'list' && (
          <select value={state} onChange={(e) => setState(e.target.value as TaskBucket)} aria-label="Show jobs that are" className="rounded-lg border border-gray-300 px-2 py-1.5">
            {STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}
        {(mode === 'board' || state === 'open') && DUES.map((d) => (
          <button key={d.value || 'any'} onClick={() => setDue(d.value)} className={pill(due === d.value)}>{d.label}</button>
        ))}
      </div>

      {mode === 'board' ? (
        <TaskBoard view={view} due={due} base={base} showAssignee={view !== 'mine'} />
      ) : q.isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : q.isError ? (
        <p role="alert" className="text-sm text-red-600">{errorMessage(q.error, 'Could not load tasks.')}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          {state === 'done' ? 'No finished jobs here yet.'
            : state === 'archived' ? 'Nothing archived.'
              : due ? 'Nothing late or due today. 🎉'
                : view === 'mine' ? 'Nobody has given you a job yet. Press New task to add one for yourself.'
                  : view === 'created' ? 'You have not given out any jobs yet. Press New task to give one.'
                    : 'No jobs in progress.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((t) => <TaskRow key={t.id} t={t} base={base} showAssignee={view !== 'mine'} />)}
        </ul>
      )}

      {mode === 'list' && q.hasNextPage && (
        <button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className="w-full rounded-lg py-2 text-sm text-blue-700 hover:bg-blue-50">
          {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
