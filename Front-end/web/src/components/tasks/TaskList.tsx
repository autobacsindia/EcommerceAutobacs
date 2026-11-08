'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Ban, CalendarDays, CalendarRange, Check, ChevronDown, ChevronRight, CornerLeftUp, Flag, ListChecks, MessageSquare, Network, Package, Plus, Tag, Timer as TimerIcon, UserPlus, Users, X } from 'lucide-react';
import { errorMessage } from '@/components/staff/sales/types';
import { useQuickAdd, useQuickEdit, useSetStatus, useTaskPages, type QuickEdit, type QuickExtras } from './hooks';
import { QuickDate, QuickPeople, QuickPriority } from './CardActions';
import AssigneePicker from './AssigneePicker';
import { useAssignees } from './TaskForm';
import { groupTasks, type TaskGroup } from './grouping';
import BulkBar from './BulkBar';
import TaskMenu from './TaskMenu';
import { Avatar, AvatarStack, Chip, DuePill, GroupCount, GroupPill, PRIORITY_STYLE, PriorityFlag, STATUS_STYLE, SkeletonRows, TagChip } from './ui';
import {
  MAX_ASSIGNEES, TASK_PRIORITIES, TAGS_MAX, cleanTag, confirmComplete, formatDueDay, formatDuration, listOf, newClientId, peopleOf,
  type Task, type TaskFilters, type TaskGroupBy, type TaskPriority, type TaskStatus,
} from './types';

/** The round tick at the start of a row: one click marks the task done (or opens it again). */
export function CompleteButton({ t, onToggle, busy }: { t: Task; onToggle: () => void; busy: boolean }) {
  const done = t.status === 'done';
  if (!t.can.status) {
    return <span aria-hidden className={`h-[18px] w-[18px] shrink-0 rounded-full border-2 ${done ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300'}`} />;
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      onKeyDown={(e) => e.stopPropagation()}
      disabled={busy}
      aria-label={done ? `Open ${t.code} again` : `Mark ${t.code} complete`}
      title={done ? 'Open again' : 'Mark complete'}
      data-status={t.status}
      className={`tk-tick flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
        done ? 'border-emerald-500 bg-emerald-500 text-white' : `${STATUS_RING[t.status]} text-transparent hover:border-emerald-500 hover:text-emerald-500`
      }`}
    >
      <Check className="h-3 w-3" strokeWidth={3} />
    </button>
  );
}
/** The tick's ring takes the status colour, so a row says where it stands at a glance. */
const STATUS_RING: Record<TaskStatus, string> = {
  todo: 'border-gray-300', in_progress: 'border-sky-500', done: 'border-emerald-500',
};

/**
 * Small facts beside a title: the parent it belongs to, its sub-tasks, shared,
 * checklist, comments, start date (and, on cards, the order).
 */
