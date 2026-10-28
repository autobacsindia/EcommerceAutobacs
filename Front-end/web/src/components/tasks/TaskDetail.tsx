'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Archive, ArrowLeft, Check, Link2, ListChecks, MessageSquare, Pencil, RotateCcw, Send, Users, X,
} from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage } from '@/components/staff/sales/types';
import { OrderPicker, useAssignees } from './TaskForm';
import { Avatar, DuePill, PriorityFlag, StatusPill, quietControl, statusSelectClass } from './ui';
import {
  TASK_PRIORITIES, TASK_STATUSES, formatDueDay, isConflict, isPastDay, newClientId, orderHrefFor, personLabel,
  type ChecklistItem, type CommentPage, type Task, type TaskComment, type TaskPriority, type TaskStatus,
} from './types';

type Patch = Partial<{
  title: string; description: string; priority: TaskPriority; dueOn: string | null;
  orderId: string | null; status: TaskStatus; assigneeId: string; archived: boolean;
}>;

const HISTORY_TEXT: Record<string, (h: NonNullable<Task['history']>[number]) => string> = {
  created: (h) => `created this task for ${h.to}`,
  status: (h) => `moved it from ${h.from} to ${h.to}`,
  assignee: (h) => `gave it to ${h.to} (was ${h.from})`,
  priority: (h) => `changed priority from ${h.from} to ${h.to}`,
  due: (h) => `changed the due date from ${h.from === 'none' ? 'none' : formatDueDay(h.from)} to ${h.to === 'none' ? 'none' : formatDueDay(h.to)}`,
  order: (h) => `changed the order from ${h.from} to ${h.to}`,
  edited: (h) => `edited the ${h.from}`,
  check_added: (h) => `added the step "${h.to}"`,
  check_renamed: (h) => `renamed a step to "${h.to}"`,
  check_removed: (h) => `removed the step "${h.to}"`,
  checked: (h) => `ticked "${h.to}"`,
  unchecked: (h) => `unticked "${h.to}"`,
  archived: () => 'archived it',
  restored: () => 'restored it',
};

/** "just now", "5m", "3h", "2d", then the date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return formatDateTimeIST(iso);
}

// ── Inline editing ───────────────────────────────────────────────────────────

/** Text shown as text until clicked; Enter (or leaving the field) saves, Escape cancels. */
function InlineText({ value, onSave, multiline = false, placeholder, label, className, canEdit, maxLength }: {
  value: string; onSave: (v: string) => void; multiline?: boolean; placeholder: string; label: string;
  className: string; canEdit: boolean; maxLength: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => { if (draft !== null) ref.current?.focus(); }, [draft !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canEdit) {
    return value
      ? <div className={`${className} whitespace-pre-wrap`}>{value}</div>
      : null;
  }
  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(value)}
        aria-label={`Edit ${label}`}
        className={`${className} group w-full rounded-md text-left hover:bg-gray-50 ${value ? '' : 'text-gray-400'}`}
      >
        <span className="whitespace-pre-wrap">{value || placeholder}</span>
        <Pencil aria-hidden className="ml-1.5 inline h-3.5 w-3.5 text-gray-300 opacity-0 group-hover:opacity-100" />
      </button>
    );
  }
  const commit = () => {
    const next = draft.trim();
    setDraft(null);
    if (next !== value.trim() && (next || multiline)) onSave(next);
  };
  const props = {
    ref,
    value: draft,
    maxLength,
    'aria-label': label,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
      if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
    },
    className: `${className} w-full rounded-md border border-blue-500! bg-white px-2 py-1 outline-none ring-2 ring-blue-100`,
  };
  return multiline ? <textarea rows={4} {...props} /> : <input {...props} />;
}

function Field({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <>
      <dt className="flex items-center gap-1.5 py-1.5 text-xs font-medium text-gray-500">{icon}{label}</dt>
      <dd className="min-w-0 py-1 text-sm text-gray-900">{children}</dd>
    </>
  );
}

