'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CalendarDays, Lock, Network, UserPlus } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import AssigneePicker from './AssigneePicker';
import { useAssignees } from './TaskForm';
import { CompleteButton } from './TaskList';
import { AvatarStack, DuePill, StatusPill } from './ui';
import {
  MAX_ASSIGNEES, SUBTASKS_MAX, isConflict, newClientId, peopleOf,
  type Subtask, type SubtaskList, type Task, type TaskStatus,
} from './types';

/** After a sub-task changes: its row, its parent (the count), and every list. */
function useRefreshSubtasks(parentId: string) {
  const queryClient = useQueryClient();
  return (childId?: string) => Promise.all([
    queryClient.invalidateQueries({ queryKey: taskKeys.subtasks(parentId) }),
    queryClient.invalidateQueries({ queryKey: taskKeys.one(parentId) }),
    queryClient.invalidateQueries({ queryKey: taskKeys.lists() }),
    queryClient.invalidateQueries({ queryKey: taskKeys.summary() }),
    ...(childId ? [queryClient.invalidateQueries({ queryKey: taskKeys.one(childId) })] : []),
  ]);
}

/** One sub-task: tick, title (opens it, when the viewer may), people, due day. */
function SubtaskRow({ s, base, onOpen, onToggle, busy }: {
  s: Subtask; base: string; onOpen?: (id: string) => void; onToggle: () => void; busy: boolean;
}) {
  const title = <span className={`truncate ${s.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{s.title}</span>;
  return (
    <li className="flex items-center gap-2.5 px-2.5 py-2 text-sm hover:bg-gray-50">
      <CompleteButton t={s} busy={busy} onToggle={onToggle} />
      {s.canOpen ? (
        onOpen
          ? <button type="button" onClick={() => onOpen(s.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline">{title}</button>
          : <Link href={`${base}/${s.id}`} className="flex min-w-0 flex-1 items-center gap-2 hover:underline">{title}</Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2" title="Only the people on it, whoever gave it and their heads open it">
          {title}<Lock aria-label="You can’t open this one" className="h-3 w-3 shrink-0 text-gray-400" />
        </span>
      )}
      <span className="hidden font-mono text-[11px] text-gray-400 sm:inline">{s.code}</span>
      {s.status !== 'done' && s.status !== 'todo' && <span className="hidden sm:inline"><StatusPill status={s.status} /></span>}
      <DuePill t={s} />
      <AvatarStack people={peopleOf(s)} max={3} />
    </li>
  );
}

/**
 * "+ Add sub-task": a title, and who and when if wanted. One clientId per draft,
 * so a double Enter or a retry makes one; the people and date stay for the next.
 */
function QuickSubtask({ parent, onAdded }: { parent: Task; onAdded: () => void }) {
  const people = useAssignees().data?.people ?? [];
  const [title, setTitle] = useState('');
  const [who, setWho] = useState<string[]>([]);
  const [dueOn, setDueOn] = useState('');
  const [dating, setDating] = useState(false);
  const [error, setError] = useState('');
  const clientId = useRef(newClientId());
  const add = useMutation({
    mutationFn: () => apiClient.post<{ task: Task }>('/staff/tasks', {
      title: title.trim(),
      parentId: parent.id,
      clientId: clientId.current,
      shared: true,
      ...(who.length ? { assigneeIds: who } : {}),
      ...(dueOn ? { dueOn } : {}),
    }),
    onSuccess: () => {
      setError('');
      setTitle('');
      clientId.current = newClientId();
      onAdded();
    },
    // The draft (and its clientId) stays, so Enter again retries the same create.
    onError: (e) => setError(errorMessage(e, 'Could not add the sub-task.')),
  });
  const named = who.map((id) => people.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
  const chip = 'inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 px-2 text-xs text-gray-600 hover:bg-gray-50';
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (title.trim() && !add.isPending) add.mutate(); }}
      className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-2.5 py-2"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
        placeholder="Add a sub-task and press Enter"
        aria-label="New sub-task"
        className="min-w-[12rem] flex-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-sm"
      />
      <AssigneePicker
        people={people}
        selected={who}
        onChange={setWho}
        max={MAX_ASSIGNEES}
        label="Assignees"
        triggerLabel="Who does the sub-task"
        align="right"
        trigger={named.length
          ? <span className={chip}><AvatarStack people={named} max={3} /></span>
          : <span className={chip}><UserPlus aria-hidden className="h-3.5 w-3.5" /> Me</span>}
      />
      {dating || dueOn ? (
        <input
          type="date"
          value={dueOn}
          onChange={(e) => setDueOn(e.target.value)}
          onBlur={() => setDating(false)}
          autoFocus={dating && !dueOn}
          aria-label="Sub-task due date"
          className="h-7 rounded-md border border-gray-200 px-1.5 text-xs"
        />
      ) : (
        <button type="button" onClick={() => setDating(true)} className={chip}><CalendarDays aria-hidden className="h-3.5 w-3.5" /> Due date</button>
      )}
      <button type="submit" disabled={!title.trim() || add.isPending} className="h-7 rounded-md bg-gray-900 px-3 text-xs font-semibold text-white disabled:opacity-40">
        {add.isPending ? 'Adding…' : 'Add'}
      </button>
      {error && <p role="alert" className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}

/**
 * The sub-tasks under a task: everyone who sees the task sees them all listed,
 * and opens the ones they may. Whoever may edit the task adds more. Nothing on
 * a sub-task itself (one level only).
 */
export default function Subtasks({ task, base, onOpen }: { task: Task; base: string; onOpen?: (id: string) => void }) {
  const refresh = useRefreshSubtasks(task.id);
  const total = task.subtasks?.total ?? 0;
  const canAdd = !!task.can.subtask;
  const q = useQuery({
    queryKey: taskKeys.subtasks(task.id),
    queryFn: () => apiClient.get<SubtaskList>(`/staff/tasks/${encodeURIComponent(task.id)}/subtasks`),
    enabled: !task.parent && (total > 0 || canAdd),
  });
  const move = useMutation({
    mutationFn: ({ s, status }: { s: Subtask; status: TaskStatus }) =>
      apiClient.patch<{ task: Task }>(`/staff/tasks/${encodeURIComponent(s.id)}`, { rev: s.rev, status }),
    onError: (e, { s }) => toast.error(isConflict(e)
      ? `${s.code} was changed by someone else just now — refreshed.`
      : errorMessage(e, `Could not move ${s.code}.`)),
    onSettled: (_r, _e, { s }) => refresh(s.id),
  });

  if (task.parent || (!total && !canAdd)) return null;
  const list = q.data?.subtasks ?? [];
  const done = q.data ? q.data.done : task.subtasks?.done ?? 0;
  const count = q.data ? q.data.total : total;
  const full = count >= SUBTASKS_MAX;

  return (
    <section aria-labelledby={`subtasks-${task.id}`}>
      <div className="mb-2 flex items-center justify-between">
        <h3 id={`subtasks-${task.id}`} className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Network aria-hidden className="h-4 w-4 text-gray-500" /> Sub-tasks
        </h3>
        {count > 0 && <span className="text-xs text-gray-500">{done} of {count} done</span>}
      </div>
      {count > 0 && (
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden>
          <div className="h-full rounded-full bg-emerald-500 transition-all duration-300" style={{ width: `${(done / count) * 100}%` }} />
        </div>
      )}
      <div className="rounded-lg border border-gray-100">
        {q.isLoading ? (
          <div aria-hidden className="animate-pulse space-y-2 p-2.5">
            {Array.from({ length: Math.min(total || 1, 3) }, (_, i) => <div key={i} className="h-5 rounded bg-gray-100" />)}
          </div>
        ) : q.isError ? (
          <p role="alert" className="flex items-center justify-between gap-2 px-2.5 py-2 text-sm text-red-600">
            {errorMessage(q.error, 'Could not load the sub-tasks.')}
            <button type="button" onClick={() => q.refetch()} className="font-medium text-blue-700 hover:underline">Try again</button>
          </p>
        ) : list.length ? (
          <ul className="divide-y divide-gray-100">
            {list.map((s) => (
              <SubtaskRow
                key={s.id}
                s={s}
                base={base}
                onOpen={onOpen}
                busy={move.isPending && move.variables?.s.id === s.id}
                onToggle={() => move.mutate({ s, status: s.status === 'done' ? 'todo' : 'done' })}
              />
            ))}
          </ul>
        ) : (
          <p className="px-2.5 py-2 text-sm text-gray-500">No sub-tasks yet. Split the work into pieces with their own people and dates.</p>
        )}
        {canAdd && !full && <QuickSubtask parent={task} onAdded={() => refresh()} />}
        {canAdd && full && <p className="border-t border-gray-100 px-2.5 py-2 text-xs text-gray-500">A task can have at most {SUBTASKS_MAX} sub-tasks.</p>}
      </div>
    </section>
  );
}
