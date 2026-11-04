'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  AlignLeft, ArrowLeft, Bell, BellOff, CalendarDays, CalendarRange, Check, ChevronDown, ChevronUp, CircleDot, Clock, CornerLeftUp, Eye, Flag, Link2,
  ListChecks, ListTree, Maximize2, MessageSquare, Network, Package, Pencil, RotateCcw, Send, Tag, Timer as TimerIcon, Trash2, UserPlus, UserRound, Users, X, type LucideIcon,
} from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST, formatIsoDateIST } from '@/lib/datetime';
import { errorMessage } from '@/components/staff/sales/types';
import { OrderPicker, useAssignees } from './TaskForm';
import TagInput from './TagInput';
import { Activity, TaskFiles, timeAgo } from './Comments';
import { TagList } from './TaskList';
import AssigneePicker from './AssigneePicker';
import { useFollowers } from './hooks';
import { Linkified } from './links';
import TaskMenu from './TaskMenu';
import Subtasks from './Subtasks';
import { TimePanel, TimerButton } from './Timer';
import { Avatar, AvatarStack, DuePill, DueTimeSelect, PriorityFlag, StatusPill, quietControl, statusSelectClass } from './ui';
import { ListPicker } from './spaces';
import {
  FOLLOWERS_MAX, MAX_ASSIGNEES, TASK_PRIORITIES, TASK_STATUSES, confirmComplete, formatDueDay, formatDueKey, isConflict, isPastDue, newClientId, orderHrefFor, peopleOf,
  type Assignee, type ChecklistItem, type CommentPage, type Person, type Task, type TaskComment, type TaskPriority, type TaskStatus,
} from './types';

type Patch = Partial<{
  title: string; description: string; priority: TaskPriority; dueOn: string | null; dueTime: string | null; startOn: string | null; tags: string[];
  orderId: string | null; status: TaskStatus; assigneeId: string; assigneeIds: string[]; archived: boolean; listId: string | null;
}>;

const HISTORY_TEXT: Record<string, (h: NonNullable<Task['history']>[number]) => string> = {
  created: (h) => `created this task for ${h.to}`,
  status: (h) => `moved it from ${h.from} to ${h.to}`,
  assignee: (h) => `changed who does it to ${h.to} (was ${h.from})`,
  follower_added: (h) => `added ${h.to} as a follower`,
  follower_removed: (h) => `removed ${h.from} as a follower`,
  priority: (h) => `changed priority from ${h.from} to ${h.to}`,
  due: (h) => `changed the due date from ${h.from === 'none' ? 'none' : formatDueKey(h.from)} to ${h.to === 'none' ? 'none' : formatDueKey(h.to)}`,
  start: (h) => `changed the start date from ${h.from === 'none' ? 'none' : formatDueDay(h.from)} to ${h.to === 'none' ? 'none' : formatDueDay(h.to)}`,
  tags: (h) => (h.to === 'none' ? 'removed the tags' : `set the tags to ${h.to}`),
  order: (h) => `changed the order from ${h.from} to ${h.to}`,
  list: (h) => (h.from && h.to ? `moved it from the list ${h.from} to ${h.to}` : h.to ? `put it in the list ${h.to}` : `took it out of the list ${h.from}`),
  edited: (h) => `edited the ${h.from}`,
  check_added: (h) => `added the step "${h.to}"`,
  check_renamed: (h) => `renamed a step to "${h.to}"`,
  check_removed: (h) => `removed the step "${h.to}"`,
  checked: (h) => `ticked "${h.to}"`,
  unchecked: (h) => `unticked "${h.to}"`,
  archived: (h) => (h.to ? `moved it to Trash ${h.to}` : 'moved it to Trash'),
  restored: (h) => (h.to ? `restored it ${h.to}` : 'restored it'),
  subtask_added: (h) => `added the sub-task ${h.to}`,
  check_to_subtask: (h) => `made the step "${h.from}" into the sub-task ${h.to}`,
  file_added: (h) => `added the file "${h.to}"`,
  file_removed: (h) => `removed the file "${h.from}"`,
};

