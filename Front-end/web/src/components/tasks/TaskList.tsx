'use client';

import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, ListChecks, MessageSquare, Package, Plus, Users } from 'lucide-react';
import { errorMessage } from '@/components/staff/sales/types';
import { useQuickAdd, useSetStatus, useTaskPages } from './hooks';
import { Avatar, Chip, DuePill, PriorityFlag, STATUS_STYLE, SkeletonRows, StatusDot } from './ui';
import type { Task, TaskFilters, TaskStatus } from './types';

/** Active work first, finished work last (and folded away). */
const GROUPS: TaskStatus[] = ['in_progress', 'waiting', 'todo', 'done'];

/** The round tick at the start of a row: one click marks the task done (or opens it again). */
export function CompleteButton({ t, onToggle, busy }: { t: Task; onToggle: () => void; busy: boolean }) {
  const done = t.status === 'done';
  if (!t.can.status) {
    return <span aria-hidden className={`h-[18px] w-[18px] shrink-0 rounded-full border-2 ${done ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300'}`} />;
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      onKeyDown={(e) => e.stopPropagation()}
      disabled={busy}
      aria-label={done ? `Open ${t.code} again` : `Mark ${t.code} done`}
      title={done ? 'Open again' : 'Mark done'}
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
        done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300 text-transparent hover:border-emerald-500 hover:text-emerald-500'
      }`}
    >
      <Check className="h-3 w-3" strokeWidth={3} />
    </button>
  );
}

/** Small facts beside a title: shared, checklist, comments, order. */
export function TaskMeta({ t }: { t: Task }) {
  return (
    <>
      {t.group && <Chip tone="bg-purple-100 text-purple-800" title={`Given to ${t.group.size} people`}><Users aria-hidden className="h-3 w-3" />{t.group.size}</Chip>}
      {t.checklist?.total > 0 && (
        <Chip tone={t.checklist.done === t.checklist.total ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'} title={`${t.checklist.done} of ${t.checklist.total} steps done`}>
          <ListChecks aria-hidden className="h-3 w-3" />{t.checklist.done}/{t.checklist.total}
        </Chip>
      )}
      {t.commentCount > 0 && <Chip title={`${t.commentCount} comments`}><MessageSquare aria-hidden className="h-3 w-3" />{t.commentCount}</Chip>}
      {t.order && <Chip tone="bg-sky-100 text-sky-800" title={`Order ${t.order.code}`}><Package aria-hidden className="h-3 w-3" />{t.order.code}</Chip>}
    </>
  );
}

function TaskRow({ t, onOpen }: { t: Task; onOpen: (id: string) => void }) {
  const move = useSetStatus();
  const open = () => onOpen(t.id);
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKey}
      aria-label={`Open ${t.code}: ${t.title}`}
      className="flex cursor-pointer items-center gap-3 border-b border-gray-100 px-3 py-2.5 transition-colors last:border-b-0 hover:bg-gray-50 focus:bg-blue-50 focus:outline-none"
    >
      <CompleteButton t={t} busy={move.isPending} onToggle={() => move.mutate({ t, status: t.status === 'done' ? 'todo' : 'done' })} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`line-clamp-2 break-words text-sm font-medium ${t.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{t.title}</span>
          <span className="font-mono text-[11px] text-gray-400">{t.code}</span>
          <TaskMeta t={t} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="hidden sm:inline-flex"><DuePill t={t} /></span>
        <PriorityFlag priority={t.priority} />
        <Avatar name={t.assignee.name} id={t.assignee.id} />
      </div>
    </li>
  );
}

/** "+ Add task" at the foot of a group or column: type, Enter, keep typing; Escape to stop. */
export function QuickAdd({ status, assigneeId, label = 'Add task' }: { status: TaskStatus; assigneeId?: string; label?: string }) {
  const add = useQuickAdd();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-2 rounded-b-xl px-3 py-2 text-left text-sm text-gray-400 hover:bg-gray-50 hover:text-gray-700">
        <Plus aria-hidden className="h-4 w-4" /> {label}
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const text = title.trim();
        if (!text) return;
        add.mutate({ title: text, status, assigneeId }, { onSuccess: () => setTitle('') });
      }}
      className="flex items-center gap-2 px-3 py-1.5"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); setTitle(''); } }}
        onBlur={() => { if (!title.trim()) setOpen(false); }}
        autoFocus
        maxLength={200}
        placeholder="Task name, then Enter"
        aria-label={`New task in ${STATUS_STYLE[status].label}`}
        className="min-w-0 flex-1 rounded-md border border-blue-500! px-2 py-1 text-sm outline-none ring-2 ring-blue-100"
      />
      <button type="submit" disabled={add.isPending || !title.trim()} className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-40">Save</button>
    </form>
  );
}

