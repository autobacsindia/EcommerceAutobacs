'use client';

/**
 * The morning pop-up: "please update your work" (Back-end
 * services/projectReminderService.js). Shown on any panel page from 09:30 IST
 * until "Got it", to everyone on a project with something overdue, due today,
 * due in the next two days or (Mondays) without a date — plus, for owners,
 * their projects and who has late work on them, and for the admin, everyone
 * with late work. The server decides who gets it, skips Sundays and holidays,
 * and remembers "Got it", so it comes once a day on every device.
 */
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CalendarDays, CalendarX2, FolderKanban, TriangleAlert, UserX } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { Dialog } from './Overlays';
import { projectDot } from './ProjectPicker';
import { formatDueDay, type LatePerson, type ProjectReminder, type ReminderItem } from './types';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lateLabel = (days: number) => (days > 0 ? `${plural(days, 'day')} late` : '');
const lastUpdateLabel = (iso: string | null) =>
  (iso ? `last update ${new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}` : 'no update yet');

/** One of my tasks: title (opens it), its project, and how late / when due. */
function MineRow({ t, tasksHref, onGo, tone }: { t: ReminderItem; tasksHref: string; onGo: () => void; tone: string }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-sm ${projectDot(t.project.colour)}`} />
      <span className="min-w-0 flex-1">
        <Link href={`${tasksHref}/${encodeURIComponent(t.id)}`} onClick={onGo} className="font-medium text-gray-900 hover:text-blue-700 hover:underline">
          {t.title}
        </Link>
        <span className="block truncate text-xs text-gray-500">
          {t.project.name}
          {t.daysLate > 0 && <span className={`font-medium ${tone}`}> · {lateLabel(t.daysLate)}</span>}
          {t.daysLate === 0 && t.dueOn && <> · due {formatDueDay(t.dueOn)}</>}
        </span>
      </span>
    </li>
  );
}

function Section({ title, icon: Icon, tone, items, total, tasksHref, onGo }: {
  title: string; icon: typeof TriangleAlert; tone: string; items: ReminderItem[]; total: number; tasksHref: string; onGo: () => void;
}) {
  if (!items.length) return null;
  return (
    <section className="px-4 py-3">
      <h3 className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${tone}`}>
        <Icon aria-hidden className="h-3.5 w-3.5" />{title} ({total})
      </h3>
      <ul className="mt-1.5 space-y-1.5 text-sm">
        {items.map((t) => <MineRow key={t.id} t={t} tasksHref={tasksHref} onGo={onGo} tone={tone} />)}
        {total > items.length && <li className="text-xs text-gray-500">and {total - items.length} more</li>}
      </ul>
    </section>
  );
}

