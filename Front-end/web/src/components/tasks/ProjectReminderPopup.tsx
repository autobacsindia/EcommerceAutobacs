'use client';

/**
 * The project owner's daily pop-up: "your projects today — open, due today,
 * late" (Back-end services/projectReminderService.js). Shown on any panel page
 * from 10:00 IST until "Got it"; the server decides who gets it and whether
 * today's was already dismissed, so it comes once a day on every device.
 */
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, FolderKanban, TriangleAlert } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { Dialog } from './Overlays';
import { projectDot } from './ProjectPicker';
import type { ProjectReminder } from './types';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function ProjectReminderPopup({ tasksHref }: { tasksHref: string }) {
  const queryClient = useQueryClient();
  const [closedDay, setClosedDay] = useState<string | null>(null);
  const reminder = useQuery({
    queryKey: taskKeys.projectReminder(),
    queryFn: () => apiClient.get<{ reminder: ProjectReminder | null }>('/staff/tasks/projects/reminder').then((r) => r.reminder),
    // Asked again now and then, so 10:00 arrives while the panel is open.
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

  return (
    <Dialog open={open} onClose={gotIt} label="Your projects today">
      {r && (
        <div className="flex max-h-[80vh] flex-col overflow-hidden rounded-xl bg-white shadow-xl">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="flex items-center gap-2 font-semibold text-gray-900"><FolderKanban aria-hidden className="h-5 w-5 text-blue-600" />Your projects today</h2>
            <p className="mt-0.5 text-sm text-gray-600">
              {plural(r.totals.open, 'task')} open
              {r.totals.dueToday > 0 && <> · <span className="font-medium text-amber-800">{r.totals.dueToday} due today</span></>}
              {r.totals.late > 0 && <> · <span className="font-medium text-red-700">{r.totals.late} late</span></>}
            </p>
          </div>
          <ul className="divide-y divide-gray-100 overflow-y-auto">
            {r.projects.map((p) => (
              <li key={p.id} className="px-4 py-3">
                <Link href={`${tasksHref}?view=project&project=${encodeURIComponent(p.id)}`} onClick={gotIt} className="flex items-center gap-2 font-medium text-gray-900 hover:text-blue-700 hover:underline">
                  <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-sm ${projectDot(p.colour)}`} />
                  <span className="min-w-0 truncate">{p.name}</span>
                </Link>
                <p className="mt-0.5 text-xs text-gray-600">
                  {plural(p.open, 'open task')}
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
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 border-t border-gray-100 px-4 py-3">
            <Link href={`${tasksHref}?view=projects`} onClick={gotIt} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">Open projects</Link>
            <button onClick={gotIt} autoFocus className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">Got it</button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