/** Kept here too: older imports read it from this file. */
export { timeAgo };

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
      ? <div className={`${className} whitespace-pre-wrap break-words`}>{multiline ? <Linkified text={value} /> : value}</div>
      : null;
  }
  // Long text with links: the links open, a click anywhere else (or the pencil) edits.
  if (draft === null && multiline && value) {
    return (
      <div onClick={() => setDraft(value)} className={`${className} group cursor-text rounded-md hover:bg-gray-50`}>
        <span className="whitespace-pre-wrap break-words"><Linkified text={value} /></span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setDraft(value); }}
          aria-label={`Edit ${label}`}
          title="Edit"
          className="ml-1 inline-flex rounded p-0.5 align-middle text-gray-300 opacity-0 hover:bg-gray-100 hover:text-gray-600 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Pencil aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
    );
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

/**
 * One detail: an icon and a label, then its value. In a wide window two sit
 * side by side (`wide` takes the whole row); in a narrow one, one per row.
 */
function Field({ label, icon: Icon, wide = false, children }: { label: string; icon: LucideIcon; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`flex min-h-9 min-w-0 items-center gap-3 ${wide ? '@xl:col-span-2' : ''}`}>
      <dt className="flex w-[104px] shrink-0 items-center gap-2 text-[13px] text-gray-500">
        <Icon aria-hidden className="h-4 w-4 shrink-0 text-gray-400" />{label}
      </dt>
      <dd className="min-w-0 flex-1 text-sm text-gray-900">{children}</dd>
    </div>
  );
}

/**
 * A day shown as "6 Nov" (or a soft "Empty") until clicked, which opens the
 * browser's date picker. The real date input is there, invisible, on top — so
 * it stays labelled and works with the keyboard.
 */
function DateField({ value, label, min, max, onChange, extra }: {
  value: string | null; label: string; min?: string; max?: string; onChange: (v: string) => void; extra?: ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="relative inline-flex rounded-md px-1.5 py-1 hover:bg-gray-50 focus-within:ring-2 focus-within:ring-blue-100">
        <span className={value ? 'text-gray-900' : 'text-gray-400'}>{value ? formatDueDay(value) : 'Empty'}</span>
        <input
          ref={ref}
          type="date"
          value={value || ''}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value)}
          onClick={() => { try { ref.current?.showPicker?.(); } catch { /* a browser without it opens on its own */ } }}
          aria-label={label}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </span>
      {extra}
    </span>
  );
}

const quietSelect = quietControl;

/** "Arun, Sam" — and past two people "Arun, Sam +3", so a long team never spills into the next field. */
const firstNames = (people: Person[]) => {
  const names = people.map((p) => p.name.split(' ')[0] || p.name);
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
};
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Faces and first names: "(A)(S) Arun, Sam". */
function PeopleLine({ people, empty }: { people: Person[]; empty: string }) {
  if (!people.length) return <span className="text-gray-400">{empty}</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <AvatarStack people={people} max={5} size="sm" />
      <span className="min-w-0 truncate" title={people.map((p) => p.name).join(', ')}>{firstNames(people)}</span>
    </span>
  );
}

/**
 * Who does it. Whoever gave it, a head or the admin opens the picker, ticks and
 * unticks, and it saves once when the picker closes — never leaving nobody.
 */
function AssigneesField({ task, choices, saving, onSave }: {
  task: Task; choices: Assignee[]; saving: boolean; onSave: (ids: string[]) => void;
}) {
  const now = peopleOf(task);
  const ids = now.map((p) => p.id);
  const [draft, setDraft] = useState<string[] | null>(null);
  if (!task.can.reassign || !choices.length) return <PeopleLine people={now} empty="Nobody" />;
  const shown = draft ?? ids;
  const done = () => {
    const next = draft;
    setDraft(null);
    if (!next || sameSet(next, ids)) return;
    if (!next.length) { toast.error('Keep at least one person on the task.'); return; }
    onSave(next);
  };
  const byId = new Map([...now.map((p) => [p.id, p] as const), ...choices.map((p) => [p.id, p] as const)]);
  return (
    <AssigneePicker
      people={choices}
      selected={shown}
      onChange={setDraft}
      onDone={done}
      max={MAX_ASSIGNEES}
      label="Assignees"
      triggerLabel="Who does it"
      disabled={saving}
      trigger={(
        <span className="inline-flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 hover:bg-gray-50">
          <PeopleLine people={shown.map((id) => byId.get(id)).filter((p): p is Person => !!p)} empty="Nobody yet" />
          <UserPlus aria-hidden className="h-3.5 w-3.5 text-gray-400" />
        </span>
      )}
    />
  );
}

