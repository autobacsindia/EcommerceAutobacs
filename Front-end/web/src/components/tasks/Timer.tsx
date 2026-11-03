'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Play, Plus, Square, Timer as TimerIcon, Trash2, TriangleAlert, X } from 'lucide-react';
import toast from 'react-hot-toast';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import { Avatar } from './ui';
import {
  TIME_NOTE_MAX, TIME_PAST_DAYS, durationProblem, formatClock, formatDueDay, formatDuration, minutesText, newClientId, parseDuration, todayIST,
  type RunningTimer, type Task, type TaskTimePage, type TimeEntry, type TimerState,
} from './types';

/*
 * Time on tasks (phase 6b). Nothing here is optimistic: a timer shows as
 * running only once the server has started it, and a stop only once it has
 * saved it. The clock ticks in the browser from the server's own reading.
 */

const base = (id: string) => `/staff/tasks/${encodeURIComponent(id)}/time`;

/** After any change to time: the timer, every task's time list, and the lists' totals. */
function useRefreshTime() {
  const queryClient = useQueryClient();
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: taskKeys.timer() }),
    queryClient.invalidateQueries({ queryKey: taskKeys.times() }),
    queryClient.invalidateQueries({ queryKey: taskKeys.lists() }),
  ]);
}

/** Your running timer: read on load, every minute, and whenever the tab comes back into view. */
export function useTimer() {
  return useQuery({
    queryKey: taskKeys.timer(),
    queryFn: () => apiClient.get<TimerState>('/staff/tasks/time/current'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** "12m saved on T-30" — or that it stopped itself at the limit. */
function savedText(entry: TimeEntry, code: string) {
  return entry.autoStopped
    ? `${code}’s timer had stopped itself at ${formatDuration(entry.seconds)} — correct it if that’s wrong.`
    : `Stopped ${code} — ${formatDuration(entry.seconds)} saved`;
}

/**
 * Start and stop. A ref turns a double-click into one request; the button also
 * says "Starting…" / "Stopping…" until the server answers.
 */
export function useTimerActions() {
  const refresh = useRefreshTime();
  const busy = useRef(false);
  const start = useMutation({
    mutationFn: (task: Pick<Task, 'id' | 'code'>) => apiClient.post<{ timer: RunningTimer; stopped: TimeEntry | null }>(`${base(task.id)}/start`, {}),
    onSuccess: ({ stopped }) => {
      if (stopped) toast.success(savedText(stopped, stopped.task?.code ?? 'the last task'), { id: 'timer-switch' });
    },
    onError: (e, task) => { toast.error(errorMessage(e, `Could not start the timer on ${task.code}.`)); },
    onSettled: async () => { await refresh(); busy.current = false; },
  });
  const stop = useMutation({
    mutationFn: () => apiClient.post<{ entry: TimeEntry | null }>('/staff/tasks/time/stop', {}),
    onSuccess: ({ entry }) => {
      toast.success(entry ? savedText(entry, entry.task?.code ?? 'The timer') : 'The timer had already stopped.', { id: 'timer-stop' });
    },
    onError: (e) => { toast.error(errorMessage(e, 'Could not stop the timer.')); },
    onSettled: async () => { await refresh(); busy.current = false; },
  });
  const once = (go: () => void) => { if (busy.current) return; busy.current = true; go(); };
  return {
    start: (task: Pick<Task, 'id' | 'code'>) => once(() => start.mutate(task)),
    stop: () => once(() => stop.mutate()),
    starting: start.isPending,
    stopping: stop.isPending,
  };
}

/**
 * The running timer's seconds, ticking each second from the server's reading.
 * Counted from when the answer arrived, so the browser's own clock being off
 * does not matter.
 */
function useElapsed(timer: RunningTimer | null | undefined, readAt: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timer) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [timer]);
  if (!timer) return 0;
  return Math.min(timer.limitSeconds, timer.seconds + Math.max(0, Math.floor((now - readAt) / 1000)));
}

/** The task window's Start / Stop. Hidden when you may not track time on the task (archived). */
export function TimerButton({ task }: { task: Task }) {
  const timer = useTimer();
  const actions = useTimerActions();
  const running = timer.data?.timer ?? null;
  const here = !!running && running.task?.id === task.id;
  const seconds = useElapsed(here ? running : null, timer.dataUpdatedAt);
  if (!task.can.time && !here) return <span className="text-gray-400">Archived tasks can’t be timed</span>;
  if (timer.isLoading) return <span className="text-gray-400">…</span>;
  const button = 'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors disabled:opacity-60';
  if (here) {
    return (
      <span className="flex items-center gap-2">
        <button type="button" onClick={actions.stop} disabled={actions.stopping} className={`${button} tk-face bg-red-600 hover:bg-red-700`}>
          <Square aria-hidden className="h-3 w-3 fill-current" />{actions.stopping ? 'Stopping…' : 'Stop timer'}
        </button>
        <span className="font-mono text-sm tabular-nums text-gray-900" aria-label={`Running for ${formatDuration(seconds)}`}>{formatClock(seconds)}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => actions.start(task)}
        disabled={actions.starting}
        className={`${button} border border-gray-200 text-gray-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700`}
      >
        <Play aria-hidden className="h-3 w-3 fill-current" />{actions.starting ? 'Starting…' : 'Start timer'}
      </button>
      {running && <span className="text-xs text-gray-500">stops {running.task.code}</span>}
    </span>
  );
}

/**
 * The header chip while a timer runs: "⏱ T-30 · 0:42:10 ■". The code opens the
 * task; the square stops it.
 */
export function TimerChip({ onOpen }: { onOpen: (id: string) => void }) {
  const queryClient = useQueryClient();
  const timer = useTimer();
  const actions = useTimerActions();
  const running = timer.data?.timer ?? null;
  const seconds = useElapsed(running, timer.dataUpdatedAt);

  // Reaching the limit while watching: ask the server, which stops it and says so.
  const atLimit = !!running && seconds >= running.limitSeconds;
  useEffect(() => {
    if (atLimit) queryClient.invalidateQueries({ queryKey: taskKeys.timer() });
  }, [atLimit, queryClient]);

  if (!running) return null;
  return (
        <span
          role="status"
          aria-label={`Timer running on ${running.task.code}: ${formatDuration(seconds)}`}
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 pl-2.5 pr-1 text-sm text-blue-800"
        >
          <TimerIcon aria-hidden className="h-4 w-4" />
          <button type="button" onClick={() => onOpen(running.task.id)} title={running.task.title} className="font-mono text-xs font-semibold hover:underline">
            {running.task.code}
          </button>
          <span aria-hidden className="text-blue-300">·</span>
          <span className="font-mono tabular-nums">{formatClock(seconds)}</span>
          <button
            type="button"
            onClick={actions.stop}
            disabled={actions.stopping}
            aria-label={actions.stopping ? 'Stopping the timer' : `Stop the timer on ${running.task.code}`}
            title="Stop"
            className="ml-0.5 rounded-md p-1.5 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            <Square aria-hidden className="h-3 w-3 fill-current" />
          </button>
        </span>
  );
}

/** A timer the server stopped itself at the limit: said once by the server, kept here until dismissed. */
export function TimerNotice({ onOpen }: { onOpen: (id: string) => void }) {
  const timer = useTimer();
  const [notice, setNotice] = useState<TimeEntry | null>(null);
  const seen = timer.data?.autoStopped ?? null;
  const [lastSeen, setLastSeen] = useState<TimeEntry | null>(null);
  if (seen && seen.id !== lastSeen?.id) { setLastSeen(seen); setNotice(seen); }
  if (!notice) return null;
  return (
        <p role="alert" className="flex basis-full items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">
            Your timer{notice.task ? <> on <button type="button" onClick={() => onOpen(notice.task!.id)} className="font-semibold underline">{notice.task.code}</button></> : ''} stopped
            itself at {formatDuration(notice.seconds)} ({formatDueDay(notice.day)}) — correct it under Time if that’s wrong.
          </span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="rounded p-0.5 hover:bg-amber-100"><X aria-hidden className="h-4 w-4" /></button>
        </p>
  );
}

/** The last day time may be added for, and the first. */
const addDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** Add time by hand, or correct an entry. `entry` given: it edits that one. */
function TimeForm({ taskId, entry, onDone }: { taskId: string; entry?: TimeEntry; onDone: () => void }) {
  const refresh = useRefreshTime();
  const today = todayIST();
  const [length, setLength] = useState(entry ? minutesText(Math.max(1, Math.round(entry.seconds / 60))) : '');
  const [day, setDay] = useState(entry?.day ?? today);
  const [note, setNote] = useState(entry?.note ?? '');
  const [problem, setProblem] = useState('');
  // One id per form: a double-click or a retried request adds the time once.
  const [clientId] = useState(newClientId);
  const save = useMutation({
    mutationFn: (body: { minutes: number; on: string; note: string }) => (entry
      ? apiClient.patch<{ entry: TimeEntry }>(`${base(taskId)}/${encodeURIComponent(entry.id)}`, body)
      : apiClient.post<{ entry: TimeEntry }>(base(taskId), { ...body, clientId })),
    onSuccess: async () => {
      toast.success(entry ? 'Time corrected' : 'Time added', { id: `time-saved-${taskId}` });
      await refresh();
      onDone();
    },
    onError: (e) => { setProblem(errorMessage(e, 'Could not save the time.')); },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    const minutes = parseDuration(length);
    const wrong = durationProblem(minutes)
      || (day > today ? 'Time can’t be added for a day that hasn’t come yet.' : '')
      || (!day || day < addDays(today, -TIME_PAST_DAYS) ? `Pick a day in the last ${TIME_PAST_DAYS} days.` : '');
    setProblem(wrong);
    if (!wrong) save.mutate({ minutes: minutes!, on: day, note: note.trim() });
  };
  const input = 'rounded-md border border-gray-200 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none';
  return (
    <form onSubmit={submit} aria-label={entry ? 'Correct the time' : 'Add time'} className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          How long
          <input value={length} onChange={(e) => setLength(e.target.value)} placeholder="1h 30m" autoFocus className={`${input} w-28`} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Day
          <input type="date" value={day} max={today} min={addDays(today, -TIME_PAST_DAYS)} onChange={(e) => setDay(e.target.value)} className={input} />
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs font-medium text-gray-600">
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={TIME_NOTE_MAX} placeholder="What was it for?" className={input} />
        </label>
      </div>
      {problem && <p role="alert" className="text-sm text-red-700">{problem}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={save.isPending} className="tk-face rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold hover:bg-blue-700 disabled:opacity-60">
          {save.isPending ? 'Saving…' : entry ? 'Save' : 'Add time'}
        </button>
        <button type="button" onClick={onDone} className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
      </div>
    </form>
  );
}

function EntryRow({ taskId, entry }: { taskId: string; entry: TimeEntry }) {
  const refresh = useRefreshTime();
  const [editing, setEditing] = useState(false);
  const remove = useMutation({
    mutationFn: () => apiClient.delete(`${base(taskId)}/${encodeURIComponent(entry.id)}`),
    onSuccess: () => { toast.success(entry.running ? 'Timer discarded' : 'Time deleted', { id: `time-deleted-${entry.id}` }); },
    onError: (e) => { toast.error(errorMessage(e, 'Could not delete the time.')); },
    onSettled: () => refresh(),
  });
  const ask = () => {
    const what = entry.running ? 'Discard the running timer? The time so far is not saved.' : `Delete ${formatDuration(entry.seconds)} on ${formatDueDay(entry.day)}?`;
    if (!remove.isPending && window.confirm(what)) remove.mutate();
  };
  if (editing) return <li className="py-2"><TimeForm taskId={taskId} entry={entry} onDone={() => setEditing(false)} /></li>;
  return (
    <li className="group flex items-start gap-2.5 py-2 text-sm">
      <Avatar name={entry.by.name} id={entry.by.id} size="xs" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-gray-900">{entry.by.name}</span>
          {/* A running entry's length was read when the list loaded: the header and Timer field tick, this would not. */}
          {!entry.running && <span className="font-mono tabular-nums text-gray-900">{formatDuration(entry.seconds)}</span>}
          <span className="text-xs text-gray-500">{formatDueDay(entry.day)} · {entry.source === 'timer' ? 'timer' : 'added by hand'}</span>
          {entry.running && <span className="rounded bg-blue-100 px-1.5 text-[11px] font-semibold text-blue-800">running now</span>}
          {entry.autoStopped && <span className="rounded bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800" title="Left running: it stopped itself at the limit">stopped at limit</span>}
          {entry.edited && <span className="text-[11px] text-gray-400">edited</span>}
        </p>
        {entry.note && <p className="break-words text-xs text-gray-600">{entry.note}</p>}
      </div>
      <span className="flex shrink-0 gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        {entry.can.edit && (
          <button type="button" onClick={() => setEditing(true)} aria-label={`Correct ${entry.by.name}’s ${formatDuration(entry.seconds)}`} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <Pencil aria-hidden className="h-3.5 w-3.5" />
          </button>
        )}
        {entry.can.delete && (
          <button type="button" onClick={ask} disabled={remove.isPending} aria-label={`Delete ${entry.by.name}’s ${formatDuration(entry.seconds)}`} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-700">
            <Trash2 aria-hidden className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    </li>
  );
}

/** One task's time, newest first, 30 at a time. */
export function useTaskTime(taskId: string) {
  return useInfiniteQuery({
    queryKey: taskKeys.time(taskId),
    queryFn: ({ pageParam }) => apiClient.get<TaskTimePage>(`${base(taskId)}${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
}

/** The task window's Time section: the total, each person's share, the entries, "+ Add time". */
export function TimePanel({ task }: { task: Task }) {
  const q = useTaskTime(task.id);
  const [adding, setAdding] = useState(false);
  const first = q.data?.pages[0];
  const entries = q.data?.pages.flatMap((p) => p.entries ?? []) ?? [];
  const total = first?.total;
  const canAdd = !!task.can.time && first?.can?.track !== false;
  return (
    <section aria-label="Time">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900"><TimerIcon aria-hidden className="h-4 w-4 text-gray-500" /> Time</h3>
        {!!total?.seconds && <span className="font-mono text-sm tabular-nums text-gray-700">{formatDuration(total.seconds)}</span>}
        <span className="flex-1" />
        {canAdd && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">
            <Plus aria-hidden className="h-3.5 w-3.5" /> Add time
          </button>
        )}
      </div>
      {(total?.people?.length ?? 0) > 1 && (
        <p className="mb-1 text-xs text-gray-500">
          {total!.people.map((p) => `${p.name} ${formatDuration(p.seconds)}`).join(' · ')}
        </p>
      )}
      {adding && <div className="my-2"><TimeForm taskId={task.id} onDone={() => setAdding(false)} /></div>}
      {q.isLoading ? <p className="text-sm text-gray-400">Loading time…</p>
        : q.isError ? (
          <p role="alert" className="text-sm text-red-700">
            {errorMessage(q.error, 'Could not load the time.')}{' '}
            <button type="button" onClick={() => q.refetch()} className="font-medium underline">Try again</button>
          </p>
        ) : !entries.length ? (
          !adding && <p className="text-sm text-gray-400">{canAdd ? 'No time yet. Start the timer, or add time you already spent.' : 'No time was tracked.'}</p>
        ) : (
          <ul className="divide-y divide-gray-100">{entries.map((e) => <EntryRow key={e.id} taskId={task.id} entry={e} />)}</ul>
        )}
      {q.hasNextPage && (
        <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className="mt-1 text-xs font-medium text-blue-700 hover:underline">
          {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}