export function TaskMeta({ t, withOrder = true, withComments = true }: { t: Task; withOrder?: boolean; withComments?: boolean }) {
  const subs = t.subtasks?.total ?? 0;
  return (
    <>
      {t.parent && (
        <Chip title={`A sub-task of ${t.parent.code} ${t.parent.title}`}>
          <CornerLeftUp aria-hidden className="h-3 w-3 shrink-0" /><span className="max-w-[11rem] truncate">in {t.parent.code} {t.parent.title}</span>
        </Chip>
      )}
      {(t.waitingOn ?? 0) > 0 && t.bucket === 'open' && (
        <Chip tone="bg-amber-100 text-amber-900" title={`Waiting on ${t.waitingOn} unfinished task${t.waitingOn === 1 ? '' : 's'}`}>
          <Ban aria-hidden className="h-3 w-3" />Waiting
        </Chip>
      )}
      {subs > 0 && (
        <Chip tone={t.subtasks!.done === subs ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'} title={`${t.subtasks!.done} of ${subs} sub-tasks done`}>
          <Network aria-hidden className="h-3 w-3" />{t.subtasks!.done}/{subs}
        </Chip>
      )}
      {t.group && <Chip tone="bg-purple-100 text-purple-800" title={`Given to ${t.group.size} people`}><Users aria-hidden className="h-3 w-3" />{t.group.size}</Chip>}
      {t.checklist?.total > 0 && (
        <Chip tone={t.checklist.done === t.checklist.total ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'} title={`${t.checklist.done} of ${t.checklist.total} steps done`}>
          <ListChecks aria-hidden className="h-3 w-3" />{t.checklist.done}/{t.checklist.total}
        </Chip>
      )}
      {withComments && t.commentCount > 0 && <Chip title={`${t.commentCount} comments`}><MessageSquare aria-hidden className="h-3 w-3" />{t.commentCount}</Chip>}
      {t.startOn && t.bucket === 'open' && (
        <Chip title={`Starts ${formatDueDay(t.startOn)}`}><CalendarRange aria-hidden className="h-3 w-3" />{formatDueDay(t.startOn)}</Chip>
      )}
      {(t.timeSeconds ?? 0) > 0 && (
        <Chip title={`${formatDuration(t.timeSeconds!)} tracked`}><TimerIcon aria-hidden className="h-3 w-3" />{formatDuration(t.timeSeconds!)}</Chip>
      )}
      {withOrder && t.order && <Chip tone="bg-sky-100 text-sky-800" title={`Order ${t.order.code}`}><Package aria-hidden className="h-3 w-3" />{t.order.code}</Chip>}
    </>
  );
}

/** Up to two tags, then "+n". */
export function TagList({ tags, onTag, activeTag, max = 2 }: { tags: string[]; onTag?: (tag: string) => void; activeTag?: string; max?: number }) {
  if (!tags?.length) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {tags.slice(0, max).map((tag) => <TagChip key={tag} tag={tag} active={tag === activeTag} onClick={onTag ? () => onTag(tag) : undefined} />)}
      {tags.length > max && <span className="text-[11px] font-semibold text-gray-500" title={tags.slice(max).join(', ')}>+{tags.length - max}</span>}
    </span>
  );
}

/*
  One grid for the column headings and every row, so the columns line up. Below
  `lg` a row is the title with its facts on a second line instead.
*/
const COLUMNS = 'lg:grid lg:grid-cols-[24px_minmax(0,1fr)_140px_116px_96px] lg:items-center lg:gap-3 xl:grid-cols-[24px_minmax(0,1fr)_140px_116px_96px_minmax(0,170px)]';
/** The same, with an Order column — only for a group where some task has an order. */
const COLUMNS_ORDER = 'lg:grid lg:grid-cols-[24px_minmax(0,1fr)_140px_116px_96px] lg:items-center lg:gap-3 xl:grid-cols-[24px_minmax(0,1fr)_140px_116px_96px_minmax(0,150px)_96px]';
/** Tags and order get their own columns only on a wide screen; in between they sit beside the title. */
const WIDE = 'hidden xl:block';
/** A column heading with its icon, ClickUp-style. */
const HEAD = 'items-center gap-1.5 [&>svg]:shrink-0 [&>svg]:text-gray-400 lg:inline-flex';
const HEAD_WIDE = 'hidden items-center gap-1.5 [&>svg]:shrink-0 [&>svg]:text-gray-400 xl:inline-flex';

function SelectBox({ checked, onChange, label, mixed = false }: { checked: boolean; onChange: (on: boolean) => void; label: string; mixed?: boolean }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(el) => { if (el) el.indeterminate = mixed && !checked; }}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
      className="h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 accent-blue-600"
    />
  );
}

