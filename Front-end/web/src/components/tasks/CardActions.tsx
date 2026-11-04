'use client';

/**
 * The small square buttons along the bottom of a board card, ClickUp-style:
 * due date, priority, people and "move to". Each one changes the task in place
 * through the server (useQuickEdit / the board's move); none of them opens the
 * task. A button with nothing set yet only shows on hover or keyboard focus
 * (`.tk-qa[data-empty]` in tasks.css), so a quiet card stays quiet.
 *
 * Every click and key inside is stopped here: the card itself is a button that
 * opens the task, and React passes events from a portal up to it too.
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRightLeft, CalendarDays, Check, Flag, UserPlus } from 'lucide-react';
import AssigneePicker, { placePopover } from './AssigneePicker';
import { useAssignees } from './TaskForm';
import { AvatarStack, PRIORITY_STYLE, StatusDot } from './ui';
import { MAX_ASSIGNEES, TASK_PRIORITIES, TASK_STATUSES, formatDue, formatDueTime, peopleOf, type Task, type TaskPriority, type TaskStatus } from './types';
import type { QuickEdit } from './hooks';

const stop = (e: SyntheticEvent) => e.stopPropagation();
const qa = 'tk-qa relative inline-flex h-6 min-w-6 shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-md px-1 text-[11px] font-semibold';

/** A short menu in a pop-over beside its button (a portal, so a scrolling column never cuts it off). */
function CardMenu<V extends string>({ label, title, empty, tone, trigger, options, value, onPick, disabled }: {
  label: string; title: string; empty?: boolean; tone?: string; trigger: ReactNode; disabled?: boolean;
  options: { value: V; label: string; icon: ReactNode }[]; value: V; onPick: (v: V) => void;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = (refocus = true) => { setOpen(false); if (refocus) button.current?.focus(); };

  useEffect(() => {
    if (!open) return undefined;
    const r = button.current?.getBoundingClientRect();
    if (r) setPlace(placePopover(r, 'left', window.innerWidth, window.innerHeight));
    const away = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    // The column scrolls under a fixed pop-over: close rather than float away from the card.
    const gone = () => setOpen(false);
    document.addEventListener('mousedown', away);
    window.addEventListener('scroll', gone, true);
    window.addEventListener('resize', gone);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('scroll', gone, true);
      window.removeEventListener('resize', gone);
    };
  }, [open]);
  // Focus the ticked item when it opens.
  useEffect(() => {
    if (open && place) menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [open, place]);

  const onMenuKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(at + 1) % items.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
    if (e.key === 'Tab') close(false);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onKeyDown={stop}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={title}
        data-empty={empty || undefined}
        data-tone={tone}
        className={qa}
      >
        {trigger}
      </button>
      {open && place && createPortal(
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          style={place}
          onClick={stop}
          onMouseDown={stop}
          onKeyDown={onMenuKey}
          // In the panel's and the Tasks style scopes, so it matches them.
          className="panel-theme admin-panel tk-theme fixed z-[60] w-44 rounded-lg border border-gray-200 bg-white p-1 shadow-xl"
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              onClick={() => { close(); if (o.value !== value) onPick(o.value); }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-gray-800 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
            >
              {o.icon}<span className="flex-1">{o.label}</span>
              {o.value === value && <Check aria-hidden className="h-3.5 w-3.5 text-blue-600" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

/** Due date: the day (red when late, amber today); a click opens the date picker. */
export function QuickDate({ t, onSave, busy }: { t: Task; onSave: (patch: QuickEdit) => void; busy: boolean }) {
  const done = t.status === 'done';
  const tone = done ? undefined : t.overdue ? 'late' : t.dueToday ? 'today' : undefined;
  const time = formatDueTime(t.dueTime);
  const text = t.dueOn ? (!done && t.dueToday ? `Today${time ? ` ${time}` : ''}` : formatDue(t.dueOn, t.dueTime)) : null;
  return (
    <span title={t.dueOn ? `Due ${formatDue(t.dueOn, t.dueTime)}` : 'No due date'} data-empty={!t.dueOn || undefined} data-tone={tone} className={`${qa} ${text ? 'px-1.5' : ''}`}>
      <CalendarDays aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {text ?? <span className="sr-only">No due date</span>}
      {t.can.edit && (
        <input
          type="date"
          aria-label={`Due date for ${t.code}`}
          value={t.dueOn ?? ''}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            // Opens the calendar from anywhere on the button (not only its corner icon).
            try { e.currentTarget.showPicker?.(); } catch { /* older browser: the field still takes typing */ }
          }}
          onKeyDown={stop}
          onChange={(e) => { if ((e.target.value || null) !== t.dueOn) onSave({ dueOn: e.target.value || null }); }}
          className="tk-qa-date absolute inset-0 h-full! min-h-0! w-full cursor-pointer opacity-0"
        />
      )}
    </span>
  );
}

const PRIORITY_OPTIONS = TASK_PRIORITIES.map((p) => ({
  value: p.value,
  label: p.label,
  icon: <Flag aria-hidden className={`h-3.5 w-3.5 ${PRIORITY_STYLE[p.value].flag}`} fill={p.value === 'urgent' || p.value === 'high' ? 'currentColor' : 'none'} />,
}));

/** Priority: a coloured flag when raised; "normal" is the empty state. */
export function QuickPriority({ t, onSave, busy }: { t: Task; onSave: (patch: QuickEdit) => void; busy: boolean }) {
  const s = PRIORITY_STYLE[t.priority];
  const flag = <Flag aria-hidden className={`h-3.5 w-3.5 ${t.priority === 'normal' ? '' : s.flag}`} fill={t.priority === 'urgent' || t.priority === 'high' ? 'currentColor' : 'none'} />;
  const name = <span className="sr-only">{s.label} priority</span>;
  if (!t.can.edit) {
    return <span title={`${s.label} priority`} data-empty={t.priority === 'normal' || undefined} className={qa}>{flag}{name}</span>;
  }
  return (
    <CardMenu<TaskPriority>
      label={`Priority of ${t.code}`}
      title={`${s.label} priority`}
      empty={t.priority === 'normal'}
      trigger={<>{flag}{name}</>}
      options={PRIORITY_OPTIONS}
      value={t.priority}
      disabled={busy}
      onPick={(priority) => onSave({ priority })}
    />
  );
}

const STATUS_OPTIONS = TASK_STATUSES.map((s) => ({ value: s.value, label: s.label, icon: <StatusDot status={s.value} /> }));

/** Move to another status without dragging (the phone keeps its "Move to" picker). */
export function QuickMove({ t, status, onMove, busy }: { t: Task; status: TaskStatus; onMove: (s: TaskStatus) => void; busy: boolean }) {
  if (!t.can.status) return null;
  return (
    <span className="hidden md:contents">
      <CardMenu<TaskStatus>
        label={`Move ${t.code} to`}
        title="Move to…"
        empty
        trigger={<ArrowRightLeft aria-hidden className="h-3.5 w-3.5" />}
        options={STATUS_OPTIONS}
        value={status}
        disabled={busy}
        onPick={onMove}
      />
    </span>
  );
}

/** Who does it: the faces; whoever may reassign gets the people picker. Saved once, when it closes. */
export function QuickPeople({ t, onSave, busy }: { t: Task; onSave: (patch: QuickEdit) => void; busy: boolean }) {
  const people = peopleOf(t);
  const choices = useAssignees().data?.people ?? [];
  const ids = people.map((p) => p.id);
  const [draft, setDraft] = useState<string[] | null>(null);
  if (!t.can.reassign || !choices.length) return <AvatarStack people={people} size="sm" />;
  const done = () => {
    const next = draft;
    setDraft(null);
    if (!next || (next.length === ids.length && next.every((id) => ids.includes(id)))) return;
    // Keep at least one person: an empty pick changes nothing.
    if (next.length) onSave({ assigneeIds: next });
  };
  return (
    <span onClick={stop} onKeyDown={stop} className="inline-flex">
      <AssigneePicker
        people={choices}
        selected={draft ?? ids}
        onChange={setDraft}
        onDone={done}
        max={MAX_ASSIGNEES}
        label="Assignees"
        triggerLabel={`Who does ${t.code}`}
        disabled={busy}
        trigger={(
          <span className="group/people inline-flex items-center gap-1 rounded-md p-0.5 hover:bg-gray-100">
            <AvatarStack people={people} size="sm" />
            <UserPlus aria-hidden className="hidden h-3.5 w-3.5 text-gray-400 opacity-0 md:block transition-opacity group-hover/people:opacity-100 group-focus-visible/people:opacity-100" />
          </span>
        )}
      />
    </span>
  );
}
