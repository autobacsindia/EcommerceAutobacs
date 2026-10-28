'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import { TASK_PRIORITIES, isPastDay, newClientId, personLabel, type Assignee, type Task, type TaskPriority } from './types';

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
export function OrderPicker({ value, onChange }: { value: PickedOrder | null; onChange: (o: PickedOrder | null) => void }) {
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
        placeholder="Link an order — type its number or the customer's name (optional)"
        aria-label="Link an order"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
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
 * Tick everyone who should do it — each person gets their own copy. The API
 * lists you first, then team heads, then everyone else; a search box appears
 * once the list is long.
 */
export function PeoplePicker({ people, selected, onChange }: {
  people: Assignee[]; selected: string[]; onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const shown = term ? people.filter((p) => personLabel(p).toLowerCase().includes(term)) : people;
  const toggle = (id: string) => onChange(
    // Keep the list's own order (heads first), whatever order people were ticked in.
    people.map((p) => p.id).filter((pid) => (pid === id ? !selected.includes(id) : selected.includes(pid))),
  );
  const n = selected.length;
  return (
    <fieldset className="rounded-lg border border-gray-300 p-2">
      <legend className="px-1 text-xs font-medium text-gray-600">Who does it — tick one or more people</legend>
      {people.length > 8 && (
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or team"
          aria-label="Search people"
          className="mb-2 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
        />
      )}
      <ul className="max-h-56 space-y-0.5 overflow-auto">
        {shown.map((p) => (
          <li key={p.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50">
              <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4" />
              <span className={p.isHead ? 'font-medium text-gray-900' : 'text-gray-800'}>{personLabel(p)}</span>
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="px-2 py-1 text-sm text-gray-500">Nobody matches.</li>}
      </ul>
      <p className={`mt-1 px-1 text-xs ${n === 0 ? 'text-red-600' : 'text-gray-500'}`}>
        {n === 0 ? 'Pick at least one person.'
          : n === 1 ? '1 person picked.'
            : `${n} people picked — each gets their own copy and marks it done separately.`}
      </p>
    </fieldset>
  );
}

/** New task. Admin: anyone; team head: their team; member: themselves. */
export default function TaskForm({ onDone, onCancel }: { onDone: (task: Task) => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const people = useAssignees();
  const choices = people.data?.people ?? [];
  const me = choices.find((p) => p.me);
  // One id for this form: pressing Create twice (or a retried request) makes one task.
  const clientId = useRef(newClientId());
  const [form, setForm] = useState({ title: '', description: '', steps: '', priority: 'normal' as TaskPriority, dueOn: '' });
  // null until the person touches the list: it then starts with just "me" ticked.
  const [picked, setPicked] = useState<string[] | null>(null);
  const chosen = picked ?? (me ? [me.id] : []);
  const [order, setOrder] = useState<PickedOrder | null>(null);
  const [error, setError] = useState('');
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const create = useMutation({
    mutationFn: () => apiClient.post<{ task: Task; tasks: Task[] }>('/staff/tasks', {
      title: form.title.trim(),
      description: form.description.trim(),
      assigneeIds: chosen,
      checklist: form.steps.split('\n').map((l) => l.trim()).filter(Boolean),
      priority: form.priority,
      dueOn: form.dueOn || null,
      orderId: order?.id || null,
      clientId: clientId.current,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      onDone(res.task);
    },
    onError: (e) => setError(errorMessage(e, 'Could not create the task.')),
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); setError(''); if (form.title.trim() && chosen.length) create.mutate(); }}
      className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">New task</h2>
        <button type="button" onClick={onCancel} aria-label="Close" className="rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
      </div>
      <input
        value={form.title}
        onChange={(e) => set({ title: e.target.value })}
        maxLength={200}
        required
        autoFocus
        placeholder="What needs doing? e.g. Call Bosch about order #51234"
        aria-label="Title"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <textarea
        value={form.description}
        onChange={(e) => set({ description: e.target.value })}
        maxLength={4000}
        rows={3}
        placeholder="More details (optional)"
        aria-label="Notes"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <label className="block text-xs font-medium text-gray-600">
        Checklist (optional) — one step per line
        <textarea
          value={form.steps}
          onChange={(e) => set({ steps: e.target.value })}
          rows={2}
          placeholder={'e.g.\nPack the parcel\nBook the courier'}
          aria-label="Checklist steps"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal"
        />
      </label>
      {choices.length > 1 && <PeoplePicker people={choices} selected={chosen} onChange={setPicked} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-gray-600">
          Priority
          <select value={form.priority} onChange={(e) => set({ priority: e.target.value as TaskPriority })} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm">
            {TASK_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">
          Due date
          <input type="date" value={form.dueOn} onChange={(e) => set({ dueOn: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
      </div>
      <PastDueWarning dueOn={form.dueOn} />
      <OrderPicker value={order} onChange={setOrder} />
      {choices.length === 1 && (
        <p className="text-xs text-gray-500">This task is for you. Team heads and the admin give tasks to others.</p>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">Cancel</button>
        <button
          type="submit"
          disabled={create.isPending || !form.title.trim() || chosen.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {chosen.length > 1 ? `Create ${chosen.length} tasks` : 'Create task'}
        </button>
      </div>
    </form>
  );
}
