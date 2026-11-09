'use client';

import { useState, type KeyboardEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { MessageSquare, Package, Tag } from 'lucide-react';
import toast from 'react-hot-toast';
import apiClient from '@/lib/api-client';
import { errorMessage } from '@/components/staff/sales/types';
import { Kbd } from '@/components/panel/shortcuts';
import { useQuickEdit, useRefreshTasks, useTaskPages, type QuickEdit } from './hooks';
import { QuickDate, QuickMove, QuickPeople, QuickPriority } from './CardActions';
import TaskMenu from './TaskMenu';
import { CompleteButton, QuickAdd, TagList, TaskMeta } from './TaskList';
import { Chip, GroupCount, GroupPill, SkeletonRows } from './ui';
import { TASK_STATUSES, confirmComplete, isConflict, listOf, orderHrefFor, type Task, type TaskFilters, type TaskStatus } from './types';

/** How many finished cards the Done column shows; the rest are in the list view. */
const DONE_SHOWN = 20;

function BoardCard({ t, base, status, onOpen, onMove, moving, onTag, activeTag, dragging, onDrag }: {
  t: Task; base?: string; status: TaskStatus; onOpen: (id: string) => void; onMove: (t: Task, s: TaskStatus) => void; moving: boolean;
  onTag?: (tag: string) => void; activeTag?: string; dragging: boolean; onDrag: (id: string | null) => void;
}) {
  const edit = useQuickEdit();
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); onOpen(t.id); } };
  const done = t.status === 'done';
  const late = !done && t.overdue;
  const busy = moving || edit.isPending;
  const save = (patch: QuickEdit) => edit.mutate({ t, patch });
  return (
    <li
      draggable={t.can.status}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; onDrag(t.id); }}
      onDragEnd={() => onDrag(null)}
      onClick={() => onOpen(t.id)}
      onKeyDown={onKey}
      role="button"
      tabIndex={0}
      aria-label={`Open ${t.code}: ${t.title}`}
      data-late={late || undefined}
      data-dragging={dragging || undefined}
      className={`tk-card tk-more-host group rounded-lg bg-white px-3 py-2.5 focus:outline-none ${
        t.can.status ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${busy ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-px"><CompleteButton t={t} busy={busy} onToggle={() => onMove(t, done ? 'todo' : 'done')} /></span>
        <p className={`line-clamp-3 min-w-0 flex-1 break-words text-sm font-semibold leading-snug ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{t.title}</p>
        <span className="mt-0.5 shrink-0 whitespace-nowrap font-mono text-[11px] text-gray-500">{t.code}</span>
      </div>
      {t.tags?.length > 0 && <div className="mt-1.5 pl-[26px]"><TagList tags={t.tags} onTag={onTag} activeTag={activeTag} max={3} /></div>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[26px] empty:hidden">
        {late && <span className="rounded bg-red-100 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-red-800">Late</span>}
        <TaskMeta t={t} withComments={false} withOrder={false} />
        {t.order && (base
          ? (
            <Link
              href={orderHrefFor(base, t.order.id)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              title={`Open order ${t.order.code}`}
              className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-1.5 py-0.5 text-[11px] font-semibold text-sky-800 hover:underline"
            >
              <Package aria-hidden className="h-3 w-3" />{t.order.code}
            </Link>
          )
          : <Chip tone="bg-sky-100 text-sky-800" title={`Order ${t.order.code}`}><Package aria-hidden className="h-3 w-3" />{t.order.code}</Chip>)}
        {t.commentCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-gray-500" title={`${t.commentCount} comments`}>
            <MessageSquare aria-hidden className="h-3.5 w-3.5" />{t.commentCount}
            <span className="sr-only"> comments</span>
          </span>
        )}
      </div>
      {/* People, then the quick buttons: date · priority · tags · move. */}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <QuickPeople t={t} onSave={save} busy={busy} />
        <QuickDate t={t} onSave={save} busy={busy} />
        <QuickPriority t={t} onSave={save} busy={busy} />
        {!t.tags?.length && <span className="tk-qa inline-flex h-6 min-w-6 items-center justify-center rounded-md" data-empty title="No tags"><Tag aria-hidden className="h-3.5 w-3.5" /><span className="sr-only">No tags</span></span>}
        <QuickMove t={t} status={status} onMove={(s) => onMove(t, s)} busy={busy} />
        {base && <TaskMenu t={t} base={base} onOpen={onOpen} className="ml-auto" />}
      </div>
      {/* Phones and tablets cannot drag: a small picker does the same move. */}
      {t.can.status && (
        <select
          value={status}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
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
export default function TaskBoard({ filters, onOpen, quickAddFor, onTag, base }: {
  filters: TaskFilters; onOpen: (id: string) => void; quickAddFor?: string | null; onTag?: (tag: string) => void;
  /** Where the panel's pages live (/team or /admin), for the order link on a card. */
  base?: string;
}) {
  const refresh = useRefreshTasks();
  const open = useTaskPages(filters, 'open');
  // A date filter is about what is still to do: the Done column has nothing to add.
  const done = useTaskPages(filters, 'done', !filters.due);
  const [moved, setMoved] = useState<Record<string, TaskStatus>>({});
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  // A task just ticked done can sit in both lists until both reload: show it
  // once, as the newer answer has it (the done list is read last).
  const byId = new Map([
    ...(open.data?.pages.flatMap((p) => p.tasks) ?? []),
    ...(filters.due ? [] : (done.data?.pages[0]?.tasks ?? []).slice(0, DONE_SHOWN)),
  ].map((t) => [t.id, t]));
  const tasks: Task[] = [...byId.values()];
  const statusOf = (t: Task) => moved[t.id] ?? t.status;
  const unmove = (id: string) => setMoved((m) => { const next = { ...m }; delete next[id]; return next; });

  const move = useMutation({
    mutationFn: ({ t, status }: { t: Task; status: TaskStatus }) =>
      apiClient.patch<{ task: Task }>(`/staff/tasks/${encodeURIComponent(t.id)}`, { rev: t.rev, status }),
    onMutate: ({ t, status }) => { setMoved((m) => ({ ...m, [t.id]: status })); },
    onSuccess: (_r, { t, status }) => { if (status === 'done') toast.success(`${t.code} complete`, { id: `done-${t.id}` }); },
    onError: (e, { t }) => {
      unmove(t.id);
      toast.error(isConflict(e)
        ? `${t.code} was changed by someone else just now — the board has been refreshed.`
        : errorMessage(e, `Could not move ${t.code}.`));
    },
    onSettled: async (_r, _e, { t }) => { await refresh(); unmove(t.id); },
  });
  const onMove = (t: Task, status: TaskStatus) => {
    if (status === statusOf(t) || (status === 'done' && !confirmComplete(t))) return;
    move.mutate({ t, status });
  };

  if (open.isLoading) return <SkeletonRows rows={6} />;
  if (open.isError) return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage(open.error, 'Could not load tasks.')}</p>;

  const columns = TASK_STATUSES.filter((c) => !(filters.due && c.value === 'done'));
  return (
    <div className="space-y-3">
      <div className="relative -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 md:snap-none">
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
                setDragging(null);
                const t = byId.get(e.dataTransfer.getData('text/plain'));
                if (t?.can.status) onMove(t, col.value);
              }}
              data-status={col.value}
              data-over={over === col.value}
              // A wide screen: each column scrolls on its own under its heading, ClickUp-style.
              className="tk-col flex w-[272px] shrink-0 snap-start flex-col rounded-xl transition-[background-color,box-shadow] md:w-auto md:min-w-[236px] md:flex-1 lg:max-h-[calc(100dvh-11rem)] lg:min-h-64"
            >
              <h3 className="flex items-center gap-2 px-2.5 pb-2 pt-2.5">
                <GroupPill status={col.value}>{col.label}</GroupPill>
                <GroupCount status={col.value}>{cards.length}</GroupCount>
              </h3>
              {cards.length === 0 && <p className="px-3 py-2 text-center text-xs text-gray-500">No tasks here</p>}
              <ul className="min-h-4 flex-1 space-y-1.5 overflow-y-auto px-2 pb-1 [scrollbar-width:thin]">
                {cards.map((t) => (
                  <BoardCard
                    key={t.id} t={t} base={base} status={statusOf(t)} onOpen={onOpen} onMove={onMove}
                    moving={move.isPending && move.variables?.t.id === t.id} onTag={onTag} activeTag={filters.tag}
                    dragging={dragging === t.id} onDrag={setDragging}
                  />
                ))}
              </ul>
              {col.value === 'done' && (done.data?.pages[0]?.tasks.length ?? 0) > DONE_SHOWN && (
                <p className="px-3 pb-2 pt-1 text-xs text-gray-500">Showing the latest {DONE_SHOWN}. The list view has the rest.</p>
              )}
              {col.value !== 'done' && quickAddFor !== null && (
                <div className="px-2 pb-2 pt-1"><QuickAdd status={col.value} assigneeId={quickAddFor} listId={listOf(filters)} personal={filters.view === 'personal'} variant="board" /></div>
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
    </div>
  );
}
