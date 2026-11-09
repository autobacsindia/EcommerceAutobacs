'use client';

import { useQuery } from '@tanstack/react-query';
import { AlarmClock, CalendarDays, CircleCheck, ListTodo, RefreshCw, TriangleAlert } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { Avatar } from './ui';
import { StatTile } from './StatTile';
import { useSpace, allLists } from './spaces';
import { formatDueKey, type TeamOverviewData } from './types';

const Card = ({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) => (
  <section aria-label={title} className={`rounded-lg border border-gray-200 bg-white p-3.5 ${className}`}>
    <h2 className="mb-2.5 text-[13px] font-semibold text-gray-900">{title}</h2>
    {children}
  </section>
);
const Nothing = ({ children }: { children: React.ReactNode }) => <p className="py-3 text-center text-[13px] text-gray-500">{children}</p>;

const Bar = ({ label, count, max, extra }: { label: React.ReactNode; count: number; max: number; extra?: React.ReactNode }) => (
  <div>
    <div className="flex items-center justify-between gap-2 text-[13px] text-gray-700">
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 tabular-nums font-medium">{extra}{count}</span>
    </div>
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
      <div className="h-full rounded-full bg-blue-500" style={{ width: `${max ? Math.max(4, Math.round((count / max) * 100)) : 0}%` }} />
    </div>
  </div>
);

/** One team at a glance. Everything comes from the server; `team` is empty for someone seeing their own. */
export function TeamOverview({ team, spaceTeam, onOpen, onPickList }: {
  team: string; spaceTeam: string; onOpen: (id: string) => void; onPickList: (list: string) => void;
}) {
  const q = useQuery({
    queryKey: taskKeys.overview(team),
    queryFn: () => apiClient.get<TeamOverviewData>(`/staff/tasks/overview${team ? `?team=${encodeURIComponent(team)}` : ''}`),
    staleTime: 30_000,
  });
  const space = useSpace(spaceTeam, !!spaceTeam).data;
  if (q.isPending) return <div role="status" aria-label="Loading" className="grid grid-cols-2 gap-2 sm:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-100" />)}</div>;
  if (q.isError || !q.data) {
    return (
      <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Could not load the overview.
        <button type="button" onClick={() => q.refetch()} className="ml-2 inline-flex items-center gap-1 font-medium underline"><RefreshCw aria-hidden className="h-3.5 w-3.5" />Try again</button>
      </div>
    );
  }
  const d = q.data;
  const maxStatus = Math.max(0, ...d.byStatus.map((s) => s.count));
  const maxPerson = Math.max(0, ...d.people.map((p) => p.open));
  const lists = allLists(space);
  const taskRow = (t: TeamOverviewData['late'][number], right: string) => (
    <li key={t.id}>
      <button type="button" onClick={() => onOpen(t.id)} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[13px] hover:bg-gray-50">
        <span className="shrink-0 text-gray-500">{t.code}</span>
        <span className="min-w-0 flex-1 truncate text-gray-800">{t.title}</span>
        <span className="shrink-0 text-xs text-gray-500">{right}</span>
      </button>
    </li>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <StatTile icon={ListTodo} label="Open" value={d.counts.open} tone="violet" />
        <StatTile icon={TriangleAlert} label="Late" value={d.counts.late} tone="red" />
        <StatTile icon={AlarmClock} label="Due today" value={d.counts.today} tone="amber" />
        <StatTile icon={CalendarDays} label="Next 7 days" value={d.counts.nextWeek} tone="sky" />
        <StatTile icon={CircleCheck} label="Done, last 7 days" value={d.counts.doneWeek} tone="green" />
      </div>
      {d.capped && <p className="text-xs text-gray-500">This team has a very large number of tasks, so these are the numbers for the first 5,000.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Work by status">
          {d.byStatus.length ? <div className="space-y-2.5">{d.byStatus.map((s) => <Bar key={s.status} label={s.label} count={s.count} max={maxStatus} />)}</div> : <Nothing>No open tasks.</Nothing>}
        </Card>
        <Card title="Work by person">
          {d.people.length ? (
            <div className="space-y-2.5">
              {d.people.map((p) => (
                <Bar
                  key={p.id}
                  label={<span className="flex items-center gap-1.5"><Avatar name={p.name} id={p.id} size="sm" /><span className="truncate">{p.name}</span></span>}
                  count={p.open}
                  max={maxPerson}
                  extra={p.late > 0 ? <span className="mr-1.5 text-xs font-medium text-red-600">{p.late} late</span> : null}
                />
              ))}
              {d.morePeople > 0 && <p className="text-xs text-gray-500">and {d.morePeople} more</p>}
            </div>
          ) : <Nothing>Nobody has open tasks.</Nothing>}
          {d.counts.unassigned > 0 && <p className="mt-2 text-xs text-gray-500">{d.counts.unassigned} with nobody on them</p>}
        </Card>
        <Card title="Late">
          {d.late.length ? <ul>{d.late.map((t) => taskRow(t, t.dueOn ? formatDueKey(t.dueOn) : ''))}</ul> : <Nothing>Nothing is late.</Nothing>}
        </Card>
        <Card title="Recently done">
          {d.recentDone.length ? <ul>{d.recentDone.map((t) => taskRow(t, ''))}</ul> : <Nothing>Nothing finished yet.</Nothing>}
        </Card>
        {lists.length > 0 && (
          <Card title="Lists" className="md:col-span-2">
            <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {lists.map((l) => (
                <li key={l.id}>
                  <button type="button" onClick={() => onPickList(l.id)} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[13px] text-gray-800 hover:bg-gray-50">
                    <span className="min-w-0 flex-1 truncate">{l.name}</span>
                    <span className="shrink-0 text-xs text-gray-500">{l.open} open</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
