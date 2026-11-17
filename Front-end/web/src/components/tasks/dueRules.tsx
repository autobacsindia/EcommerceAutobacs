'use client';

/**
 * Due-date rules in the panel (the server's are in Back-end/server/services/taskDueRules.js):
 *
 *   1. every task needs a due date
 *   2. more than `approvalAfterDays` (9) days away → a manager approves it
 *   3. each priority has a latest date (High: today or tomorrow …)
 *
 * The server decides; these only warn while the date is being picked, so nobody
 * presses Save to find out. The numbers come from the server, so an admin change
 * shows here without a new release.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CalendarCheck, CalendarClock, CalendarX2, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import { formatDueDay, TASK_PRIORITIES, todayIST, type Assignee, type Task, type TaskPriority, type TaskRules } from './types';
import { useRefreshTasks } from './hooks';

/** What the server ships with, used until the real numbers arrive. */
export const DEFAULT_TASK_RULES: TaskRules = { approvalAfterDays: 9, maxDays: { urgent: 0, high: 1, normal: 30, low: 60 } };

export function useTaskRules() {
  return useQuery({
    queryKey: taskKeys.rules(),
    queryFn: async () => (await apiClient.get<{ rules: TaskRules }>('/staff/tasks/rules')).rules,
    staleTime: 5 * 60_000,
  });
}

const DAY_MS = 86_400_000;
const utcOf = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d); };
/** Whole calendar days from `today` to `dueOn`. */
export const daysAhead = (dueOn: string, today: string = todayIST()) => Math.round((utcOf(dueOn) - utcOf(today)) / DAY_MS);
export const addDays = (ymd: string, n: number) => new Date(utcOf(ymd) + n * DAY_MS).toISOString().slice(0, 10);

/** "due today", "due today or tomorrow", "due within 30 days". */
export const limitText = (max: number) => (max === 0 ? 'due today' : max === 1 ? 'due today or tomorrow' : `due within ${max} days`);
const labelOf = (p: TaskPriority) => TASK_PRIORITIES.find((x) => x.value === p)?.label ?? p;

/**
 * What the rules say about a date and priority: `tooLate` (the server will
 * refuse it, with this reason) or `needsApproval`. An empty date says nothing.
 */
export function dueCheck(dueOn: string | null | undefined, priority: TaskPriority, rules: TaskRules = DEFAULT_TASK_RULES, today: string = todayIST()) {
  if (!dueOn) return { tooLate: null as string | null, needsApproval: false, latest: addDays(today, rules.maxDays[priority]) };
  const days = daysAhead(dueOn, today);
  const max = rules.maxDays[priority];
  const latest = addDays(today, max);
  if (days > max) return { tooLate: `${labelOf(priority)} tasks must be ${limitText(max)} (by ${formatDueDay(latest)}). Pick an earlier date or a lower priority.`, needsApproval: false, latest };
  return { tooLate: null, needsApproval: days > rules.approvalAfterDays, latest };
}

/**
 * Does `me` set this date as its manager, so it needs nobody else's approval?
 * The admin; or a head giving it only to people of their own team (not just to
 * themselves). The same rule as the server's managesDue.
 */
export function managesDue(me: Assignee | undefined, people: (Assignee | undefined)[]) {
  if (!me) return false;
  if (me.teamLabel === 'Admin' && !me.team) return true;
  if (!me.isHead || !me.team || !people.length) return false;
  return people.every((p) => !!p && p.team === me.team) && !people.every((p) => p?.id === me.id);
}

/**
 * Under a due date: why it can't be saved, or that it will wait for approval.
 * `manager`: the person picking it approves it themselves (the admin, or the head
 * giving it to their team), so say nothing about approval.
 */
export function DueRuleHint({ dueOn, priority, manager = false, personal = false }: {
  dueOn: string | null | undefined; priority: TaskPriority; manager?: boolean; personal?: boolean;
}) {
  const rules = useTaskRules().data ?? DEFAULT_TASK_RULES;
  const { tooLate, needsApproval } = dueCheck(dueOn, priority, rules);
  if (tooLate) return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{tooLate}</p>;
  if (needsApproval && !manager && !personal) {
    return (
      <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
        More than {rules.approvalAfterDays} days away, so your manager needs to approve this date. The task is saved now and shows as <strong>waiting for approval</strong> until they do.
      </p>
    );
  }
  return null;
}

/** A small mark on a task row: the date waits for approval, or was not approved. */
export function DueApprovalBadge({ task }: { task: Pick<Task, 'dueApproval'> }) {
  const a = task.dueApproval;
  if (!a || a.status === 'approved') return null;
  return a.status === 'pending' ? (
    <span title="The due date waits for a manager's approval" className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
      <CalendarClock aria-hidden className="h-3 w-3" /> Date needs approval
    </span>
  ) : (
    <span title={a.note ? `Not approved: ${a.note}` : 'The due date was not approved'} className="inline-flex items-center gap-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-800">
      <CalendarX2 aria-hidden className="h-3 w-3" /> Date not approved
    </span>
  );
}

/**
 * On the task page: where its due date stands, and — for a manager — Approve /
 * Not approve. A refusal needs a reason, so the person knows what date would do.
 */
