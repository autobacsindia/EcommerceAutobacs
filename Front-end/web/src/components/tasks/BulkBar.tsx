'use client';

import { useRef, useState } from 'react';
import { Archive, CalendarClock, CircleDot, Flag, Tag, User, X } from 'lucide-react';
import { useAssignees } from './TaskForm';
import { useBulkUpdate } from './hooks';
import {
  BULK_MAX, TASK_PRIORITIES, TASK_STATUSES, cleanTag, isPastDay, personLabel,
  type BulkChange, type Task, type TaskPriority, type TaskStatus,
} from './types';

/*
  The bar is dark on the light theme and light on the dark one (the panel
  inverts the gray ramp and `white`), so its controls carry no colour of their
  own: transparent, inheriting the bar's ink. `!` beats the panel's
  `.admin-panel select/input` rule, written out in full for Tailwind.
*/
const control = 'h-8 cursor-pointer rounded-lg border-0! bg-transparent! pl-1 pr-6 text-sm font-medium text-inherit! hover:bg-white/10! focus:outline-none focus:ring-2 focus:ring-white/40';
const action = 'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium hover:bg-white/10 disabled:opacity-40';

/** Open a date input's picker; older browsers without showPicker() get focus + click. */
function openPicker(el: HTMLInputElement | null) {
  if (!el) return;
  try { el.showPicker(); } catch { el.focus(); el.click(); }
}

/**
 * "3 selected": change status, person, due date, priority or tags of every ticked
 * task in one go, or archive them. Each change goes at once; the server checks
 * every task on its own and the toast says which were refused and why.
 */
export default function BulkBar({ tasks, onClear, canChangeAssignee }: { tasks: Task[]; onClear: () => void; canChangeAssignee: boolean }) {
  const bulk = useBulkUpdate();
  const people = useAssignees();
  const [tagging, setTagging] = useState(false);
  const [tag, setTag] = useState('');
  const dateRef = useRef<HTMLInputElement>(null);
  if (tasks.length === 0) return null;

  const tooMany = tasks.length > BULK_MAX;
  const busy = bulk.isPending || tooMany;
  const apply = (changes: BulkChange) => bulk.mutate({ tasks, changes }, {
    onSuccess: (res) => { if (res.failed === 0 && changes.archived) onClear(); },
  });
  const addTag = () => {
    const clean = cleanTag(tag);
    if (clean) apply({ addTags: [clean] });
    setTag('');
    setTagging(false);
  };
  const n = tasks.length;

  return (
    <div
      role="toolbar"
      aria-label={`${n} selected task${n === 1 ? '' : 's'}`}
      // One row everywhere: on a phone it swipes sideways rather than stacking over the list.
      className="pn-pop fixed inset-x-3 bottom-4 z-40 mx-auto flex max-w-fit items-center gap-1 overflow-x-auto whitespace-nowrap rounded-2xl [scrollbar-width:none] [&>*]:shrink-0 bg-gray-900 px-2 py-1.5 text-white shadow-2xl sm:bottom-6"
    >
      <span className="px-2 text-sm font-semibold">{n} selected</span>
      {tooMany && <span className="px-2 text-xs">Pick at most {BULK_MAX} at a time.</span>}
      <span aria-hidden className="mx-1 h-5 w-px bg-white/20" />

      <label className="inline-flex items-center gap-1 rounded-lg pl-2 hover:bg-white/10" title="Status">
        <CircleDot aria-hidden className="h-4 w-4" />
        <select value="" disabled={busy} onChange={(e) => apply({ status: e.target.value as TaskStatus })} aria-label="Set status" className={control}>
          <option value="" disabled>Status</option>
          {TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>

      {canChangeAssignee && (
        <label className="inline-flex items-center gap-1 rounded-lg pl-2 hover:bg-white/10" title="Give to">
          <User aria-hidden className="h-4 w-4" />
          <select value="" disabled={busy} onChange={(e) => apply({ assigneeId: e.target.value })} aria-label="Give to" className={`${control} max-w-[9rem]`}>
            <option value="" disabled>Person</option>
            {(people.data?.people ?? []).map((p) => <option key={p.id} value={p.id}>{personLabel(p)}</option>)}
          </select>
        </label>
      )}

      <span className="relative inline-flex">
        <button type="button" disabled={busy} onClick={() => openPicker(dateRef.current)} className={action}><CalendarClock aria-hidden className="h-4 w-4" /> Due</button>
        {/* The browser's own date picker, opened by the button; invisible itself. */}
        <input
          ref={dateRef}
          type="date"
          tabIndex={-1}
          aria-label="Set due date"
          onChange={(e) => {
            const v = e.target.value;
            e.target.value = '';
            if (!v) return;
            if (isPastDay(v) && !window.confirm('This date has already passed, so these tasks will show as late. Use it anyway?')) return;
            apply({ dueOn: v });
          }}
          className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0"
        />
      </span>

      <label className="inline-flex items-center gap-1 rounded-lg pl-2 hover:bg-white/10" title="Priority">
        <Flag aria-hidden className="h-4 w-4" />
        <select value="" disabled={busy} onChange={(e) => apply({ priority: e.target.value as TaskPriority })} aria-label="Set priority" className={control}>
          <option value="" disabled>Priority</option>
          {TASK_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>

      {tagging ? (
        <form onSubmit={(e) => { e.preventDefault(); addTag(); }} className="inline-flex items-center gap-1 px-1">
          <input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setTagging(false); setTag(''); } }}
            onBlur={() => { if (!tag.trim()) setTagging(false); }}
            autoFocus
            maxLength={30}
            placeholder="tag, then Enter"
            aria-label="Tag to add"
            className="h-8 w-32 rounded-lg border-0! bg-white/15! px-2 text-sm text-inherit! placeholder:opacity-60 focus:outline-none"
          />
        </form>
      ) : (
        <button type="button" disabled={busy} onClick={() => setTagging(true)} className={action}><Tag aria-hidden className="h-4 w-4" /> Tag</button>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => { if (window.confirm(`Archive ${n} task${n === 1 ? '' : 's'}? They can be restored from the task page.`)) apply({ archived: true }); }}
        className={action}
      >
        <Archive aria-hidden className="h-4 w-4" /> Archive
      </button>
      <button type="button" onClick={onClear} aria-label="Clear selection" title="Clear selection" className="ml-1 rounded-lg p-1.5 hover:bg-white/10"><X className="h-4 w-4" /></button>
    </div>
  );
}