function Group({ status, tasks, onOpen, collapsed, onToggle, quickAddFor, footer }: {
  status: TaskStatus; tasks: Task[]; onOpen: (id: string) => void; collapsed: boolean; onToggle: () => void;
  quickAddFor?: string | null; footer?: ReactNode;
}) {
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <section aria-label={STATUS_STYLE[status].label} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <button type="button" onClick={onToggle} aria-expanded={!collapsed} className="flex w-full items-center gap-2 rounded-t-xl px-3 py-2.5 text-left hover:bg-gray-50">
        <Chevron aria-hidden className="h-4 w-4 text-gray-400" />
        <StatusDot status={status} />
        <span className="text-xs font-bold uppercase tracking-wide text-gray-700">{STATUS_STYLE[status].label}</span>
        <span className="rounded-full bg-gray-100 px-1.5 text-[11px] font-semibold text-gray-600">{status === 'done' && collapsed ? '…' : tasks.length}</span>
      </button>
      {!collapsed && (
        <div className="border-t border-gray-100">
          <ul>{tasks.map((t) => <TaskRow key={t.id} t={t} onOpen={onOpen} />)}</ul>
          {footer}
          {quickAddFor !== null && status !== 'done' && <QuickAdd status={status} assigneeId={quickAddFor} />}
        </div>
      )}
    </section>
  );
}

/**
 * The list view: open tasks grouped by status (In progress · Waiting · To do),
 * each group with its own "+ Add task", and Done folded at the bottom.
 * `quickAddFor`: who a quick-added task goes to (undefined = me; null = no quick add).
 */
export default function TaskListView({ filters, onOpen, quickAddFor, empty }: {
  filters: TaskFilters; onOpen: (id: string) => void; quickAddFor?: string | null; empty: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ done: true });
  const open = useTaskPages(filters, 'open');
  // A date filter is about what is still to do: no Done group then.
  const showDone = !filters.due;
  const done = useTaskPages(filters, 'done', showDone && !collapsed.done);

  if (open.isLoading) return <SkeletonRows rows={6} />;
  if (open.isError) return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage(open.error, 'Could not load tasks.')}</p>;

  const rows = open.data?.pages.flatMap((p) => p.tasks) ?? [];
  const doneRows = done.data?.pages.flatMap((p) => p.tasks) ?? [];
  const toggle = (s: TaskStatus) => setCollapsed((c) => ({ ...c, [s]: !c[s] }));
  const narrowed = !!(filters.q || filters.due || filters.priority);

  return (
    <div className="space-y-3">
      {rows.length === 0 && empty}
      {GROUPS.filter((s) => s !== 'done' || showDone).map((s) => {
        const tasks = s === 'done' ? doneRows : rows.filter((t) => t.status === s);
        // An empty group is shown (for its "+ Add task") only when the list is not empty or narrowed.
        if (s !== 'done' && tasks.length === 0 && (rows.length === 0 || narrowed)) return null;
        return (
          <Group
            key={s}
            status={s}
            tasks={tasks}
            onOpen={onOpen}
            collapsed={!!collapsed[s]}
            onToggle={() => toggle(s)}
            quickAddFor={quickAddFor}
            footer={s === 'done' ? (
              done.isLoading ? <div className="px-3 py-2"><SkeletonRows rows={2} /></div>
                : doneRows.length === 0 ? <p className="px-3 py-3 text-sm text-gray-400">Nothing finished yet.</p>
                  : done.hasNextPage ? <button onClick={() => done.fetchNextPage()} className="w-full py-2 text-sm font-medium text-blue-700 hover:bg-gray-50">Show more done</button> : null
            ) : null}
          />
        );
      })}
      {open.hasNextPage && (
        <button onClick={() => open.fetchNextPage()} disabled={open.isFetchingNextPage} className="w-full rounded-lg py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
          {open.isFetchingNextPage ? 'Loading…' : 'Load more tasks'}
        </button>
      )}
    </div>
  );
}
