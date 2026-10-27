'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, Loader2, Pencil, RotateCcw } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage } from '@/components/staff/sales/types';
import { OrderPicker, useAssignees } from './TaskForm';
import {
  PRIORITY_BADGE, STATUS_BADGE, TASK_PRIORITIES, TASK_STATUSES, formatDueDay, isConflict, newClientId, orderHrefFor,
  type CommentPage, type Task, type TaskComment, type TaskPriority, type TaskStatus,
} from './types';

type Patch = Partial<{
  title: string; description: string; priority: TaskPriority; dueOn: string | null;
  orderId: string | null; status: TaskStatus; assigneeId: string; archived: boolean;
}>;

const HISTORY_TEXT: Record<string, (h: NonNullable<Task['history']>[number]) => string> = {
  created: (h) => `created it for ${h.to}`,
  status: (h) => `moved it from ${h.from} to ${h.to}`,
  assignee: (h) => `gave it to ${h.to} (was ${h.from})`,
  priority: (h) => `changed priority from ${h.from} to ${h.to}`,
  due: (h) => `changed the due date from ${h.from === 'none' ? 'none' : formatDueDay(h.from)} to ${h.to === 'none' ? 'none' : formatDueDay(h.to)}`,
  order: (h) => `changed the order from ${h.from} to ${h.to}`,
  edited: (h) => `edited the ${h.from}`,
  archived: () => 'archived it',
  restored: () => 'restored it',
};

function Comments({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  // One id per comment being written, so a double-send posts once.
  const clientId = useRef(newClientId());
  const q = useInfiniteQuery({
    queryKey: taskKeys.comments(task.id),
    queryFn: ({ pageParam }) => apiClient.get<CommentPage>(
      `/staff/tasks/${encodeURIComponent(task.id)}/comments${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''}`,
    ),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextBefore || undefined,
    refetchInterval: 30_000,
  });
  const comments: TaskComment[] = q.data?.pages.flatMap((p) => p.comments) ?? [];
  const send = useMutation({
    mutationFn: () => apiClient.post<{ comment: TaskComment }>(`/staff/tasks/${encodeURIComponent(task.id)}/comments`, {
      text: text.trim(), clientId: clientId.current,
    }),
    onSuccess: () => {
      setText('');
      setError('');
      clientId.current = newClientId();
      queryClient.invalidateQueries({ queryKey: taskKeys.comments(task.id) });
      queryClient.invalidateQueries({ queryKey: taskKeys.one(task.id) });
    },
    onError: (e) => setError(errorMessage(e, 'Could not post the comment.')),
  });

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="mb-3 font-semibold text-gray-900">Comments</h2>
      {task.can.comment && (
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(); }} className="mb-4 space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            rows={2}
            placeholder="Write an update or a question…"
            aria-label="Comment"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={send.isPending || !text.trim()} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              {send.isPending ? 'Posting…' : 'Post'}
            </button>
          </div>
        </form>
      )}
      {comments.length === 0 && !q.isLoading && <p className="text-sm text-gray-500">No comments yet.</p>}
      <ul className="space-y-3">
        {comments.map((c) => (
          <li key={c.id} className="text-sm">
            <p className="text-xs text-gray-500"><span className="font-medium text-gray-800">{c.by.name}</span> · {formatDateTimeIST(c.createdAt)}</p>
            <p className="whitespace-pre-wrap text-gray-800">{c.text}</p>
          </li>
        ))}
      </ul>
      {q.hasNextPage && (
        <button onClick={() => q.fetchNextPage()} className="mt-3 text-sm text-blue-700 hover:underline">Older comments</button>
      )}
    </section>
  );
}