/**
 * Who follows it: they see it and hear about it, but do not do it. Anyone who
 * sees the task may follow it; whoever gave it, a head or the admin may choose
 * for others (saved once, when the picker closes).
 */
function FollowersField({ task, choices, onGone }: { task: Task; choices: Assignee[]; onGone?: () => void }) {
  const follow = useFollowers(task.id, { onGone });
  const [draft, setDraft] = useState<string[] | null>(null);
  const me = choices.find((p) => p.me);
  const doing = peopleOf(task).map((p) => p.id);
  const ids = task.followers.map((p) => p.id);
  const done = () => {
    const next = draft;
    setDraft(null);
    if (!next || sameSet(next, ids)) return;
    follow.mutate({ add: next.filter((x) => !ids.includes(x)), remove: ids.filter((x) => !next.includes(x)) });
  };
  const toggleMe = () => {
    if (!me) return;
    if (task.following) {
      // Following is all that lets some people see a task: say so before they lose it.
      const onlyFollowing = !task.can.edit && !doing.includes(me.id) && task.createdBy.id !== me.id;
      if (onlyFollowing && !window.confirm('Stop following? You will no longer see this task.')) return;
      follow.mutate({ remove: [me.id] });
    } else follow.mutate({ add: [me.id] });
  };
  const byId = new Map([...task.followers.map((p) => [p.id, p] as const), ...choices.map((p) => [p.id, p] as const)]);
  const shown = (draft ?? ids).map((id) => byId.get(id)).filter((p): p is Person => !!p);
  return (
    <span className="flex flex-wrap items-center gap-2">
      {task.can.followers && choices.length ? (
        <AssigneePicker
          people={choices.filter((p) => !doing.includes(p.id))}
          selected={draft ?? ids}
          onChange={setDraft}
          onDone={done}
          max={FOLLOWERS_MAX}
          label="Followers"
          triggerLabel="Choose followers"
          disabled={follow.isPending}
          trigger={(
            <span className="inline-flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 hover:bg-gray-50">
              <PeopleLine people={shown} empty="Nobody" />
              <UserPlus aria-hidden className="h-3.5 w-3.5 text-gray-400" />
            </span>
          )}
        />
      ) : <PeopleLine people={task.followers} empty="Nobody" />}
      {task.can.follow && me && !doing.includes(me.id) && (task.following || !task.archivedAt) && (
        <button
          type="button"
          onClick={toggleMe}
          disabled={follow.isPending}
          aria-pressed={task.following}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {task.following ? <><BellOff aria-hidden className="h-3.5 w-3.5" /> Unfollow</> : <><Bell aria-hidden className="h-3.5 w-3.5" /> Follow</>}
        </button>
      )}
    </span>
  );
}

// ── Checklist ────────────────────────────────────────────────────────────────

/**
 * The task's steps. The doer ticks them; whoever gave the task (or the team head,
 * or the admin) adds, renames and removes them. Every change comes back as the
 * whole task, which replaces the page's copy.
 */