function TaskRow({ t, onOpen, selected, onSelect, onTag, activeTag, withOrder, base }: {
  t: Task; onOpen: (id: string) => void; selected: boolean; onSelect: (on: boolean) => void;
  onTag?: (tag: string) => void; activeTag?: string; withOrder: boolean; base?: string;
}) {
  const move = useSetStatus();
  const edit = useQuickEdit();
  const busy = move.isPending || edit.isPending;
  const save = (patch: QuickEdit) => edit.mutate({ t, patch });
  const open = () => onOpen(t.id);
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') { e.preventDefault(); open(); }
    if (e.key === ' ') { e.preventDefault(); onSelect(!selected); }
  };
  const done = t.status === 'done';
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKey}
      aria-label={`Open ${t.code}: ${t.title}`}
      className={`tk-more-host group relative flex cursor-pointer items-start gap-3 border-t ${base ? 'pr-10' : ''} border-gray-100 px-3 py-2.5 transition-colors first:border-t-0 lg:min-h-11 lg:py-2 ${withOrder ? COLUMNS_ORDER : COLUMNS} ${
        selected ? 'bg-blue-50' : 'hover:bg-blue-50/60'
      } focus-visible:bg-blue-50 focus:outline-none`}
    >
      <span className={`mt-0.5 lg:mt-0 ${selected ? '' : 'lg:opacity-40 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100'}`}>
        <SelectBox checked={selected} onChange={onSelect} label={`Select ${t.code}`} />
      </span>
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="mt-0.5"><CompleteButton t={t} busy={move.isPending} onToggle={() => { if (done || confirmComplete(t)) move.mutate({ t, status: done ? 'todo' : 'done' }); }} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`line-clamp-2 break-words text-sm font-semibold ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{t.title}</span>
            <span className="font-mono text-[11px] text-gray-400">{t.code}</span>
            <TaskMeta t={t} withOrder={false} />
            <span className="hidden lg:contents xl:hidden">
              <TagList tags={t.tags} onTag={onTag} activeTag={activeTag} />
              {t.order && <Chip tone="bg-sky-100 text-sky-800"><Package aria-hidden className="h-3 w-3" />{t.order.code}</Chip>}
            </span>
          </div>
          {/* Phones and tablets: the columns, folded into one line. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 lg:hidden">
            <QuickPeople t={t} onSave={save} busy={busy} variant="cell" />
            <QuickDate t={t} onSave={save} busy={busy} variant="cell" />
            {(t.priority !== 'normal' || t.can.edit) && <QuickPriority t={t} onSave={save} busy={busy} variant="cell" />}
            <TagList tags={t.tags} onTag={onTag} activeTag={activeTag} />
            {t.order && <Chip tone="bg-sky-100 text-sky-800"><Package aria-hidden className="h-3 w-3" />{t.order.code}</Chip>}
          </div>
        </div>
      </div>
      {/* Like ClickUp's list: who, when and how urgent change right here, no need to open the task. */}
      <span className="hidden min-w-0 items-center lg:flex"><QuickPeople t={t} onSave={save} busy={busy} variant="cell" /></span>
      <span className="hidden min-w-0 items-center lg:flex"><QuickDate t={t} onSave={save} busy={busy} variant="cell" /></span>
      <span className="hidden min-w-0 items-center lg:flex"><QuickPriority t={t} onSave={save} busy={busy} variant="cell" /></span>
      <span className={`${WIDE} min-w-0`}><TagList tags={t.tags} onTag={onTag} activeTag={activeTag} /></span>
      {withOrder && (
        <span className={`${WIDE} truncate`}>
          {t.order && <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700"><Package aria-hidden className="h-3.5 w-3.5" />{t.order.code}</span>}
        </span>
      )}
      {base && <span className="absolute right-2 top-2 lg:top-1/2 lg:-translate-y-1/2"><TaskMenu t={t} base={base} onOpen={onOpen} /></span>}
    </li>
  );
}

const chipClass = 'inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 text-xs font-medium text-gray-600 hover:border-gray-300 hover:text-gray-900';

/**
 * The board's chips under a new task's name: who does it, the due date, the
 * priority and tags — each optional, each shown as what it is once set.
 */
function QuickChips({ extras, onChange, noPeople = false }: { extras: QuickExtras; onChange: (patch: QuickExtras) => void; noPeople?: boolean }) {
  const people = useAssignees();
  const choices = people.data?.people ?? [];
  const byId = new Map(choices.map((p) => [p.id, p]));
  const ids = extras.assigneeIds ?? [];
  const picked = ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
  const [dating, setDating] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [tag, setTag] = useState('');
  const tags = extras.tags ?? [];
  const addTag = () => {
    const clean = cleanTag(tag);
    setTag('');
    setTagging(false);
    if (clean && !tags.includes(clean) && tags.length < TAGS_MAX) onChange({ tags: [...tags, clean] });
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      {!noPeople && (
      <AssigneePicker
        people={choices}
        selected={ids}
        onChange={(next) => onChange({ assigneeIds: next })}
        max={MAX_ASSIGNEES}
        label="Assignees"
        triggerLabel={picked.length ? `Assignees: ${picked.map((p) => p.name).join(', ')}` : 'Add assignee'}
        trigger={(
          <span className={chipClass}>
            {picked.length ? <AvatarStack people={picked} /> : <><UserPlus aria-hidden className="h-3.5 w-3.5" /> Add assignee</>}
          </span>
        )}
      />
      )}
      {dating || extras.dueOn ? (
        <input
          type="date"
          value={extras.dueOn || ''}
          onChange={(e) => onChange({ dueOn: e.target.value || null })}
          onBlur={() => setDating(false)}
          autoFocus={dating && !extras.dueOn}
          aria-label="Due date"
          className="h-7 rounded-md border border-gray-200 px-1.5 text-xs"
        />
      ) : (
        <button type="button" onClick={() => setDating(true)} className={chipClass}><CalendarDays aria-hidden className="h-3.5 w-3.5" /> Add dates</button>
      )}
      <label className={`${chipClass} relative`}>
        <Flag aria-hidden className={`h-3.5 w-3.5 ${extras.priority && extras.priority !== 'normal' ? PRIORITY_STYLE[extras.priority].flag : ''}`} />
        {extras.priority && extras.priority !== 'normal' ? PRIORITY_STYLE[extras.priority].label : 'Add priority'}
        <select
          value={extras.priority ?? 'normal'}
          onChange={(e) => onChange({ priority: e.target.value as TaskPriority })}
          aria-label="Priority"
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {TASK_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>
      {tags.map((t) => (
        <span key={t} className={chipClass}>
          #{t}
          <button type="button" onClick={() => onChange({ tags: tags.filter((x) => x !== t) })} aria-label={`Remove tag ${t}`} className="-mr-1 rounded p-0.5 hover:bg-gray-100"><X aria-hidden className="h-3 w-3" /></button>
        </span>
      ))}
      {tagging ? (
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addTag(); }
            if (e.key === 'Escape') { e.stopPropagation(); setTag(''); setTagging(false); }
          }}
          onBlur={addTag}
          autoFocus
          maxLength={30}
          placeholder="Tag, then Enter"
          aria-label="New tag"
          className="h-7 w-28 rounded-md border border-gray-200 px-1.5 text-xs"
        />
      ) : tags.length < TAGS_MAX && (
        <button type="button" onClick={() => setTagging(true)} className={chipClass}><Tag aria-hidden className="h-3.5 w-3.5" /> Add tag</button>
      )}
    </div>
  );
}

/**
 * "+ Add task" at the foot of a group or column: type, Enter, keep typing;
 * Escape to stop. On the board, chips under the name set who does it, the due
 * date, the priority and tags before it is saved. One id per draft: a double
 * Enter or a retried request makes one task.
 */
export function QuickAdd({ status, assigneeId, listId, personal = false, label = 'Add task', variant = 'list' }: {
  status: TaskStatus; assigneeId?: string; label?: string; variant?: 'list' | 'board';
  /** Inside one list of a space: the new task goes in it. */
  listId?: string;
  /** In the Personal list: private, so nobody to give it to. */
  personal?: boolean;
}) {
  const add = useQuickAdd();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [extras, setExtras] = useState<QuickExtras>({});
  const clientId = useRef(newClientId());
  const board = variant === 'board';
  const stop = () => { setOpen(false); setTitle(''); setExtras({}); };
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={board
          ? 'tk-add flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-semibold'
          : 'tk-add flex w-full items-center gap-2 border-t border-gray-100 px-3 py-2 text-left text-[13px] font-medium lg:pl-[52px]'}
      >
        <Plus aria-hidden className="h-4 w-4" /> {label}
      </button>
    );
  }
  const touched = !!(title.trim() || extras.assigneeIds?.length || extras.dueOn || extras.tags?.length || (extras.priority && extras.priority !== 'normal'));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const text = title.trim();
        if (!text) return;
        add.mutate({ title: text, status, assigneeId, extras: { ...extras, ...(listId ? { listId } : {}), ...(personal ? { personal } : {}) }, clientId: clientId.current }, {
          // Ready for the next one; the people and the chips stay, the name clears.
          onSuccess: () => { setTitle(''); clientId.current = newClientId(); },
        });
      }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); stop(); } }}
      // Leaving an untouched draft closes it; one with anything in it stays.
      // A chip's pop-over lives outside the form (on the page), but is part of it.
      onBlur={(e) => {
        const to = e.relatedTarget as Element | null;
        if (!e.currentTarget.contains(to) && !to?.closest('[data-popover]') && !touched) stop();
      }}
      className={board
        ? 'tk-card space-y-2 rounded-lg bg-white p-2'
        : 'flex items-center gap-2 border-t border-gray-100 px-3 py-1.5 lg:pl-[52px]'}
    >
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          maxLength={200}
          placeholder={board ? 'Task name…' : 'Task name, then Enter'}
          aria-label={`New task in ${STATUS_STYLE[status].label}`}
          className="min-w-0 flex-1 rounded-md border border-blue-500! px-2 py-1 text-sm outline-none ring-2 ring-blue-100"
        />
        {!board && <button type="submit" disabled={add.isPending || !title.trim()} className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-40">Save</button>}
      </div>
      {board && (
        <>
          <QuickChips extras={extras} noPeople={personal} onChange={(patch) => setExtras((x) => ({ ...x, ...patch }))} />
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={stop} className="rounded-md px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
            <button type="submit" disabled={add.isPending || !title.trim()} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">Save</button>
          </div>
        </>
      )}
    </form>
  );
}

function GroupHeading({ g }: { g: TaskGroup }) {
  if (g.kind === 'status') return <GroupPill status={g.value as TaskStatus}>{g.label}</GroupPill>;
  if (g.kind === 'person') return <span className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Avatar name={g.label} id={g.value} />{g.label}</span>;
  if (g.kind === 'priority') {
    return <GroupPill><PriorityFlagIcon priority={g.value as keyof typeof PRIORITY_STYLE} />{g.label}</GroupPill>;
  }
  const tone = g.value === 'late' ? 'bg-red-100 text-red-800' : g.value === 'today' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-800';
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${tone}`}>{g.label}</span>;
}
const PriorityFlagIcon = ({ priority }: { priority: keyof typeof PRIORITY_STYLE }) => <PriorityFlag priority={priority} />;

