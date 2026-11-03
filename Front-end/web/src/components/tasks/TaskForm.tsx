'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CalendarDays, CalendarRange, Flag, ListChecks, Loader2, Tag, UserPlus, Users, X } from 'lucide-react';
import TagInput from './TagInput';
import AssigneePicker from './AssigneePicker';
import { AvatarStack } from './ui';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import { MAX_ASSIGNEES, TASK_PRIORITIES, isPastDay, newClientId, type Assignee, type Task, type TaskPriority } from './types';

/** Shown under a due date that has already passed. */
export function PastDueWarning({ dueOn }: { dueOn: string }) {
  if (!isPastDay(dueOn)) return null;
  return (
    <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
      This due date has already passed, so the task will show as <strong>late</strong> straight away. Pick a later date if that is not what you meant.
    </p>
  );
}

type PickedOrder = { id: string; code: string };
type OrderOption = { id: string; code: string; customer: string };

/** Pick a recent paid order by number or customer name (the same picker team chat uses). */
/** `quiet`: plain text until hovered or typed in, with a short prompt — for the task window. */
export function OrderPicker({ value, onChange, quiet = false }: { value: PickedOrder | null; onChange: (o: PickedOrder | null) => void; quiet?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const term = q.trim();
  const orders = useQuery({
    queryKey: ['chat', 'orders', 'recent', term.toLowerCase()],
    queryFn: () => apiClient.get<{ orders: OrderOption[] }>(`/chat/orders/recent?q=${encodeURIComponent(term)}`),
    enabled: open,
    staleTime: 30_000,
  });

  if (value) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-800">
        Order {value.code}
        <button type="button" onClick={() => onChange(null)} aria-label="Remove order" className="rounded-full p-0.5 hover:bg-blue-100">
          <X className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }
  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={quiet ? 'Empty' : "Link an order — type its number or the customer's name (optional)"}
        aria-label="Link an order"
        className={quiet
          ? 'w-full rounded-md border border-transparent! bg-transparent! px-1.5 py-1 text-sm placeholder:text-gray-400 hover:border-gray-200! hover:bg-gray-50! focus:border-blue-500! focus:bg-white!'
          : 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm'}
      />
      {open && (orders.data?.orders?.length ?? 0) > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {orders.data!.orders.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange({ id: o.id, code: o.code }); setQ(''); setOpen(false); }}
                className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50"
              >
                <span className="font-medium">{o.code}</span>
                <span className="truncate text-gray-500">{o.customer}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The people the signed-in person may give a task to (the API decides). */
export function useAssignees() {
  return useQuery({
    queryKey: taskKeys.assignees(),
    queryFn: () => apiClient.get<{ people: Assignee[] }>('/staff/tasks/assignees'),
    staleTime: 5 * 60_000,
  });
}

/**
 * Who does it: the people picker behind a button, and — once several are picked —
 * one shared task (the default: one status, one conversation) or a copy each.
 */
export function PeopleField({ people, selected, onChange, copies, onCopies }: {
  people: Assignee[]; selected: string[]; onChange: (ids: string[]) => void; copies: boolean; onCopies: (copies: boolean) => void;
}) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const chosen = selected.map((id) => byId.get(id)).filter((p): p is Assignee => !!p);
  const n = selected.length;
  const choice = (value: boolean, title: string, hint: string) => (
    <label className={`flex flex-1 cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 ${copies === value ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
      <input type="radio" name="task-copies" checked={copies === value} onChange={() => onCopies(value)} className="mt-0.5 h-4 w-4" />
      <span>
        <span className="block text-sm font-medium text-gray-900">{title}</span>
        <span className="block text-xs font-normal text-gray-500">{hint}</span>
      </span>
    </label>
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-xs font-medium text-gray-500"><Users aria-hidden className="h-3.5 w-3.5" /> Assignees</span>
        <AssigneePicker
          people={people}
          selected={selected}
          onChange={onChange}
          max={MAX_ASSIGNEES}
          label="Assignees"
          triggerLabel="Who does it"
          trigger={n ? (
            <span className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-800 hover:border-gray-300">
              <AvatarStack people={chosen} max={4} size="sm" />
              <span className="max-w-[14rem] truncate">{chosen.map((p) => (p.me ? 'Me' : p.name.split(' ')[0])).join(', ')}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 px-2 py-1 text-sm text-gray-500 hover:border-gray-400">
              <UserPlus aria-hidden className="h-4 w-4" /> Add assignee
            </span>
          )}
        />
      </div>
      {n === 0 && <p className="text-xs text-red-600">Pick at least one person.</p>}
      {n > 1 && (
        <fieldset className="flex flex-col gap-2 sm:flex-row">
          <legend className="sr-only">One task or a copy each</legend>
          {choice(false, 'One shared task', 'One status and one conversation for everyone.')}
          {choice(true, 'Own copy each', `${n} tasks — each person marks their own done.`)}
        </fieldset>
      )}
    </div>
  );
}

/** New task, for anyone in the panel (yourself included). */
export default function TaskForm({ onDone, onCancel }: { onDone: (task: Task) => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const people = useAssignees();
  const choices = people.data?.people ?? [];
  const me = choices.find((p) => p.me);
  // One id for this form: pressing Create twice (or a retried request) makes one task.
  const clientId = useRef(newClientId());
  const [form, setForm] = useState({ title: '', description: '', steps: '', priority: 'normal' as TaskPriority, dueOn: '', startOn: '', tags: [] as string[] });
  // null until the person touches the list: it then starts with just "me" ticked.
  const [picked, setPicked] = useState<string[] | null>(null);
  const chosen = picked ?? (me ? [me.id] : []);
  // Several people share one task unless the giver asks for a copy each.
  const [copies, setCopies] = useState(false);
  const many = copies && chosen.length > 1;
  const [order, setOrder] = useState<PickedOrder | null>(null);
  const [error, setError] = useState('');
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const datesBackwards = !!form.startOn && !!form.dueOn && form.startOn > form.dueOn;

  const create = useMutation({
    mutationFn: () => apiClient.post<{ task: Task; tasks: Task[] }>('/staff/tasks', {
      title: form.title.trim(),
      description: form.description.trim(),
      assigneeIds: chosen,
      shared: !copies,
      checklist: form.steps.split('\n').map((l) => l.trim()).filter(Boolean),
      priority: form.priority,
      dueOn: form.dueOn || null,
      startOn: form.startOn || null,
      tags: form.tags,
      orderId: order?.id || null,
      clientId: clientId.current,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      const n = res.tasks?.length ?? 1;
      toast.success(n > 1 ? `${n} tasks created` : 'Task created');
      onDone(res.task);
    },
    onError: (e) => setError(errorMessage(e, 'Could not create the task.')),
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); setError(''); if (form.title.trim() && chosen.length && !datesBackwards) create.mutate(); }}
      className="flex max-h-[85vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-gray-900">New task</h2>
        <button type="button" onClick={onCancel} aria-label="Close" className="rounded-md p-1 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <input
          value={form.title}
          onChange={(e) => set({ title: e.target.value })}
          maxLength={200}
          required
          autoFocus
          placeholder="What needs doing? e.g. Call Bosch about order #51234"
          aria-label="Title"
          className="w-full border-0 bg-transparent p-0 text-lg font-semibold text-gray-900 outline-none placeholder:font-normal placeholder:text-gray-400"
        />
        <textarea
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
          maxLength={4000}
          rows={3}
          placeholder="Add a description (optional)"
          aria-label="Notes"
          className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-medium text-gray-500">
            <span className="mb-1 flex items-center gap-1"><Flag aria-hidden className="h-3.5 w-3.5" /> Priority</span>
            <select value={form.priority} onChange={(e) => set({ priority: e.target.value as TaskPriority })} className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm">
              {TASK_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-gray-500">
            <span className="mb-1 flex items-center gap-1"><CalendarDays aria-hidden className="h-3.5 w-3.5" /> Due date</span>
            <input type="date" aria-label="Due date" value={form.dueOn} min={form.startOn || undefined} onChange={(e) => set({ dueOn: e.target.value })} className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-gray-500">
            <span className="mb-1 flex items-center gap-1"><CalendarRange aria-hidden className="h-3.5 w-3.5" /> Start date</span>
            <input type="date" aria-label="Start date" value={form.startOn} max={form.dueOn || undefined} onChange={(e) => set({ startOn: e.target.value })} className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
          </label>
        </div>
        <PastDueWarning dueOn={form.dueOn} />
        {datesBackwards && <p role="alert" className="text-xs font-medium text-red-700">The start date is after the due date.</p>}
        <label className="block text-xs font-medium text-gray-500">
          <span className="mb-1 flex items-center gap-1"><Tag aria-hidden className="h-3.5 w-3.5" /> Tags (optional)</span>
          <TagInput value={form.tags} onChange={(tags) => set({ tags })} />
        </label>
        {choices.length > 1 && <PeopleField people={choices} selected={chosen} onChange={setPicked} copies={copies} onCopies={setCopies} />}
        {choices.length === 1 && (
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">This task is for you.</p>
        )}
        <label className="block text-xs font-medium text-gray-500">
          <span className="mb-1 flex items-center gap-1"><ListChecks aria-hidden className="h-3.5 w-3.5" /> Checklist (optional) — one step per line</span>
          <textarea
            value={form.steps}
            onChange={(e) => set({ steps: e.target.value })}
            rows={2}
            placeholder={'Pack the parcel\nBook the courier'}
            aria-label="Checklist steps"
            className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal"
          />
        </label>
        <OrderPicker value={order} onChange={setOrder} />
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
        <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
        <button
          type="submit"
          disabled={create.isPending || !form.title.trim() || chosen.length === 0 || datesBackwards}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {many ? `Create ${chosen.length} tasks` : 'Create task'}
        </button>
      </div>
    </form>
  );
}
