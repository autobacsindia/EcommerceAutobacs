'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquare } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import { ChecklistChip, DueLabel } from './DueLabel';
import {
  PRIORITY_BADGE, STATUS_BADGE, TASK_STATUSES, isConflict,
  type Task, type TaskDue, type TaskPage, type TaskStatus, type TaskView,
} from './types';

/** How many finished cards the Done column shows; the rest are one click away in the list. */
const DONE_SHOWN = 20;

const COLUMN_TONE: Record<TaskStatus, string> = {
  todo: 'border-t-gray-400',
  in_progress: 'border-t-blue-500',
  waiting: 'border-t-amber-500',
  done: 'border-t-green-500',
};

function usePages(filters: Record<string, string>, enabled = true) {
  return useInfiniteQuery({
    // The same key as the list view: switching between list and board reuses the data.
    queryKey: taskKeys.list(filters),
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) });
      return apiClient.get<TaskPage>(`/staff/tasks?${qs}`);
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    refetchInterval: 60_000,
    enabled,
  });
}

function BoardCard({ t, base, showAssignee, onMove, moving }: {
  t: Task; base: string; showAssignee: boolean; onMove: (t: Task, s: TaskStatus) => void; moving: boolean;
}) {
  return (
    <li
      draggable={t.can.status}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; }}
      className={`rounded-lg border border-gray-200 bg-white p-2.5 shadow-sm ${t.can.status ? 'cursor-grab active:cursor-grabbing' : ''} ${moving ? 'opacity-50' : ''}`}
    >
      <Link href={`${base}/${t.id}`} className="block" draggable={false}>
        <p className="text-[11px] text-gray-400">{t.code}</p>
        <p className={`text-sm font-medium text-gray-900 hover:text-blue-700 ${t.status === 'done' ? 'line-through decoration-gray-400' : ''}`}>{t.title}</p>
      </Link>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
        {t.priority !== 'normal' && <span className={`rounded px-1.5 py-0.5 font-medium ${PRIORITY_BADGE[t.priority]}`}>{t.priorityLabel}</span>}
        <DueLabel t={t} />
        <ChecklistChip t={t} />
        {showAssignee && <span>→ {t.assignee.name}</span>}
        {t.group && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">👥 {t.group.size}</span>}
        {t.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" />{t.commentCount}</span>}
      </div>
      {/* Phones and tablets cannot drag: a small picker does the same move. */}
      {t.can.status && (
        <select
          value={t.status}
          onChange={(e) => onMove(t, e.target.value as TaskStatus)}
          aria-label={`Move ${t.code}`}
          className="mt-2 w-full rounded border border-gray-200 px-1.5 py-1 text-xs md:hidden"
        >
          {TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>Move to: {s.label}</option>)}
        </select>
      )}
    </li>
  );
}

/**
 * The board: To do · In progress · Waiting · Done, with cards dragged between
 * columns. A move is shown at once and confirmed by the server; if the server
 * refuses (someone changed the task first, or no permission) the card goes
 * back and the reason is shown.
 */
export default function TaskBoard({ view, due, base, showAssignee }: {
  view: TaskView; due: TaskDue | ''; base: string; showAssignee: boolean;
}) {
  const queryClient = useQueryClient();
  const open = usePages({ view, state: 'open', ...(due ? { due } : {}) });
  // A date filter is about what is still to do: the Done column has nothing to add.
  const done = usePages({ view, state: 'done' }, !due);
  const [moved, setMoved] = useState<Record<string, TaskStatus>>({});
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [error, setError] = useState('');

  const tasks: Task[] = [
    ...(open.data?.pages.flatMap((p) => p.tasks) ?? []),
    ...(due ? [] : (done.data?.pages[0]?.tasks ?? []).slice(0, DONE_SHOWN)),
  ];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const statusOf = (t: Task) => moved[t.id] ?? t.status;

  const move = useMutation({
    mutationFn: ({ t, status }: { t: Task; status: TaskStatus }) =>
      apiClient.patch<{ task: Task }>(`/staff/tasks/${encodeURIComponent(t.id)}`, { rev: t.rev, status }),
    onMutate: ({ t, status }) => { setError(''); setMoved((m) => ({ ...m, [t.id]: status })); },
    onError: (e, { t }) => {
      setMoved((m) => { const next = { ...m }; delete next[t.id]; return next; });
      setError(isConflict(e)
        ? `${t.code} was changed by someone else just now — the board has been refreshed.`
        : errorMessage(e, `Could not move ${t.code}.`));
    },
    onSettled: async (_r, _e, { t }) => {
      await queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      setMoved((m) => { const next = { ...m }; delete next[t.id]; return next; });
    },
  });
  const onMove = (t: Task, status: TaskStatus) => { if (status !== statusOf(t)) move.mutate({ t, status }); };

  if (open.isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;
  if (open.isError) return <p role="alert" className="text-sm text-red-600">{errorMessage(open.error, 'Could not load tasks.')}</p>;

  const columns = TASK_STATUSES.filter((c) => !(due && c.value === 'done'));
  return (
    <div className="space-y-3">
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const cards = tasks.filter((t) => statusOf(t) === col.value);
          return (
            <section
              key={col.value}
              aria-label={col.label}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(col.value); }}
              onDragLeave={() => setOver((o) => (o === col.value ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const t = byId.get(e.dataTransfer.getData('text/plain'));
                if (t?.can.status) onMove(t, col.value);
              }}
              className={`flex w-64 shrink-0 flex-col rounded-xl border-t-4 bg-gray-100 p-2 md:w-auto md:flex-1 ${COLUMN_TONE[col.value]} ${over === col.value ? 'ring-2 ring-blue-400' : ''}`}
            >
              <h3 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold text-gray-700">
                {col.label}
                <span className={`rounded-full px-2 text-xs ${STATUS_BADGE[col.value]}`}>{cards.length}</span>
              </h3>
              <ul className="min-h-24 space-y-2">
                {cards.map((t) => (
                  <BoardCard
                    key={t.id}
                    t={t}
                    base={base}
                    showAssignee={showAssignee}
                    onMove={onMove}
                    moving={move.isPending && move.variables?.t.id === t.id}
                  />
                ))}
              </ul>
              {col.value === 'done' && (done.data?.pages[0]?.tasks.length ?? 0) > DONE_SHOWN && (
                <p className="mt-2 px-1 text-xs text-gray-500">Showing the latest {DONE_SHOWN}. Use the list view → Done for the rest.</p>
              )}
            </section>
          );
        })}
      </div>
      {open.hasNextPage && (
        <button onClick={() => open.fetchNextPage()} disabled={open.isFetchingNextPage} className="w-full rounded-lg py-2 text-sm text-blue-700 hover:bg-blue-50">
          {open.isFetchingNextPage ? 'Loading…' : 'Load more jobs'}
        </button>
      )}
      <p className="text-xs text-gray-500">Drag a card to another column to change its status. On a phone, use “Move to” on the card.</p>
    </div>
  );
}