function Group({ g, onOpen, collapsed, onToggle, quickAddFor, listId, personal, footer, selected, onSelect, onTag, activeTag, countLabel, base }: {
  g: TaskGroup; onOpen: (id: string) => void; collapsed: boolean; onToggle: () => void; base?: string;
  quickAddFor?: string | null; listId?: string; personal?: boolean; footer?: ReactNode; selected: Set<string>; onSelect: (ts: Task[], on: boolean) => void;
  onTag?: (tag: string) => void; activeTag?: string; countLabel?: string;
}) {
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const picked = g.tasks.filter((t) => selected.has(t.id)).length;
  // No task here has an order: no empty Order column.
  const withOrder = g.tasks.some((t) => !!t.order);
  return (
    <section aria-label={g.label}>
      <div className="mb-2 flex items-center gap-2 px-1">
        <button type="button" onClick={onToggle} aria-expanded={!collapsed} aria-label={`${collapsed ? 'Show' : 'Hide'} ${g.label}`} className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
          <Chevron aria-hidden className="h-4 w-4" />
        </button>
        <GroupHeading g={g} />
        <GroupCount status={g.kind === 'status' ? g.value as TaskStatus : undefined}>{countLabel ?? g.tasks.length}</GroupCount>
        {!collapsed && g.tasks.length > 0 && (
          <span className="ml-auto">
            <SelectBox checked={picked === g.tasks.length} mixed={picked > 0} onChange={(on) => onSelect(g.tasks, on)} label={`Select every task in ${g.label}`} />
          </span>
        )}
      </div>
      {!collapsed && (
        <div className="tk-sheet overflow-hidden rounded-xl bg-white">
          {g.tasks.length > 0 && (
            <div aria-hidden className={`hidden border-b border-gray-100 bg-gray-50/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500 ${withOrder ? COLUMNS_ORDER : COLUMNS}`}>
              <span /><span className="pl-7">Name</span>
              <span className={HEAD}><Users className="h-3.5 w-3.5" />Assignee</span>
              <span className={HEAD}><CalendarDays className="h-3.5 w-3.5" />Due date</span>
              <span className={HEAD}><Flag className="h-3.5 w-3.5" />Priority</span>
              <span className={HEAD_WIDE}><Tag className="h-3.5 w-3.5" />Tags</span>
              {withOrder && <span className={HEAD_WIDE}><Package className="h-3.5 w-3.5" />Order</span>}
            </div>
          )}
          <ul>
            {g.tasks.map((t) => (
              <TaskRow key={t.id} t={t} onOpen={onOpen} selected={selected.has(t.id)} onSelect={(on) => onSelect([t], on)} onTag={onTag} activeTag={activeTag} withOrder={withOrder} base={base} />
            ))}
          </ul>
          {footer}
          {quickAddFor !== null && g.addStatus && <QuickAdd status={g.addStatus} assigneeId={quickAddFor} listId={listId} personal={personal} />}
        </div>
      )}
    </section>
  );
}