export function DueApprovalPanel({ task }: { task: Task }) {
  const a = task.dueApproval;
  const rules = useTaskRules().data ?? DEFAULT_TASK_RULES;
  const refresh = useRefreshTasks();
  const queryClient = useQueryClient();
  const [refusing, setRefusing] = useState(false);
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      apiClient.post<{ task: Task }>(`/staff/tasks/${encodeURIComponent(task.id)}/due-approval`, { rev: task.rev, decision, ...(decision === 'reject' ? { note: note.trim() } : {}) }),
    onSuccess: (res) => {
      queryClient.setQueryData(taskKeys.one(task.id), { task: res.task });
      setRefusing(false);
      setNote('');
      toast.success(res.task.dueApproval?.status === 'approved' ? 'Due date approved' : 'Due date not approved — they have been told');
      return refresh();
    },
    onError: (e) => {
      toast.error(errorMessage(e, 'Could not save your decision.'));
      // Someone else decided (or changed the task) first: show what it is now.
      queryClient.invalidateQueries({ queryKey: taskKeys.one(task.id) });
    },
  });
  if (!a) return null;
  if (a.status === 'approved') {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        <CalendarCheck aria-hidden className="h-4 w-4 shrink-0" />
        {a.auto ? `Due date set by ${a.decidedBy?.name || 'a manager'}, so no approval was needed.` : `Due date approved by ${a.decidedBy?.name || 'a manager'}.`}
      </p>
    );
  }
  if (a.status === 'rejected') {
    return (
      <div role="status" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        <p className="flex items-center gap-2 font-semibold"><CalendarX2 aria-hidden className="h-4 w-4 shrink-0" /> {a.decidedBy?.name || 'The manager'} did not approve {formatDueDay(a.dueOn)}.</p>
        {a.note && <p className="mt-1">“{a.note}”</p>}
        <p className="mt-1">Pick a date within {rules.approvalAfterDays} days to clear this, or a new date to ask again.</p>
      </div>
    );
  }
  return (
    <div role="status" className="space-y-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <p className="flex items-center gap-2">
        <CalendarClock aria-hidden className="h-4 w-4 shrink-0" />
        <span><strong>Waiting for approval:</strong> {a.requestedBy.name || 'Someone'} asked for {formatDueDay(a.dueOn)}.</span>
      </p>
      {task.can.approveDue && !refusing && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={decide.isPending} onClick={() => decide.mutate('approve')} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            {decide.isPending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />} Approve date
          </button>
          <button type="button" disabled={decide.isPending} onClick={() => setRefusing(true)} className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50">
            Not approve
          </button>
        </div>
      )}
      {task.can.approveDue && refusing && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (note.trim()) decide.mutate('reject'); }}
          className="space-y-2"
        >
          <label className="block text-sm font-medium" htmlFor={`refuse-${task.id}`}>Why? Which date would do?</label>
          <input
            id={`refuse-${task.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            autoFocus
            placeholder="e.g. Finish by Friday"
            className="w-full rounded-md border border-amber-300 bg-white px-2 py-1.5 text-sm"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={!note.trim() || decide.isPending} className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">Send</button>
            <button type="button" onClick={() => { setRefusing(false); setNote(''); }} className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-amber-100">Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Admin only: change how far ahead tasks may be due. Affects the next date set, never saved tasks. */
export function TaskRulesEditor({ onDone }: { onDone?: () => void }) {
  const current = useTaskRules();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<TaskRules | null>(null);
  const rules = draft ?? current.data ?? DEFAULT_TASK_RULES;
  const save = useMutation({
    mutationFn: () => apiClient.put<{ rules: TaskRules }>('/staff/tasks/rules', { approvalAfterDays: rules.approvalAfterDays, maxDays: rules.maxDays }),
    onSuccess: (res) => {
      queryClient.setQueryData(taskKeys.rules(), res.rules);
      setDraft(null);
      toast.success('Task date rules saved');
      onDone?.();
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not save the rules.')),
  });
  const set = (patch: Partial<TaskRules>) => setDraft({ ...rules, ...patch, maxDays: { ...rules.maxDays, ...(patch.maxDays ?? {}) } });
  const num = (v: string) => Math.max(0, Math.min(365, Math.trunc(Number(v) || 0)));
  const field = 'w-20 rounded-md border border-gray-300 px-2 py-1 text-sm';
  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
      <p className="text-sm text-gray-600">Every task needs a due date. These limits apply to the next date someone sets — tasks already saved are not changed.</p>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Manager approval needed for dates more than … days away</span>
        <input type="number" min={0} max={365} value={rules.approvalAfterDays} onChange={(e) => set({ approvalAfterDays: num(e.target.value) })} className={field} aria-label="Approval needed after days" />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-gray-900">Latest due date by priority (days from today)</legend>
        {TASK_PRIORITIES.map((p) => (
          <label key={p.value} className="flex items-center justify-between gap-3 text-sm">
            <span>{p.label} <span className="text-gray-500">— {limitText(rules.maxDays[p.value])}</span></span>
            <input
              type="number"
              min={0}
              max={365}
              value={rules.maxDays[p.value]}
              onChange={(e) => set({ maxDays: { [p.value]: num(e.target.value) } as TaskRules['maxDays'] })}
              className={field}
              aria-label={`${p.label} latest due in days`}
            />
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-gray-500">0 = today only, 1 = today or tomorrow.{current.data?.updatedByName ? ` Last changed by ${current.data.updatedByName}.` : ''}</p>
      <div className="flex justify-end gap-2">
        {onDone && <button type="button" onClick={onDone} className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100">Cancel</button>}
        <button type="submit" disabled={!draft || save.isPending} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Save</button>
      </div>
    </form>
  );
}
