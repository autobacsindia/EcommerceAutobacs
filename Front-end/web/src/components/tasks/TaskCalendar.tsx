'use client';

import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import { listParams } from './hooks';
import { SkeletonRows } from './ui';
import { todayIST, type Task, type TaskFilters, type TaskPage } from './types';

/**
 * The Calendar view: open tasks on their due day, a month at a time — the same
 * tasks the list shows (same person / team / project / filters), placed by date.
 *
 * Bounded: the server returns only tasks due on the days on screen (at most six
 * weeks), a page at a time; we read at most MAX_PAGES pages and say so if there
 * were more. Tasks with no due date have no day, and are listed in the List view.
 */
const MAX_PAGES = 10;
const SHOWN_PER_DAY = 3;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** 'YYYY-MM-DD' arithmetic on calendar days (UTC, so no clock or zone shifts). */
const parse = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => { const d = parse(ymd); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const monthStart = (ymd: string) => `${ymd.slice(0, 7)}-01`;
const addMonths = (first: string, n: number) => { const d = parse(first); d.setUTCMonth(d.getUTCMonth() + n); return fmt(d); };

/** The days on screen for the month starting `first`: whole weeks, Monday first (35 or 42 days). */
export function monthGrid(first: string): string[] {
  const back = (parse(first).getUTCDay() + 6) % 7;
  const start = addDays(first, -back);
  const last = addDays(addMonths(first, 1), -1);
  const days: string[] = [];
  for (let d = start; days.length < 42; d = addDays(d, 1)) {
    days.push(d);
    if (d >= last && days.length % 7 === 0) break;
  }
  return days;
}

const monthLabel = (first: string) => parse(first).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayLabel = (ymd: string) => parse(ymd).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

function TaskChip({ t, onOpen }: { t: Task; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(t.id)}
      title={`${t.code}: ${t.title}${t.dueTime ? ` · ${t.dueTime}` : ''}`}
      className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[12px] font-medium ${
        t.overdue ? 'bg-red-50 text-red-800 hover:bg-red-100' : 'bg-blue-50 text-blue-900 hover:bg-blue-100'
      }`}
    >
      {t.dueTime && <span className="mr-1 font-mono text-[11px] opacity-70">{t.dueTime}</span>}
      {t.title}
    </button>
  );
}

export default function TaskCalendar({ filters, onOpen }: { filters: TaskFilters; onOpen: (id: string) => void }) {
  const today = todayIST();
  const [first, setFirst] = useState(() => monthStart(today));
  const [expanded, setExpanded] = useState<string | null>(null);
  const days = monthGrid(first);
  // The list's own filters, minus its due filter and order: the calendar is the dates.
  const { due: _due, sort: _sort, ...base } = listParams(filters, 'open');
  const params = { ...base, dueFrom: days[0], dueTo: days[days.length - 1] };

  const q = useInfiniteQuery({
    queryKey: taskKeys.list(params),
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ ...params, ...(pageParam ? { cursor: pageParam } : {}) });
      return apiClient.get<TaskPage>(`/staff/tasks?${qs}`);
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    refetchInterval: 60_000,
  });
  const pages = q.data?.pages.length ?? 0;
  useEffect(() => {
    if (q.hasNextPage && !q.isFetchingNextPage && pages < MAX_PAGES) q.fetchNextPage();
  }, [q, pages]);

  const byDay = new Map<string, Task[]>();
  for (const t of q.data?.pages.flatMap((p) => p.tasks) ?? []) {
    if (!t.dueOn) continue;
    byDay.set(t.dueOn, [...(byDay.get(t.dueOn) ?? []), t]);
  }
  const month = first.slice(0, 7);
  const agenda = days.filter((d) => d.startsWith(month) && byDay.has(d));
  const capped = pages >= MAX_PAGES && q.hasNextPage;

  return (
    <section aria-label="Calendar" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setFirst(addMonths(first, -1))} aria-label="Previous month" className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100"><ChevronLeft className="h-4 w-4" /></button>
          <h2 className="min-w-36 text-center text-sm font-semibold text-gray-900" aria-live="polite">{monthLabel(first)}</h2>
          <button type="button" onClick={() => setFirst(addMonths(first, 1))} aria-label="Next month" className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100"><ChevronRight className="h-4 w-4" /></button>
        </div>
        {first !== monthStart(today) && (
          <button type="button" onClick={() => setFirst(monthStart(today))} className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">Today</button>
        )}
        <p className="text-xs text-gray-500 sm:ml-auto">Open tasks on their due day. Tasks with no due date are in the List view.</p>
      </div>
      {q.isError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage(q.error, 'Could not load the calendar.')}</p>}
      {capped && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">This month has more tasks than fit here. Narrow it with a filter, or use the List view.</p>}
      {q.isLoading ? <SkeletonRows rows={5} /> : (
        <>
          {/* Wide screens: the month grid. */}
          <div className="hidden overflow-hidden rounded-xl border border-gray-200 bg-white md:block">
            <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              {WEEKDAYS.map((w) => <div key={w} className="px-2 py-1.5">{w}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const list = byDay.get(d) ?? [];
                const open = expanded === d;
                const shown = open ? list : list.slice(0, SHOWN_PER_DAY);
                const other = !d.startsWith(month);
                return (
                  <div key={d} data-day={d} className={`min-h-24 border-b border-r border-gray-100 p-1 [&:nth-child(7n)]:border-r-0 ${other ? 'bg-gray-50/60' : ''}`}>
                    <div className={`mb-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                      d === today ? 'bg-blue-600 font-semibold text-white' : other ? 'text-gray-400' : 'text-gray-700'
                    }`}>{Number(d.slice(8))}</div>
                    <div className="space-y-0.5">
                      {shown.map((t) => <TaskChip key={t.id} t={t} onOpen={onOpen} />)}
                      {list.length > SHOWN_PER_DAY && (
                        <button type="button" onClick={() => setExpanded(open ? null : d)} className="px-1.5 text-[11px] font-medium text-blue-700 hover:underline">
                          {open ? 'Show less' : `+${list.length - SHOWN_PER_DAY} more`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Phones: the month's days that have tasks, one under the other. */}
          <div className="space-y-2 md:hidden">
            {agenda.length === 0 && <p className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">Nothing due this month.</p>}
            {agenda.map((d) => (
              <div key={d} className="rounded-xl border border-gray-200 bg-white p-2">
                <p className={`mb-1 text-xs font-semibold ${d === today ? 'text-blue-700' : 'text-gray-600'}`}>{d === today ? `Today · ${dayLabel(d)}` : dayLabel(d)}</p>
                <div className="space-y-1">{byDay.get(d)!.map((t) => <TaskChip key={t.id} t={t} onOpen={onOpen} />)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
