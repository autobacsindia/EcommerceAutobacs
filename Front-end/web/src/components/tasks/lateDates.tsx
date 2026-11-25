'use client';

/**
 * Late tasks and new dates (owner, 2026-11-24 — "everyone must take approval if
 * they didn't finish on time"). The server decides everything
 * (Back-end/server/services/staffTaskService.js askNewDate / decideNewDate):
 *
 *   - once a task is late, the person doing it gives a reason and a new date;
 *     they can't move the date themselves
 *   - whoever gave it approves (or picks another date, or says no with a note) —
 *     a head of its team or the admin may too, never whoever asked
 *   - before the deadline they may ask for more time early (twice per task)
 *   - every late move is a miss; missed twice or more = dark red with ⚠
 *
 * Here: the box on the task page (NewDatePanel), the mark on a row (LateMark),
 * and the pop-up that keeps asking until every late task has a reason
 * (LateTasksPrompt).
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CalendarCheck, CalendarClock, Loader2, OctagonAlert, TriangleAlert } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import { LATE_REASONS, formatDueKey, timeIST, todayIST, type LateReason, type Task } from './types';
import { DueTimeSelect } from './ui';
import { useRefreshTasks } from './hooks';

const NOTE_MIN = 5;
const NOTE_MAX = 500;
const missedText = (n: number) => (n === 1 ? 'Missed once' : `Missed ${n} times`);
const due = (dueOn: string, dueTime: string | null | undefined) => formatDueKey(dueTime ? `${dueOn} ${dueTime}` : dueOn);
/** Is this new date still ahead? (The server checks too.) */
const ahead = (dueOn: string, dueTime: string | null) => !!dueOn && (dueOn > todayIST() || (dueOn === todayIST() && (!dueTime || dueTime > timeIST())));

/** After a decision or an ask: show the task as saved, refresh the lists and the pop-up. */
function useSaved(task: Task) {
  const queryClient = useQueryClient();
  const refresh = useRefreshTasks();
  return {
    saved: (next: Task) => {
      queryClient.setQueryData(taskKeys.one(task.id), { task: next });
      void queryClient.invalidateQueries({ queryKey: taskKeys.lateMine() });
      return refresh();
    },
    // Someone else changed it first: show what it is now.
    reload: () => queryClient.invalidateQueries({ queryKey: taskKeys.one(task.id) }),
  };
}

/** A small mark on a row: ⚠ missed twice or more, or a new date waiting for approval. */
export function LateMark({ task }: { task: Pick<Task, 'bucket' | 'danger' | 'misses' | 'lateRequest'> }) {
  if (task.bucket !== 'open') return null;
  if (task.danger) {
    return (
      <span title={`${missedText(task.misses ?? 2)} — the deadline has passed more than once`} className="inline-flex items-center gap-1 rounded-full bg-red-900 px-1.5 py-0.5 text-[11px] font-semibold text-white">
        <TriangleAlert aria-hidden className="h-3 w-3" /> {missedText(task.misses ?? 2)}
      </span>
    );
  }
  if (task.lateRequest?.status === 'pending') {
    return (
      <span title={`New date asked for: ${due(task.lateRequest.dueOn, task.lateRequest.dueTime)}`} className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
        <CalendarClock aria-hidden className="h-3 w-3" /> New date asked
      </span>
    );
  }
  return null;
}

/** "Why is it late, and when will it be done?" — or, before the deadline, "I need more time". */
function AskForm({ task, late, onCancel }: { task: Task; late: boolean; onCancel?: () => void }) {
  const { saved, reload } = useSaved(task);
  const [reason, setReason] = useState<LateReason | ''>('');
  const [note, setNote] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [dueTime, setDueTime] = useState<string | null>(task.dueTime ?? null);
  const ask = useMutation({
    mutationFn: () => apiClient.post<{ task: Task }>(`/staff/tasks/${encodeURIComponent(task.id)}/new-date`, {
      rev: task.rev, reason, note: note.trim(), dueOn, ...(dueTime ? { dueTime } : {}),
    }),
    onSuccess: (res) => {
      toast.success(`Sent to ${task.createdBy.name || 'your manager'} for approval`);
      onCancel?.();
      return saved(res.task);
    },
    onError: (e) => { toast.error(errorMessage(e, 'Could not send it.')); void reload(); },
  });
  const noteOk = note.trim().length >= NOTE_MIN;
  const dateOk = ahead(dueOn, dueTime);
  const ready = !!reason && noteOk && dateOk && !ask.isPending;
  const id = (x: string) => `${x}-${task.id}`;
  const field = 'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900';
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ready) ask.mutate(); }} className="space-y-2" aria-label={late ? 'Why is this late' : 'Ask for more time'}>
      <div>
        <label htmlFor={id('reason')} className="block text-sm font-medium">{late ? 'Why wasn’t it done on time?' : 'Why do you need more time?'}</label>
        <select id={id('reason')} value={reason} onChange={(e) => setReason(e.target.value as LateReason)} className={field}>
          <option value="">Pick a reason…</option>
          {LATE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={id('note')} className="block text-sm font-medium">What happened?</label>
        <input id={id('note')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} placeholder="e.g. RK hasn’t sent the car model yet" className={field} />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={id('date')} className="block text-sm font-medium">New date</label>
          <input id={id('date')} type="date" min={todayIST()} value={dueOn} onChange={(e) => setDueOn(e.target.value)} className={field} />
        </div>
        <DueTimeSelect value={dueTime} onChange={setDueTime} label="New time" className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900" />
      </div>
      {dueOn && !dateOk && <p role="alert" className="text-sm text-red-700">Pick a date and time that is still ahead.</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={!ready} className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
          {ask.isPending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />} Send for approval
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-black/5">Cancel</button>}
      </div>
    </form>
  );
}

