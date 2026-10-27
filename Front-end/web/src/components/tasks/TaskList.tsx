'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Loader2, MessageSquare, Plus } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import TaskForm from './TaskForm';
import {
  PRIORITY_BADGE, STATUS_BADGE, TASK_STATUSES, formatDueDay, isConflict,
  type Task, type TaskBucket, type TaskDue, type TaskPage, type TaskStatus, type TaskView,
} from './types';

const VIEWS: { value: TaskView; label: string }[] = [
  { value: 'mine', label: 'My tasks' },
  { value: 'created', label: 'Given by me' },
  { value: 'team', label: 'Team tasks' },
];
const STATES: { value: TaskBucket; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'done', label: 'Done' },
  { value: 'archived', label: 'Archived' },
];
const DUES: { value: TaskDue | ''; label: string }[] = [
  { value: '', label: 'Any date' },
  { value: 'late', label: 'Due now' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
];

const asDue = (v: string | null): TaskDue | '' => (v === 'late' || v === 'overdue' || v === 'today' ? v : '');

function DueLabel({ t }: { t: Task }) {
  if (!t.dueOn) return null;
  const tone = t.overdue ? 'text-red-600 font-semibold' : t.dueToday ? 'text-amber-700 font-semibold' : 'text-gray-500';
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${tone}`}>
      <CalendarClock className="h-3.5 w-3.5" />
      {t.overdue ? 'Overdue · ' : t.dueToday ? 'Today · ' : ''}{formatDueDay(t.dueOn)}
    </span>
  );
}

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
        {showAssignee && <span>→ {t.assignee.name}</span>}
        {t.createdBy.id !== t.assignee.id && <span>from {t.createdBy.name}</span>}
        {t.order && <span className="text-blue-700">Order {t.order.code}</span>}
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
  const params = useSearchParams();
  const [view, setView] = useState<TaskView>('mine');
  const [state, setState] = useState<TaskBucket>('open');
  // ?due=late from the bell: start on what is due now.
  const [due, setDue] = useState<TaskDue | ''>(asDue(params.get('due')));
  const [creating, setCreating] = useState(false);

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
  });
  const rows = q.data?.pages.flatMap((p) => p.tasks) ?? [];
  const views = VIEWS.filter((v) => v.value !== 'team' || canSeeTeam);

  const pill = (active: boolean) =>
    `rounded-full px-3 py-1 text-sm font-medium ${active ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50'}`;

  return (
    <div className="space-y-4">
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

      {creating && <TaskForm onDone={() => setCreating(false)} onCancel={() => setCreating(false)} />}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select value={state} onChange={(e) => setState(e.target.value as TaskBucket)} aria-label="Open, done or archived" className="rounded-lg border border-gray-300 px-2 py-1.5">
          {STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {state === 'open' && DUES.map((d) => (
          <button key={d.value || 'any'} onClick={() => setDue(d.value)} className={pill(due === d.value)}>{d.label}</button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : q.isError ? (
        <p role="alert" className="text-sm text-red-600">{errorMessage(q.error, 'Could not load tasks.')}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          {state === 'open' ? (due ? 'Nothing due here.' : 'No open tasks.') : state === 'done' ? 'Nothing done yet.' : 'Nothing archived.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((t) => <TaskRow key={t.id} t={t} base={base} showAssignee={view !== 'mine'} />)}
        </ul>
      )}

      {q.hasNextPage && (
        <button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className="w-full rounded-lg py-2 text-sm text-blue-700 hover:bg-blue-50">
          {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