function LatePeople({ people }: { people: LatePerson[] }) {
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-gray-700">
      {people.map((p) => (
        <li key={p.id} className="flex items-start gap-1.5">
          <UserX aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
          <span className="min-w-0">
            <span className="font-medium">{p.name || 'Someone'}</span>: {plural(p.late, 'late item')} (up to {plural(p.daysLate, 'day')}) · {lastUpdateLabel(p.lastUpdate)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function ProjectReminderPopup({ tasksHref }: { tasksHref: string }) {
  const queryClient = useQueryClient();
  const [closedDay, setClosedDay] = useState<string | null>(null);
  const reminder = useQuery({
    queryKey: taskKeys.projectReminder(),
    queryFn: () => apiClient.get<{ reminder: ProjectReminder | null }>('/staff/tasks/projects/reminder').then((r) => r.reminder),
    // Asked again now and then, so 09:30 arrives while the panel is open.
    refetchInterval: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const dismiss = useMutation({
    mutationFn: (day: string) => apiClient.post('/staff/tasks/projects/reminder/dismiss', { day }),
    onSettled: () => queryClient.setQueryData(taskKeys.projectReminder(), null),
  });
  const r = reminder.data;
  const open = !!r && closedDay !== r.day;
  const gotIt = () => {
    if (!r) return;
    setClosedDay(r.day);
    dismiss.mutate(r.day);
  };

  const c = r?.mine?.counts;
  const urgent = !!c && c.overdue > 0;
  const heading = c?.overdue
    ? `${plural(c.overdue, 'item')} overdue — please update`
    : c?.today ? `${plural(c.today, 'item')} due today — please update` : 'Your projects today';

  return (
    <Dialog open={open} onClose={gotIt} label="Your projects today">
      {r && (
        <div className="flex max-h-[80vh] flex-col overflow-hidden rounded-xl bg-white shadow-xl">
          <div className={`border-b px-4 py-3 ${urgent ? 'border-red-100 bg-red-50' : 'border-gray-100'}`}>
            <h2 className="flex items-center gap-2 font-semibold text-gray-900">
              {urgent
                ? <TriangleAlert aria-hidden className="h-5 w-5 text-red-600" />
                : <FolderKanban aria-hidden className="h-5 w-5 text-blue-600" />}
              {heading}
            </h2>
            <p className="mt-0.5 text-sm text-gray-600">
              Open each one and move it on, change its date, or mark it done.
            </p>
          </div>
          <div className="divide-y divide-gray-100 overflow-y-auto">
            {c && (
              <>
                <Section title="Overdue" icon={TriangleAlert} tone="text-red-700" items={r.mine.overdue} total={c.overdue} tasksHref={tasksHref} onGo={gotIt} />
                <Section title="Due today" icon={CalendarClock} tone="text-amber-800" items={r.mine.today} total={c.today} tasksHref={tasksHref} onGo={gotIt} />
                <Section title="Due in the next 2 days" icon={CalendarDays} tone="text-blue-800" items={r.mine.soon} total={c.soon} tasksHref={tasksHref} onGo={gotIt} />
                {r.weekly && (
                  <Section title="No due date — add one" icon={CalendarX2} tone="text-gray-700" items={r.mine.noDate} total={c.noDate} tasksHref={tasksHref} onGo={gotIt} />
                )}
              </>
            )}

            {r.deadlines?.length > 0 && (
              <section className="px-4 py-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">Project deadlines</h3>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {r.deadlines.map((d) => (
                    <li key={d.id} className="flex items-center gap-2">
                      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-sm ${projectDot(d.colour)}`} />
                      <Link href={`${tasksHref}?view=project&project=${encodeURIComponent(d.id)}`} onClick={gotIt} className="min-w-0 truncate font-medium text-gray-900 hover:text-blue-700 hover:underline">{d.name}</Link>
                      <span className={`shrink-0 text-xs ${d.daysLate ? 'font-medium text-red-700' : 'text-amber-800'}`}>
                        {d.daysLate ? `deadline ${lateLabel(d.daysLate)}` : d.dueOn === r.day ? 'deadline today' : `deadline ${formatDueDay(d.dueOn)}`} · {d.open} open
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {r.projects.length > 0 && (
              <section className="py-1">
                <h3 className="px-4 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-700">Projects you own</h3>
                <ul className="divide-y divide-gray-100">
                  {r.projects.map((p) => (
                    <li key={p.id} className="px-4 py-3">
                      <Link href={`${tasksHref}?view=project&project=${encodeURIComponent(p.id)}`} onClick={gotIt} className="flex items-center gap-2 font-medium text-gray-900 hover:text-blue-700 hover:underline">
                        <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-sm ${projectDot(p.colour)}`} />
                        <span className="min-w-0 truncate">{p.name}</span>
                      </Link>
                      <p className="mt-0.5 text-xs text-gray-600">
                        {plural(p.open, 'open task')}
                        {p.late > 0 && <span className="font-medium text-red-700"> · {p.late} late</span>}
                        {p.dueToday > 0 && <span className="font-medium text-amber-800"> · {p.dueToday} due today</span>}
                        {p.projectLate && <span className="font-medium text-red-700"> · past its deadline</span>}
                        {p.projectDueToday && <span className="font-medium text-amber-800"> · deadline today</span>}
                      </p>
                      {(p.lateTasks.length > 0 || p.dueTodayTasks.length > 0) && (
                        <ul className="mt-1.5 space-y-1 text-sm">
                          {p.lateTasks.map((t) => (
                            <li key={t.id} className="flex items-start gap-1.5 text-red-800">
                              <TriangleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span className="min-w-0"><span className="font-medium">Late:</span> {t.title}</span>
                            </li>
                          ))}
                          {p.dueTodayTasks.map((t) => (
                            <li key={t.id} className="flex items-start gap-1.5 text-amber-900">
                              <CalendarClock aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span className="min-w-0"><span className="font-medium">Due today:</span> {t.title}</span>
                            </li>
                          ))}
                          {p.late + p.dueToday > p.lateTasks.length + p.dueTodayTasks.length && (
                            <li className="text-xs text-gray-500">and {p.late + p.dueToday - p.lateTasks.length - p.dueTodayTasks.length} more</li>
                          )}
                        </ul>
                      )}
                      {p.notUpdated?.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs font-semibold text-gray-700">Not updated</p>
                          <LatePeople people={p.notUpdated} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {r.team?.length > 0 && (
              <section className="px-4 py-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">Late work across projects</h3>
                <LatePeople people={r.team} />
              </section>
            )}

            {c && c.later > 0 && (
              <p className="px-4 py-2 text-xs text-gray-500">{plural(c.later, 'more task')} due later — nothing to do yet.</p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-gray-100 px-4 py-3">
            <Link href={`${tasksHref}?view=projects`} onClick={gotIt} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">Open projects</Link>
            <button onClick={gotIt} autoFocus className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">Got it</button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
