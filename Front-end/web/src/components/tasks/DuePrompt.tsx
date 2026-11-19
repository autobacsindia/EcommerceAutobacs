'use client';

/**
 * "When will this be done?" — asked when a task with no due date moves out of
 * To Do (the owner's rule, 2026-11; the server's is dueRequired in
 * Back-end/server/services/staffTaskService.js):
 *
 *   - Tasks panel (no project): To Do is the backlog and may wait for a date;
 *     In progress or Complete needs one. The move goes ahead only once a date
 *     is picked, sent with the move in one change. Cancel leaves it in To Do.
 *   - In a project the date is always optional: nothing is asked.
 *
 * The server refuses a move without a date anyway; this only asks first, so
 * nobody drags a card to have it bounce back.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays } from 'lucide-react';
import { Dialog } from './Overlays';
import { DEFAULT_TASK_RULES, DueRuleHint, dueCheck, useTaskRules } from './dueRules';
import type { TaskPriority, TaskStatus } from './types';

/** Must a task with this status, in (or out of) a project, have a due date? */
export const dueRequired = (status: TaskStatus, inProject: boolean) => !inProject && status !== 'todo';

type Movable = { code: string; title: string; dueOn: string | null; project?: string | null; priority?: TaskPriority; personal?: boolean };

/** Would moving `t` to `status` need a date it doesn't have? `inProject` defaults to the task's own project. */
export const needsDueFor = (t: Movable, status: TaskStatus, inProject = !!t.project) => !t.dueOn && dueRequired(status, inProject);

type Ask = { t: Movable; to: string; go: (dueOn: string) => void };

/**
 * `guard(t, status, label, go)` runs `go({})` straight away when no date is
 * needed, else asks for one and runs `go({ dueOn })` once it is picked. Render
 * `prompt` once in the component.
 */
export function useAskDue() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const guard = (t: Movable, status: TaskStatus, label: string, go: (extra: { dueOn?: string }) => void, inProject?: boolean) => {
    if (!needsDueFor(t, status, inProject)) { go({}); return; }
    setAsk({ t, to: label, go: (dueOn) => go({ dueOn }) });
  };
  // On the page itself (not inside the row or card that asked), and its clicks and keys stay
  // its own: React passes events up through a portal, and a row opens its task on a click.
  const prompt = ask && typeof document !== 'undefined' ? createPortal(
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Dialog open onClose={() => setAsk(null)} label="When will this be done?">
        <DueForm key={ask.t.code} ask={ask} onClose={() => setAsk(null)} />
      </Dialog>
    </div>,
    document.body,
  ) : null;
  return { guard, prompt, asking: !!ask };
}

function DueForm({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  const [dueOn, setDueOn] = useState('');
  const rules = useTaskRules().data ?? DEFAULT_TASK_RULES;
  const priority = ask.t.priority ?? 'normal';
  const tooLate = !!dueCheck(dueOn, priority, rules).tooLate;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!dueOn || tooLate) return;
        onClose();
        ask.go(dueOn);
      }}
      className="mx-auto max-w-sm space-y-3 rounded-xl bg-white p-4 shadow-xl"
    >
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900"><CalendarDays aria-hidden className="h-4 w-4 text-blue-600" /> When will this be done?</h2>
        <p className="mt-1 text-sm text-gray-600">
          <span className="font-mono text-xs text-gray-500">{ask.t.code}</span> {ask.t.title} needs a due date to move to <strong>{ask.to}</strong>.
        </p>
      </div>
      <input
        type="date"
        autoFocus
        required
        aria-label="Due date"
        value={dueOn}
        onChange={(e) => setDueOn(e.target.value)}
        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
      />
      <DueRuleHint dueOn={dueOn} priority={priority} personal={!!ask.t.personal} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
        <button type="submit" disabled={!dueOn || tooLate} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Move to {ask.to}</button>
      </div>
    </form>
  );
}