const quietSelect = quietControl;

// ── Checklist ────────────────────────────────────────────────────────────────

/**
 * The task's steps. The doer ticks them; whoever gave the task (or the team head,
 * or the admin) adds, renames and removes them. Every change comes back as the
 * whole task, which replaces the page's copy.
 */
function Checklist({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const items: ChecklistItem[] = task.checklistItems ?? [];
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const addKey = useRef(newClientId());
  const url = `/staff/tasks/${encodeURIComponent(task.id)}/checklist`;
  const settle = (res: { task: Task }) => {
    setError('');
    queryClient.setQueryData(taskKeys.one(task.id), { task: res.task });
    queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
  };
  const fail = (fallback: string) => (e: unknown) => {
    setError(errorMessage(e, fallback));
    queryClient.invalidateQueries({ queryKey: taskKeys.one(task.id) });
  };
  const add = useMutation({
    mutationFn: () => apiClient.post<{ task: Task }>(url, { text: text.trim(), clientId: addKey.current }),
    onSuccess: (res) => { settle(res); setText(''); addKey.current = newClientId(); },
    onError: fail('Could not add the step.'),
  });
  const change = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { done?: boolean; text?: string } }) =>
      apiClient.patch<{ task: Task }>(`${url}/${encodeURIComponent(id)}`, patch),
    onSuccess: (res) => { settle(res); setEditing(null); },
    onError: fail('Could not change the step.'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete<{ task: Task }>(`${url}/${encodeURIComponent(id)}`),
    onSuccess: settle,
    onError: fail('Could not remove the step.'),
  });

  if (!items.length && !task.can.checklist) return null;
  const done = items.filter((c) => c.done).length;
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900"><ListChecks aria-hidden className="h-4 w-4 text-gray-500" /> Checklist</h3>
        {items.length > 0 && <span className="text-xs text-gray-500">{done} of {items.length} done</span>}
      </div>
      {items.length > 0 && (
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden>
          <div className="h-full rounded-full bg-emerald-500 transition-all duration-300" style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      )}
      <ul className="space-y-0.5">
        {items.map((c) => (
          <li key={c.id} className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-gray-50">
            <input
              type="checkbox"
              checked={c.done}
              disabled={!task.can.status || change.isPending}
              onChange={() => change.mutate({ id: c.id, patch: { done: !c.done } })}
              aria-label={`Step: ${c.text}`}
              className="h-4 w-4 shrink-0 accent-emerald-600"
            />
            {editing?.id === c.id ? (
              <form
                className="flex flex-1 items-center gap-1"
                onSubmit={(e) => { e.preventDefault(); if (editing.text.trim()) change.mutate({ id: c.id, patch: { text: editing.text.trim() } }); }}
              >
                <input
                  value={editing.text}
                  onChange={(e) => setEditing({ id: c.id, text: e.target.value })}
                  maxLength={200}
                  autoFocus
                  aria-label="Step text"
                  className="flex-1 rounded border border-gray-300 px-2 py-0.5 text-sm"
                />
                <button type="submit" aria-label="Save step" className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Check className="h-4 w-4" /></button>
                <button type="button" onClick={() => setEditing(null)} aria-label="Cancel" className="rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
              </form>
            ) : (
              <>
                <span className={`flex-1 text-sm ${c.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                  {c.text}
                  {c.done && c.doneBy && <span className="ml-2 text-xs text-gray-400 no-underline">✓ {c.doneBy}</span>}
                </span>
                {task.can.checklist && (
                  <span className="flex gap-0.5 md:opacity-0 md:group-hover:opacity-100">
                    <button onClick={() => setEditing({ id: c.id, text: c.text })} aria-label={`Rename ${c.text}`} className="rounded p-1 text-gray-500 hover:bg-gray-100"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => remove.mutate(c.id)} aria-label={`Remove ${c.text}`} className="rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {task.can.checklist && (
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(); }} className="mt-1.5 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={200}
            placeholder="Add a step and press Enter"
            aria-label="New step"
            className="flex-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-sm"
          />
          <button type="submit" disabled={add.isPending || !text.trim()} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Add</button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}

// ── Activity: comments and history on one timeline ───────────────────────────

type ActivityItem =
  | { kind: 'event'; at: string; by: string; text: string }
  | { kind: 'comment'; at: string; by: { id: string; name: string }; text: string; id: string };

function Activity({ task }: { task: Task }) {
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
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
    onError: (e) => setError(errorMessage(e, 'Could not post the comment.')),
  });

  const items: ActivityItem[] = [
    ...(task.history ?? []).map((h) => ({ kind: 'event' as const, at: h.at, by: h.by, text: (HISTORY_TEXT[h.action] ?? (() => h.action))(h) })),
    ...comments.map((c) => ({ kind: 'comment' as const, at: c.createdAt, by: c.by, text: c.text, id: c.id })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <section>
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <MessageSquare aria-hidden className="h-4 w-4 text-gray-500" /> Activity
      </h3>
      {q.hasNextPage && (
        <button onClick={() => q.fetchNextPage()} className="mb-2 text-xs font-medium text-blue-700 hover:underline">Show older comments</button>
      )}
      <ol className="space-y-3">
        {items.map((it, i) => (it.kind === 'comment' ? (
          <li key={it.id} className="flex gap-2.5">
            <Avatar name={it.by.name} id={it.by.id} size="sm" />
            <div className="min-w-0 flex-1 rounded-lg rounded-tl-none bg-gray-50 px-3 py-2">
              <p className="text-xs text-gray-500"><span className="font-semibold text-gray-900">{it.by.name}</span> · <time title={formatDateTimeIST(it.at)}>{timeAgo(it.at)}</time></p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-800">{it.text}</p>
            </div>
          </li>
        ) : (
          <li key={`e-${i}-${it.at}`} className="flex items-start gap-2.5 pl-1.5 text-xs text-gray-500">
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" />
            <p><span className="font-medium text-gray-700">{it.by}</span> {it.text} · <time title={formatDateTimeIST(it.at)}>{timeAgo(it.at)}</time></p>
          </li>
        )))}
      </ol>
      {task.can.comment && (
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(); }} className="mt-4">
          <div className="flex items-end gap-2 rounded-xl border border-gray-200 bg-white p-2 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) { e.preventDefault(); send.mutate(); } }}
              maxLength={2000}
              rows={2}
              placeholder="Write an update or a question…"
              aria-label="Comment"
              className="flex-1 resize-none border-0 bg-transparent px-1 text-sm outline-none"
            />
            <button type="submit" aria-label="Post" disabled={send.isPending || !text.trim()} className="rounded-lg bg-blue-600 p-2 text-white disabled:opacity-40">
              <Send className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1 text-[11px] text-gray-400">Ctrl/⌘ + Enter to send</p>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </form>
      )}
    </section>
  );
}

// ── The task ─────────────────────────────────────────────────────────────────

/**
 * One task: title and notes (click to edit), its properties, checklist, the
 * people sharing it, and the activity timeline. `onClose` = shown in the side
 * panel; without it, as a page of its own (opened from a pop-up or the bell).
 */
export default function TaskDetail({ id, base, onClose }: { id: string; base: string; onClose?: () => void }) {
  const queryClient = useQueryClient();
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
      // The answer IS the task now; only the lists need reloading.
      queryClient.setQueryData(taskKeys.one(id), { task: res.task });
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      queryClient.invalidateQueries({ queryKey: taskKeys.summary() });
      toast.success('Saved', { id: `task-saved-${id}`, duration: 1500 });
    },
    onError: (e) => {
      setError(errorMessage(e, 'Could not save the change.'));
      // Someone else changed it first: load what it is now, keep the message up.
      if (isConflict(e)) queryClient.invalidateQueries({ queryKey: taskKeys.one(id) });
    },
  });

  const back = onClose
    ? null
    : <Link href={base} className="inline-flex items-center gap-1 text-sm font-medium text-blue-700"><ArrowLeft className="h-4 w-4" /> All tasks</Link>;

  if (q.isLoading) {
    return (
      <div aria-hidden className="animate-pulse space-y-4 p-1">
        <div className="h-3 w-24 rounded bg-gray-200" />
        <div className="h-6 w-3/4 rounded bg-gray-200" />
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-4 w-1/2 rounded bg-gray-100" />)}
      </div>
    );
  }
  if (!task) {
    return (
      <div className="space-y-3">
        {back}
        <p role="alert" className="text-sm text-red-600">{errorMessage(q.error, 'This task could not be found.')}</p>
      </div>
    );
  }

  const reassignTo = people.data?.people ?? [];
  const archived = task.bucket === 'archived';
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${base}/${task.id}`);
      toast.success('Link copied');
    } catch { toast.error('Could not copy the link'); }
  };
  const setDue = (value: string) => {
    if (value && isPastDay(value) && !window.confirm('This date has already passed, so the task will show as late. Use it anyway?')) return;
    save.mutate({ dueOn: value || null });
  };

  return (
    <article className="space-y-6">
      {back}
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="font-mono">{task.code}</span><span aria-hidden>·</span><span>{task.teamLabel}</span>
          <span className="flex-1" />
          <button onClick={copyLink} aria-label="Copy link" title="Copy link" className="rounded-md p-1.5 hover:bg-gray-100"><Link2 className="h-4 w-4" /></button>
          {task.can.archive && (
            <button
              onClick={() => { if (window.confirm('Archive this task? It moves to Archived and can be restored.')) save.mutate({ archived: true }); }}
              aria-label="Archive" title="Archive" className="rounded-md p-1.5 hover:bg-gray-100"
            ><Archive className="h-4 w-4" /></button>
          )}
          {onClose && <button onClick={onClose} aria-label="Close" title="Close (Esc)" className="rounded-md p-1.5 hover:bg-gray-100"><X className="h-4 w-4" /></button>}
        </div>
        {archived && (
          <div className="flex items-center justify-between rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700">
            This task is archived.
            {task.can.restore && (
              <button onClick={() => save.mutate({ archived: false })} className="inline-flex items-center gap-1 font-medium text-blue-700"><RotateCcw className="h-4 w-4" /> Restore</button>
            )}
          </div>
        )}
        <h1 className="sr-only">{task.title}</h1>
        <InlineText
          value={task.title}
          onSave={(title) => save.mutate({ title })}
          label="title"
          placeholder="Task title"
          className="px-1 text-xl font-bold leading-snug text-gray-900"
          canEdit={task.can.edit}
          maxLength={200}
        />
      </header>

      <dl className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-x-3 border-y border-gray-100 py-2 sm:grid-cols-[110px_minmax(0,1fr)]">
        <Field label="Status">
          {task.can.status ? (
            <select
              value={task.status}
              onChange={(e) => save.mutate({ status: e.target.value as TaskStatus })}
              disabled={save.isPending}
              aria-label="Status"
              className={statusSelectClass(task.status)}
            >
              {TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          ) : <StatusPill status={task.status} />}
        </Field>
        <Field label="Assignee">
          <span className="flex items-center gap-2">
            <Avatar name={task.assignee.name} id={task.assignee.id} size="sm" />
            {task.can.reassign && reassignTo.length > 1 ? (
              <select
                value={task.assignee.id}
                onChange={(e) => save.mutate({ assigneeId: e.target.value })}
                disabled={save.isPending}
                aria-label="Who does it"
                className={quietSelect}
              >
                {!reassignTo.some((p) => p.id === task.assignee.id) && <option value={task.assignee.id}>{task.assignee.name} (no longer here)</option>}
                {reassignTo.map((p) => <option key={p.id} value={p.id}>{personLabel(p)}</option>)}
              </select>
            ) : <span>{task.assignee.name}</span>}
          </span>
        </Field>
        <Field label="Due date">
          {task.can.edit ? (
            <span className="flex flex-wrap items-center gap-2">
              <input type="date" value={task.dueOn || ''} onChange={(e) => setDue(e.target.value)} aria-label="Due date" className={quietSelect} />
              <DuePill t={task} />
            </span>
          ) : <DuePill t={task} empty={<span className="text-gray-400">No due date</span>} />}
        </Field>
        <Field label="Priority">
          {task.can.edit ? (
            <span className="flex items-center gap-1">
              <PriorityFlag priority={task.priority} />
              <select value={task.priority} onChange={(e) => save.mutate({ priority: e.target.value as TaskPriority })} aria-label="Priority" className={quietSelect}>
                {TASK_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </span>
          ) : <PriorityFlag priority={task.priority} withLabel />}
        </Field>
        <Field label="Order">
          {task.can.edit && task.order ? (
            <span className="flex items-center gap-1">
              <Link href={orderHrefFor(base, task.order.id)} className="font-medium text-blue-700 hover:underline">{task.order.code}</Link>
              <button onClick={() => save.mutate({ orderId: null })} aria-label="Unlink the order" title="Unlink" className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X className="h-3.5 w-3.5" /></button>
            </span>
          ) : task.can.edit ? (
            <OrderPicker value={null} onChange={(o) => { if (o) save.mutate({ orderId: o.id }); }} />
          ) : task.order
            ? <Link href={orderHrefFor(base, task.order.id)} className="font-medium text-blue-700 hover:underline">{task.order.code}</Link>
            : <span className="text-gray-400">None</span>}
        </Field>
        <Field label="Given by">
          <span className="flex items-center gap-2 text-gray-700">
            <Avatar name={task.createdBy.name} id={task.createdBy.id} size="xs" />{task.createdBy.name}
            <span className="text-xs text-gray-400">· {formatDateTimeIST(task.createdAt)}</span>
          </span>
        </Field>
      </dl>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <section>
        <h3 className="mb-1 text-sm font-semibold text-gray-900">Description</h3>
        <InlineText
          value={task.description || ''}
          onSave={(description) => save.mutate({ description })}
          multiline
          label="description"
          placeholder="Add more detail for whoever does this…"
          className="px-1 text-sm leading-relaxed text-gray-700"
          canEdit={task.can.edit}
          maxLength={4000}
        />
        {!task.can.edit && !task.description && <p className="text-sm text-gray-400">No description.</p>}
      </section>

      <Checklist task={task} />

      {task.group && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900"><Users aria-hidden className="h-4 w-4 text-gray-500" /> Given to {task.group.size} people</h3>
          <p className="mb-2 text-xs text-gray-500">Each person has their own copy and marks it done separately.</p>
          {(task.siblings ?? []).length > 0 ? (
            <>
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2 font-medium"><Avatar name={task.assignee.name} id={task.assignee.id} size="xs" />{task.assignee.name} <span className="text-xs font-normal text-gray-400">(this copy)</span></span>
                  <StatusPill status={task.status} />
                </li>
                {task.siblings!.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <Link href={`${base}/${c.id}`} className="flex items-center gap-2 text-blue-700 hover:underline">
                      <Avatar name={c.assignee.name} id={c.assignee.id} size="xs" />{c.assignee.name} <span className="text-xs text-gray-400">{c.code}</span>
                    </Link>
                    {c.bucket === 'archived' ? <span className="text-xs text-gray-500">Archived</span> : <StatusPill status={c.status} />}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-gray-500">
                {[task, ...task.siblings!].filter((c) => c.status === 'done').length} of {task.siblings!.length + 1} done
              </p>
            </>
          ) : <p className="text-sm text-gray-500">The others&apos; copies are theirs to update.</p>}
        </section>
      )}

      <Activity task={task} />
    </article>
  );
}

