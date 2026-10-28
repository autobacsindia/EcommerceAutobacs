import { CalendarClock } from 'lucide-react';
import { formatDueDay, type Task } from './types';

/** "Late · 21 Oct" in red, "Today · 28 Oct" in amber, otherwise the plain due day. */
export function DueLabel({ t }: { t: Task }) {
  if (!t.dueOn) return null;
  const tone = t.overdue ? 'text-red-600 font-semibold' : t.dueToday ? 'text-amber-700 font-semibold' : 'text-gray-500';
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${tone}`}>
      <CalendarClock className="h-3.5 w-3.5" />
      {t.overdue ? 'Late · ' : t.dueToday ? 'Today · ' : ''}{formatDueDay(t.dueOn)}
    </span>
  );
}