function Checklist({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  // One clientId per step being made a sub-task, so a retry makes it once.
  const toSubKeys = useRef(new Map<string, string>());
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
  const toSubtask = useMutation({
    mutationFn: (id: string) => {
      const keys = toSubKeys.current;
      if (!keys.has(id)) keys.set(id, newClientId());
      return apiClient.post<{ task: Task; subtask: Task }>(`${url}/${encodeURIComponent(id)}/subtask`, { clientId: keys.get(id) });
    },
    onSuccess: (res, id) => {
      settle(res);
      toSubKeys.current.delete(id);
      queryClient.invalidateQueries({ queryKey: taskKeys.subtasks(task.id) });
      toast.success(`Made ${res.subtask.code}`, { id: `to-sub-${id}` });
    },
    onError: fail('Could not make it a sub-task.'),
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
                    {task.can.subtask && !c.done && (
                      <button
                        onClick={() => toSubtask.mutate(c.id)}
                        disabled={toSubtask.isPending}
                        aria-label={`Make ${c.text} a sub-task`}
                        title="Make it a sub-task"
                        className="rounded p-1 text-gray-500 hover:bg-gray-100"
                      ><Network className="h-3.5 w-3.5" /></button>
                    )}
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

// ── The task ─────────────────────────────────────────────────────────────────

/** Moving through the list the window was opened from: "3 of 14", previous and next. */
export type TaskNav = { at: number; of: string; prev?: () => void; next?: () => void };

/**
 * One task: title and notes (click to edit), its properties, sub-tasks,
 * checklist, the people sharing it, and the activity. `onClose` = shown in the
 * task window (details left, activity right on a wide screen); without it, as
 * a page of its own (opened from a pop-up or the bell). `onOpen` switches the
 * window to another task (a parent or sub-task); without it, those are links.
 */
export default function TaskDetail({ id, base, onClose, onOpen, nav }: {
  id: string; base: string; onClose?: () => void; onOpen?: (id: string) => void; nav?: TaskNav;
}) {
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
      queryClient.invalidateQueries({ queryKey: taskKeys.spaces() });
      // Archiving takes the sub-tasks along; a sub-task's change moves its parent's count.
      queryClient.invalidateQueries({ queryKey: taskKeys.subtasks(id) });
      if (res.task.parent) {
        queryClient.invalidateQueries({ queryKey: taskKeys.one(res.task.parent.id) });
        queryClient.invalidateQueries({ queryKey: taskKeys.subtasks(res.task.parent.id) });
      }
      toast.success('Saved', { id: `task-saved-${id}`, duration: 1500 });
    },
    onError: (e) => {
      setError(errorMessage(e, 'Could not save the change.'));
      // Someone else changed it first: load what it is now, keep the message up.
      if (isConflict(e)) queryClient.invalidateQueries({ queryKey: taskKeys.one(id) });
    },
  });

  const windowed = !!onClose;
  const back = onClose
    ? null
    : <Link href={base} className="inline-flex items-center gap-1 text-sm font-medium text-blue-700"><ArrowLeft className="h-4 w-4" /> All tasks</Link>;
  const iconButton = 'rounded-md p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent';
  const closeButton = onClose && <button onClick={onClose} aria-label="Close" title="Close (Esc)" className={iconButton}><X className="h-4 w-4" /></button>;

  if (q.isLoading) {
    return (
      <div aria-hidden className={`animate-pulse space-y-4 ${windowed ? 'p-6' : 'p-1'}`}>
        <div className="h-3 w-24 rounded bg-gray-200" />
        <div className="h-6 w-3/4 rounded bg-gray-200" />
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-4 w-1/2 rounded bg-gray-100" />)}
      </div>
    );
  }
  if (!task) {
    return (
      <div className={`space-y-3 ${windowed ? 'p-5' : ''}`}>
        {back}
        {closeButton && <div className="flex justify-end">{closeButton}</div>}
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
  const setStatus = (status: TaskStatus) => {
    if (status === 'done' && !confirmComplete(task)) return;
    save.mutate({ status });
  };
  // The parent, as a way back up: in the window it switches to it; on a page it is a link.
  const parentLink = task.parent && (onOpen
    ? <button type="button" onClick={() => onOpen(task.parent!.id)} className="inline-flex min-w-0 items-center gap-1 hover:text-gray-900 hover:underline"><CornerLeftUp aria-hidden className="h-3.5 w-3.5 shrink-0" /><span className="font-mono">{task.parent.code}</span><span className="truncate">{task.parent.title}</span></button>
    : <Link href={`${base}/${task.parent.id}`} className="inline-flex min-w-0 items-center gap-1 hover:text-gray-900 hover:underline"><CornerLeftUp aria-hidden className="h-3.5 w-3.5 shrink-0" /><span className="font-mono">{task.parent.code}</span><span className="truncate">{task.parent.title}</span></Link>);
  const setDue = (value: string) => {
    if (value && isPastDue(value, task.dueTime) && !window.confirm('This date has already passed, so the task will show as late. Use it anyway?')) return;
    save.mutate({ dueOn: value || null });
  };
  const setDueTime = (value: string | null) => {
    if (value && task.dueOn && isPastDue(task.dueOn, value) && !window.confirm('This time has already passed, so the task will show as late. Use it anyway?')) return;
    save.mutate({ dueTime: value });
  };

  // Details first; the activity beside them in the window on a wide screen, below them otherwise.
  const details = (
    <>
      <header className="space-y-2">
        {archived && (
          <div className="flex items-center justify-between rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700">
            <span className="flex items-center gap-2"><Trash2 aria-hidden className="h-4 w-4 text-gray-500" /> This task is in Trash.</span>
            {task.can.restore && (
              <button onClick={() => save.mutate({ archived: false })} className="inline-flex items-center gap-1 font-medium text-blue-700"><RotateCcw className="h-4 w-4" /> Restore</button>
            )}
          </div>
        )}
        {parentLink && <div className="flex min-w-0 text-xs text-gray-500">{parentLink}</div>}
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

      <div className="@container">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-0.5 border-y border-gray-100 py-3 @xl:grid-cols-2">
          <Field label="Status" icon={CircleDot}>
            {task.can.status ? (
              <select
                value={task.status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                disabled={save.isPending}
                aria-label="Status"
                className={statusSelectClass(task.status)}
              >
                {TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            ) : <StatusPill status={task.status} />}
          </Field>
          <Field label="Timer" icon={TimerIcon}>
            <TimerButton task={task} />
          </Field>
          <Field label="Assignees" icon={UserRound}>
            <AssigneesField task={task} choices={reassignTo} saving={save.isPending} onSave={(assigneeIds) => save.mutate({ assigneeIds })} />
          </Field>
          <Field label="Due date" icon={CalendarDays}>
            {task.can.edit ? (
              <DateField
                value={task.dueOn}
                label="Due date"
                min={task.startOn || undefined}
                onChange={setDue}
                extra={(
                  <>
                    {task.dueOn && (
                      <span className="inline-flex items-center gap-1 text-gray-500">
                        <Clock aria-hidden className="h-3.5 w-3.5 text-gray-400" />
                        <DueTimeSelect value={task.dueTime} onChange={setDueTime} disabled={save.isPending} className={quietSelect} />
                      </span>
                    )}
                    {(task.overdue || task.dueToday) && <DuePill t={task} />}
                  </>
                )}
              />
            ) : <DuePill t={task} empty={<span className="text-gray-400">Empty</span>} />}
          </Field>
          <Field label="Start date" icon={CalendarRange}>
            {task.can.edit ? (
              <DateField value={task.startOn} label="Start date" max={task.dueOn || undefined} onChange={(v) => save.mutate({ startOn: v || null })} />
            ) : task.startOn ? <span>{formatDueDay(task.startOn)}</span> : <span className="text-gray-400">Empty</span>}
          </Field>
          <Field label="Priority" icon={Flag}>
            {task.can.edit ? (
              <span className="flex items-center gap-1">
                <PriorityFlag priority={task.priority} />
                <select value={task.priority} onChange={(e) => save.mutate({ priority: e.target.value as TaskPriority })} aria-label="Priority" className={quietSelect}>
                  {TASK_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </span>
            ) : <PriorityFlag priority={task.priority} withLabel />}
          </Field>
          <Field label="Followers" icon={Eye}>
            <FollowersField task={task} choices={reassignTo} onGone={onClose} />
          </Field>
          <Field label="Tags" icon={Tag} wide>
            {task.can.edit
              ? <TagInput value={task.tags} onChange={(tags) => save.mutate({ tags })} disabled={save.isPending} quiet />
              : task.tags.length ? <TagList tags={task.tags} max={10} /> : <span className="text-gray-400">Empty</span>}
          </Field>
          <Field label="Order" icon={Package}>
            {task.can.edit && task.order ? (
              <span className="flex items-center gap-1">
                <Link href={orderHrefFor(base, task.order.id)} className="font-medium text-blue-700 hover:underline">{task.order.code}</Link>
                <button onClick={() => save.mutate({ orderId: null })} aria-label="Unlink the order" title="Unlink" className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X className="h-3.5 w-3.5" /></button>
              </span>
            ) : task.can.edit ? (
              <OrderPicker value={null} onChange={(o) => { if (o) save.mutate({ orderId: o.id }); }} quiet />
            ) : task.order
              ? <Link href={orderHrefFor(base, task.order.id)} className="font-medium text-blue-700 hover:underline">{task.order.code}</Link>
              : <span className="text-gray-400">Empty</span>}
          </Field>
          {task.team && (
            <Field label="List" icon={ListTree}>
              <ListPicker
                team={task.team}
                value={task.list}
                disabled={!task.can.edit || save.isPending}
                onChange={(listId) => save.mutate({ listId })}
              />
            </Field>
          )}
          <Field label="Given by" icon={UserPlus}>
            <span className="flex min-w-0 items-center gap-2 text-gray-700">
              <Avatar name={task.createdBy.name} id={task.createdBy.id} size="xs" />
              <span className="truncate">{task.createdBy.name}</span>
              <span className="shrink-0 text-xs text-gray-400" title={formatDateTimeIST(task.createdAt)}>· {formatDueDay(formatIsoDateIST(task.createdAt))}</span>
            </span>
          </Field>
        </dl>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <section>
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-900"><AlignLeft aria-hidden className="h-4 w-4 text-gray-500" /> Description</h3>
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

      <Subtasks task={task} base={base} onOpen={onOpen} />
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
                    {c.bucket === 'archived' ? <span className="text-xs text-gray-500">In Trash</span> : <StatusPill status={c.status} />}
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

      <TimePanel task={task} />
      <TaskFiles task={task} />
    </>
  );
  const activity = <Activity task={task} describe={(h) => (HISTORY_TEXT[h.action] ?? (() => h.action))(h)} />;
  const tools = (
    <>
      <button onClick={copyLink} aria-label="Copy link" title="Copy link" className={iconButton}><Link2 className="h-4 w-4" /></button>
      <TaskMenu t={task} base={base} onOpen={onOpen} size="md" className="text-gray-600" />
    </>
  );

  if (windowed) {
    return (
      <article className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-1 border-b border-gray-100 px-3 py-2 text-xs text-gray-500 sm:px-5">
          <span className="font-mono">{task.code}</span><span aria-hidden>·</span><span className="truncate">{task.teamLabel}</span>
          <span className="flex-1" />
          {nav && (
            <span className="mr-1 flex items-center gap-0.5 border-r border-gray-100 pr-2">
              <button onClick={nav.prev} disabled={!nav.prev} aria-label="Previous task" title="Previous task (K)" className={iconButton}><ChevronUp className="h-4 w-4" /></button>
              <button onClick={nav.next} disabled={!nav.next} aria-label="Next task" title="Next task (J)" className={iconButton}><ChevronDown className="h-4 w-4" /></button>
              <span className="hidden whitespace-nowrap px-1 sm:inline">{nav.at} of {nav.of}</span>
            </span>
          )}
          {tools}
          <Link href={`${base}/${task.id}`} aria-label="Open as a full page" title="Open as a full page" className={iconButton}><Maximize2 className="h-4 w-4" /></Link>
          {closeButton}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,40%)] lg:overflow-hidden">
          <div className="space-y-6 px-5 py-5 sm:px-7 lg:overflow-y-auto">{details}</div>
          <aside aria-label="Activity" className="border-t border-gray-100 bg-gray-50 px-5 py-5 sm:px-6 lg:overflow-y-auto lg:border-l lg:border-t-0">{activity}</aside>
        </div>
      </article>
    );
  }

  return (
    <article className="space-y-6">
      {back}
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <span className="font-mono">{task.code}</span><span aria-hidden>·</span><span>{task.teamLabel}</span>
        <span className="flex-1" />
        {tools}
      </div>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,40%)] lg:items-start lg:gap-8">
        <div className="space-y-6">{details}</div>
        <aside aria-label="Activity" className="mt-6 lg:mt-0">{activity}</aside>
      </div>
    </article>
  );
}

