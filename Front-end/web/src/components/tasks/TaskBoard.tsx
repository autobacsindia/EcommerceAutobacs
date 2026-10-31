'use client';

import { useState, type KeyboardEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import apiClient from '@/lib/api-client';
import { errorMessage } from '@/components/staff/sales/types';
import { useRefreshTasks, useTaskPages } from './hooks';
import { CompleteButton, QuickAdd, TaskMeta } from './TaskList';
import { Avatar, DuePill, PriorityFlag, STATUS_STYLE, SkeletonRows, StatusDot } from './ui';
import { TASK_STATUSES, isConflict, type Task, type TaskFilters, type TaskStatus } from './types';

/** How many finished cards the Done column shows; the rest are in the list view. */
const DONE_SHOWN = 20;

function BoardCard({ t, onOpen, onMove, moving }: {
  t: Task; onOpen: (id: string) => void; onMove: (t: Task, s: TaskStatus) => void; moving: boolean;
}) {
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); onOpen(t.id); } };
  return (
    <li
      draggable={t.can.status}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={() => onOpen(t.id)}
      onKeyDown={onKey}
      role="button"
      tabIndex={0}
      aria-label={`Open ${t.code}: ${t.title}`}
      className={`group rounded-xl border border-gray-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-200 ${
        t.can.status ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${moving ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5"><CompleteButton t={t} busy={moving} onToggle={() => onMove(t, t.status === 'done' ? 'todo' : 'done')} /></span>
        <p className={`flex-1 text-sm font-medium leading-snug ${t.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{t.title}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[26px]"><TaskMeta t={t} /></div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 pl-[26px]">
        <span className="flex items-center gap-2">
          <PriorityFlag priority={t.priority} />
          <DuePill t={t} />
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="whitespace-nowrap font-mono text-[10px] text-gray-400">{t.code}</span>
          <Avatar name={t.assignee.name} id={t.assignee.id} size="xs" />
        </span>
      </div>
      {/* Phones and tablets cannot drag: a small picker does the same move. */}
      {t.can.status && (
        <select
          value={t.status}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onMove(t, e.target.value as TaskStatus)}
          aria-label={`Move ${t.code}`}
          className="mt-2 w-full rounded-md border border-gray-200 px-1.5 py-1 text-xs md:hidden"
        >
          {TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>Move to: {s.label}</option>)}
        </select>
      )}
    </li>
  );
}

/**
 * The board: To do · In progress · Waiting · Done, cards dragged between
 * columns. A move shows at once and is confirmed by the server; if refused
 * (someone changed the task first, no permission) the card goes back and a
 * message says why.
 */
export default function TaskBoard({ filters, onOpen, quickAddFor }: {
  filters: TaskFilters; onOpen: (id: string) => void; quickAddFor?: string | null;
}) {
  const refresh = useRefreshTasks();
  const open = useTaskPages(filters, 'open');
  // A date filter is about what is still to do: the Done column has nothing to add.
  const done = useTaskPages(filters, 'done', !filters.due);
  const [moved, setMoved] = useState<Record<string, TaskStatus>>({});
  const [over, setOver] = useState<TaskStatus | null>(null);

  const tasks: Task[] = [
    ...(open.data?.pages.flatMap((p) => p.tasks) ?? []),
    ...(filters.due ? [] : (done.data?.pages[0]?.tasks ?? []).slice(0, DONE_SHOWN)),
  ];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const statusOf = (t: Task) => moved[t.id] ?? t.status;
  const unmove = (id: string) => setMoved((m) => { const next = { ...m }; delete next[id]; return next; });

  const move = useMutation({
    mutationFn: ({ t, status }: { t: Task; status: TaskStatus }) =>
      apiClient.patch<{ task: Task }>(`/staff/tasks/${encodeURIComponent(t.id)}`, { rev: t.rev, status }),
    onMutate: ({ t, status }) => { setMoved((m) => ({ ...m, [t.id]: status })); },
    onSuccess: (_r, { t, status }) => { if (status === 'done') toast.success(`${t.code} done`, { id: `done-${t.id}` }); },
    onError: (e, { t }) => {
      unmove(t.id);
      toast.error(isConflict(e)
        ? `${t.code} was changed by someone else just now — the board has been refreshed.`
        : errorMessage(e, `Could not move ${t.code}.`));
    },
    onSettled: async (_r, _e, { t }) => { await refresh(); unmove(t.id); },
  });
  const onMove = (t: Task, status: TaskStatus) => { if (status !== statusOf(t)) move.mutate({ t, status }); };

  if (open.isLoading) return <SkeletonRows rows={6} />;
  if (open.isError) return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage(open.error, 'Could not load tasks.')}</p>;

  const columns = TASK_STATUSES.filter((c) => !(filters.due && c.value === 'done'));
  return (
    <div className="space-y-3">
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
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
              className={`flex w-72 shrink-0 flex-col rounded-2xl border-t-4 bg-gray-100/80 p-2 transition md:w-auto md:min-w-0 md:flex-1 ${STATUS_STYLE[col.value].bar} ${
                over === col.value ? 'bg-blue-50 ring-2 ring-blue-300' : ''
              }`}
            >
              <h3 className="mb-2 flex items-center gap-2 px-1.5 pt-1 text-xs font-bold uppercase tracking-wide text-gray-700">
                <StatusDot status={col.value} />{col.label}
                <span className="rounded-full bg-white px-1.5 text-[11px] font-semibold text-gray-600">{cards.length}</span>
              </h3>
              <ul className="min-h-24 space-y-2">
                {cards.map((t) => (
                  <BoardCard key={t.id} t={t} onOpen={onOpen} onMove={onMove} moving={move.isPending && move.variables?.t.id === t.id} />
                ))}
              </ul>
              {col.value === 'done' && (done.data?.pages[0]?.tasks.length ?? 0) > DONE_SHOWN && (
                <p className="mt-2 px-1 text-xs text-gray-500">Showing the latest {DONE_SHOWN}. The list view has the rest.</p>
              )}
              {col.value !== 'done' && quickAddFor !== null && (
                <div className="mt-1 rounded-xl"><QuickAdd status={col.value} assigneeId={quickAddFor} /></div>
              )}
            </section>
          );
        })}
      </div>
      {open.hasNextPage && (
        <button onClick={() => open.fetchNextPage()} disabled={open.isFetchingNextPage} className="w-full rounded-lg py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
          {open.isFetchingNextPage ? 'Loading…' : 'Load more tasks'}
        </button>
      )}
      <p className="text-xs text-gray-500">Drag a card to another column to change its status. On a phone, use “Move to” on the card.</p>
    </div>
  );
}
