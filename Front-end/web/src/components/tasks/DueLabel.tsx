import { CalendarClock, ListChecks } from 'lucide-react';
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

/** "2/5" checklist progress on a card, green once every step is ticked. */
export function ChecklistChip({ t }: { t: Task }) {
  const { done, total } = t.checklist ?? { done: 0, total: 0 };
  if (!total) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${done === total ? 'text-green-700' : 'text-gray-500'}`} title={`${done} of ${total} steps done`}>
      <ListChecks className="h-3.5 w-3.5" />{done}/{total}
    </span>
  );
}