/**
 * The list view: open tasks in groups (by status, person, priority or due date),
 * with columns on a wide screen, "+ Add task" in each status group, Done folded
 * at the bottom, and a bar for changing every ticked task at once.
 * `quickAddFor`: who a quick-added task goes to (undefined = me; null = no quick add).
 */
export default function TaskListView({ filters, onOpen, quickAddFor, empty, groupBy = 'status', onTag, canChangeAssignee = true, base }: {
  filters: TaskFilters; onOpen: (id: string) => void; quickAddFor?: string | null; empty: ReactNode;
  groupBy?: TaskGroupBy; onTag?: (tag: string) => void; canChangeAssignee?: boolean; base?: string;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ done: true });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const open = useTaskPages(filters, 'open');
  // A date filter is about what is still to do: no Done group then.
  const showDone = !filters.due;
  const done = useTaskPages(filters, 'done', showDone && !collapsed.done);

  if (open.isLoading) return <SkeletonRows rows={6} />;
  if (open.isError) return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage(open.error, 'Could not load tasks.')}</p>;

  const rows = open.data?.pages.flatMap((p) => p.tasks) ?? [];
  const doneRows = done.data?.pages.flatMap((p) => p.tasks) ?? [];
  const toggle = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  const narrowed = !!(filters.q || filters.due || filters.priority || filters.tag);
  // An empty status group is shown (for its "+ Add task") only while the list has rows and is not narrowed.
  const groups = groupTasks(rows, groupBy, { hideEmpty: rows.length === 0 || narrowed });
  const onSelect = (ts: Task[], on: boolean) => setSelected((cur) => {
    const next = new Set(cur);
    for (const t of ts) { if (on) next.add(t.id); else next.delete(t.id); }
    return next;
  });
  // Always the latest copy of each picked task (its current rev); one that left the list drops out.
  const loaded = new Map([...rows, ...doneRows].map((t) => [t.id, t]));
  const picked = [...selected].map((id) => loaded.get(id)).filter((t): t is Task => !!t);

  const doneGroup: TaskGroup = { key: 'done', label: 'Complete', kind: 'status', value: 'done', tasks: doneRows };
  return (
    <div className="space-y-5 pb-20">
      {rows.length === 0 && empty}
      {groups.map((g) => (
        <Group
          key={g.key}
          g={g}
          onOpen={onOpen}
          collapsed={!!collapsed[g.key]}
          onToggle={() => toggle(g.key)}
          quickAddFor={quickAddFor}
          listId={listOf(filters)}
          personal={filters.view === 'personal'}
          selected={selected}
          onSelect={onSelect}
          onTag={onTag}
          activeTag={filters.tag}
          base={base}
        />
      ))}
      {open.hasNextPage && (
        <button onClick={() => open.fetchNextPage()} disabled={open.isFetchingNextPage} className="w-full rounded-lg py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
          {open.isFetchingNextPage ? 'Loading…' : 'Load more tasks'}
        </button>
      )}
      {showDone && (
        <Group
          g={doneGroup}
          onOpen={onOpen}
          collapsed={!!collapsed.done}
          onToggle={() => toggle('done')}
          quickAddFor={null}
          selected={selected}
          onSelect={onSelect}
          onTag={onTag}
          activeTag={filters.tag}
          base={base}
          countLabel={collapsed.done ? '…' : undefined}
          footer={
            done.isLoading ? <div className="px-3 py-2"><SkeletonRows rows={2} /></div>
              : doneRows.length === 0 ? <p className="px-3 py-3 text-sm text-gray-400">Nothing finished yet.</p>
                : done.hasNextPage ? <button onClick={() => done.fetchNextPage()} className="w-full border-t border-gray-100 py-2 text-sm font-medium text-blue-700 hover:bg-gray-50">Show more complete</button> : null
          }
        />
      )}
      <BulkBar tasks={picked} onClear={() => setSelected(new Set())} canChangeAssignee={canChangeAssignee} />
    </div>
  );
}