/** Approve / another date / not approve — for whoever gave the task (or a head, or the admin). */
function DecideForm({ task }: { task: Task }) {
  const lr = task.lateRequest!;
  const { saved, reload } = useSaved(task);
  const [mode, setMode] = useState<'buttons' | 'other' | 'no'>('buttons');
  const [note, setNote] = useState('');
  const [dueOn, setDueOn] = useState(lr.dueOn);
  const [dueTime, setDueTime] = useState<string | null>(lr.dueTime);
  const decide = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post<{ task: Task }>(`/staff/tasks/${encodeURIComponent(task.id)}/new-date/decision`, { rev: task.rev, ...body }),
    onSuccess: (res) => {
      toast.success(res.task.lateRequest?.status === 'approved' ? 'New date approved — they have been told' : 'Not approved — they have been told');
      setMode('buttons');
      return saved(res.task);
    },
    onError: (e) => { toast.error(errorMessage(e, 'Could not save your decision.')); void reload(); },
  });
  const busy = decide.isPending;
  if (mode === 'no') {
    return (
      <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) decide.mutate({ decision: 'reject', note: note.trim() }); }} className="space-y-2">
        <label className="block text-sm font-medium" htmlFor={`late-no-${task.id}`}>Why not? What should they do?</label>
        <input id={`late-no-${task.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} autoFocus placeholder="e.g. Needed today — call RK now" className="w-full rounded-md border border-amber-300 bg-white px-2 py-1.5 text-sm" />
        <div className="flex gap-2">
          <button type="submit" disabled={!note.trim() || busy} className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">Send</button>
          <button type="button" onClick={() => setMode('buttons')} className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-amber-100">Cancel</button>
        </div>
      </form>
    );
  }
  if (mode === 'other') {
    const ok = ahead(dueOn, dueTime);
    return (
      <form onSubmit={(e) => { e.preventDefault(); if (ok) decide.mutate({ decision: 'approve', dueOn, ...(dueTime ? { dueTime } : {}), ...(note.trim() ? { note: note.trim() } : {}) }); }} className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={`late-other-${task.id}`} className="block text-sm font-medium">Your date</label>
            <input id={`late-other-${task.id}`} type="date" min={todayIST()} value={dueOn} onChange={(e) => setDueOn(e.target.value)} className="rounded-md border border-amber-300 bg-white px-2 py-1.5 text-sm" />
          </div>
          <DueTimeSelect value={dueTime} onChange={setDueTime} label="Your time" className="rounded-md border border-amber-300 bg-white px-2 py-1.5 text-sm" />
        </div>
        <input aria-label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} placeholder="Note (optional)" className="w-full rounded-md border border-amber-300 bg-white px-2 py-1.5 text-sm" />
        <div className="flex gap-2">
          <button type="submit" disabled={!ok || busy} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">Approve this date</button>
          <button type="button" onClick={() => setMode('buttons')} className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-amber-100">Cancel</button>
        </div>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => decide.mutate({ decision: 'approve' })} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
        {busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />} Approve {due(lr.dueOn, lr.dueTime)}
      </button>
      <button type="button" disabled={busy} onClick={() => setMode('other')} className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50">Give another date</button>
      <button type="button" disabled={busy} onClick={() => setMode('no')} className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50">Not approve</button>
    </div>
  );
}

/** On the task page: late / asked / decided, and the forms for whoever may act. */
export function NewDatePanel({ task }: { task: Task }) {
  const [early, setEarly] = useState(false);
  if (task.bucket !== 'open' || !task.dueOn) return null;
  const lr = task.lateRequest;
  const misses = task.misses ?? 0;

  if (lr?.status === 'pending') {
    return (
      <div role="status" className="space-y-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <p className="flex items-start gap-2">
          <CalendarClock aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>{lr.late ? 'Late — new date asked for' : 'More time asked for'}:</strong> {lr.requestedBy.name || 'Someone'} asks for {due(lr.dueOn, lr.dueTime)}.
            {' '}<span className="block">{lr.reasonLabel}: “{lr.note}”</span>
            {!task.can.decideNewDate && <span className="block text-amber-800">Waiting for {task.createdBy.name || 'whoever gave it'} to approve.</span>}
          </span>
        </p>
        {task.can.decideNewDate && <DecideForm task={task} />}
      </div>
    );
  }

  if (task.overdue) {
    const dark = !!task.danger;
    return (
      <div role="alert" className={`space-y-2 rounded-lg px-3 py-2 text-sm ${dark ? 'bg-red-900 text-white' : 'bg-red-50 text-red-900'}`}>
        <p className="flex items-center gap-2 font-semibold">
          {dark ? <TriangleAlert aria-hidden className="h-4 w-4 shrink-0" /> : <OctagonAlert aria-hidden className="h-4 w-4 shrink-0" />}
          This task is late{misses > 1 ? ` — ${missedText(misses).toLowerCase()}` : ''}.
          {task.can.askNewDate ? ' Say why, and when it will be done.' : ''}
        </p>
        {lr?.status === 'rejected' && (
          <p>{lr.decidedBy?.name || 'Your manager'} did not approve {due(lr.dueOn, lr.dueTime)}: “{lr.decisionNote}”</p>
        )}
        {task.can.askNewDate ? (
          <div className={`rounded-md p-2 ${dark ? 'bg-white text-gray-900' : ''}`}><AskForm task={task} late /></div>
        ) : (
          <p>Waiting for {task.assignees.map((p) => p.name).join(', ') || 'the person doing it'} to give a reason and a new date.</p>
        )}
      </div>
    );
  }

  return (
    <>
      {lr?.status === 'approved' && lr.decidedAt && (
        <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <CalendarCheck aria-hidden className="h-4 w-4 shrink-0" />
          New date {lr.approvedDue ? formatDueKey(lr.approvedDue) : ''} approved by {lr.decidedBy?.name || 'a manager'}.{misses > 0 ? ` ${missedText(misses)} so far.` : ''}
        </p>
      )}
      {task.can.askNewDate && (early ? (
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-900"><AskForm task={task} late={false} onCancel={() => setEarly(false)} /></div>
      ) : (
        <button type="button" onClick={() => setEarly(true)} className="self-start text-sm font-medium text-blue-700 hover:underline">
          Need more time? Ask before it’s late
        </button>
      ))}
    </>
  );
}

// ── The pop-up ───────────────────────────────────────────────────────────────

export const SNOOZE_KEY = 'roavion-late-reason-snooze';
/** "Remind me later" hides the pop-up this long — then it comes back until every late task has a reason. */
export const SNOOZE_MS = 30 * 60_000;
const SHOWN_MAX = 3;

function snoozedUntil(): number {
  try { return Number(window.sessionStorage.getItem(SNOOZE_KEY)) || 0; } catch { return 0; }
}

/**
 * In the corner of every panel page: "You have late tasks — say why, and when
 * they will be done". Comes back on every page and every 5 minutes until each
 * has a reason; "Remind me in 30 min" hides it for this tab that long.
 */
export function LateTasksPrompt({ base }: { base: string }) {
  const { data } = useQuery({
    queryKey: taskKeys.lateMine(),
    queryFn: async () => (await apiClient.get<{ tasks: Task[] }>('/staff/tasks?view=mine&due=overdue')).tasks,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
  // null until mounted: the server render never shows it (no hydration mismatch).
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    setUntil(snoozedUntil());
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(tick);
  }, []);
  const waiting = (data ?? []).filter((t) => t.needsReason);
  if (until === null || !waiting.length || now < until) return null;
  const snooze = () => {
    const at = Date.now() + SNOOZE_MS;
    try { window.sessionStorage.setItem(SNOOZE_KEY, String(at)); } catch { /* not remembered: it shows again on the next page */ }
    setUntil(at);
  };
  const anyDanger = waiting.some((t) => t.danger);
  return (
    <div role="alert" aria-label="Late tasks" className={`fixed bottom-4 left-4 z-[60] w-[min(22rem,calc(100vw-2rem))] rounded-xl border p-3 shadow-lg ${anyDanger ? 'border-red-900 bg-red-900 text-white' : 'border-red-200 bg-white text-gray-900'}`}>
      <p className="flex items-center gap-2 text-sm font-semibold">
        <TriangleAlert aria-hidden className={`h-4 w-4 shrink-0 ${anyDanger ? '' : 'text-red-600'}`} />
        {waiting.length === 1 ? 'A task of yours is late' : `${waiting.length} tasks of yours are late`} — say why, and when it will be done
      </p>
      <ul className="mt-2 space-y-1">
        {waiting.slice(0, SHOWN_MAX).map((t) => (
          <li key={t.id}>
            <Link href={`${base}/${t.id}`} className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:underline ${anyDanger ? 'bg-white/10' : 'bg-red-50 text-red-900'}`}>
              {t.danger && <TriangleAlert aria-label="Missed more than once" className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{t.code} · {t.title}</span>
            </Link>
          </li>
        ))}
      </ul>
      {waiting.length > SHOWN_MAX && <p className="mt-1 text-xs opacity-80">and {waiting.length - SHOWN_MAX} more in your tasks</p>}
      <button type="button" onClick={snooze} className={`mt-2 text-xs font-medium underline ${anyDanger ? 'text-white/90' : 'text-gray-600'}`}>Remind me in 30 min</button>
    </div>
  );
}