function EditForm({ task, saving, onSave, onCancel }: {
  task: Task; saving: boolean; onSave: (p: Patch) => void; onCancel: () => void;
}) {
  const [f, setF] = useState({ title: task.title, description: task.description || '', priority: task.priority, dueOn: task.dueOn || '' });
  const [order, setOrder] = useState(task.order);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ title: f.title.trim(), description: f.description.trim(), priority: f.priority, dueOn: f.dueOn || null, orderId: order?.id || null });
      }}
      className="space-y-3"
    >
      <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} required aria-label="Title" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium" />
      <textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={4000} rows={4} aria-label="Notes" placeholder="Notes" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-gray-600">
          Priority
          <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as TaskPriority })} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm">
            {TASK_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">
          Due date
          <input type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
      </div>
      <OrderPicker value={order} onChange={setOrder} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">Cancel</button>
        <button type="submit" disabled={saving || !f.title.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

/** One task: details, status, reassign, archive, comments and what happened to it. */
export default function TaskDetail({ id, base }: { id: string; base: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const q = useQuery({
    queryKey: taskKeys.one(id),
    queryFn: () => apiClient.get<{ task: Task }>(`/staff/tasks/${encodeURIComponent(id)}`),
    refetchInterval: 60_000,
  });
  const task = q.data?.task;
  const people = useAssignees();

  const save = useMutation({
    mutationFn: (patch: Patch) => apiClient.patch<{ task: Task }>(`/staff/tasks/${encodeURIComponent(id)}`, { rev: task!.rev, ...patch }),
    onSuccess: (res) => {
      setError('');
      setEditing(false);
      // The answer IS the task now; only the lists need reloading.
      queryClient.setQueryData(taskKeys.one(id), { task: res.task });
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
    onError: (e) => {
      setError(errorMessage(e, 'Could not save the change.'));
      // Someone else changed it first: load what it is now, keep the message up.
      if (isConflict(e)) queryClient.invalidateQueries({ queryKey: taskKeys.one(id) });
    },
  });

  if (q.isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;
  if (!task) {
    return (
      <div className="space-y-3">
        <Link href={base} className="inline-flex items-center gap-1 text-sm text-blue-700"><ArrowLeft className="h-4 w-4" /> All tasks</Link>
        <p role="alert" className="text-sm text-red-600">{errorMessage(q.error, 'This task could not be found.')}</p>
      </div>
    );
  }

  const reassignTo = (people.data?.people ?? []);
  return (
    <div className="space-y-4">
      <Link href={base} className="inline-flex items-center gap-1 text-sm text-blue-700"><ArrowLeft className="h-4 w-4" /> All tasks</Link>

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
        {editing ? (
          <EditForm task={task} saving={save.isPending} onSave={(p) => save.mutate(p)} onCancel={() => { setEditing(false); setError(''); }} />
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-gray-400">{task.code} · {task.teamLabel}</p>
              <h1 className="text-xl font-bold text-gray-900">{task.title}</h1>
              {task.description && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{task.description}</p>}
            </div>
            {task.can.edit && (
              <button onClick={() => setEditing(true)} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm text-gray-600 hover:bg-gray-100">
                <Pencil className="h-4 w-4" /> Edit
              </button>
            )}
          </div>
        )}

        {task.bucket === 'archived' && <p className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700">This task is archived.</p>}

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-gray-500">Status</dt>
            <dd>
              {task.can.status ? (
                <select
                  value={task.status}
                  onChange={(e) => save.mutate({ status: e.target.value as TaskStatus })}
                  disabled={save.isPending}
                  aria-label="Status"
                  className={`mt-0.5 rounded-full border-0 px-3 py-1 text-sm font-medium ${STATUS_BADGE[task.status]}`}
                >
                  {TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              ) : (
                <span className={`mt-0.5 inline-block rounded-full px-3 py-1 text-sm font-medium ${STATUS_BADGE[task.status]}`}>{task.statusLabel}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Who does it</dt>
            <dd>
              {task.can.reassign && reassignTo.length > 1 ? (
                <select
                  value={task.assignee.id}
                  onChange={(e) => save.mutate({ assigneeId: e.target.value })}
                  disabled={save.isPending}
                  aria-label="Who does it"
                  className="mt-0.5 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                >
                  {!reassignTo.some((p) => p.id === task.assignee.id) && <option value={task.assignee.id}>{task.assignee.name} (no longer here)</option>}
                  {reassignTo.map((p) => <option key={p.id} value={p.id}>{p.name}{p.teamLabel ? ` · ${p.teamLabel}` : ''}</option>)}
                </select>
              ) : (
                <span className="font-medium text-gray-900">{task.assignee.name}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Priority</dt>
            <dd><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${PRIORITY_BADGE[task.priority]}`}>{task.priorityLabel}</span></dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Due</dt>
            <dd className={task.overdue ? 'font-semibold text-red-600' : task.dueToday ? 'font-semibold text-amber-700' : 'text-gray-900'}>
              {task.dueOn ? `${task.overdue ? 'Overdue · ' : task.dueToday ? 'Today · ' : ''}${formatDueDay(task.dueOn)}` : 'No due date'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Given by</dt>
            <dd className="text-gray-900">{task.createdBy.name} · {formatDateTimeIST(task.createdAt)}</dd>
          </div>
          {task.order && (
            <div>
              <dt className="text-xs text-gray-500">Order</dt>
              <dd><Link href={orderHrefFor(base, task.order.id)} className="text-blue-700 hover:underline">{task.order.code}</Link></dd>
            </div>
          )}
        </dl>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        {(task.can.archive || task.can.restore) && (
          <div className="flex justify-end border-t border-gray-100 pt-3">
            {task.can.archive ? (
              <button
                onClick={() => { if (window.confirm('Archive this task? It moves to Archived and can be restored.')) save.mutate({ archived: true }); }}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
              >
                <Archive className="h-4 w-4" /> Archive
              </button>
            ) : (
              <button onClick={() => save.mutate({ archived: false })} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50">
                <RotateCcw className="h-4 w-4" /> Restore
              </button>
            )}
          </div>
        )}
      </section>

      <Comments task={task} />

      {task.history && task.history.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 font-semibold text-gray-900">History</h2>
          <ul className="space-y-1 text-sm text-gray-600">
            {task.history.map((h, i) => (
              <li key={`${h.at}-${i}`}>
                <span className="text-xs text-gray-400">{formatDateTimeIST(h.at)}</span> — <span className="font-medium text-gray-800">{h.by}</span>{' '}
                {(HISTORY_TEXT[h.action] ?? (() => h.action))(h)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
