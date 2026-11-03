'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, ArrowDownUp, BellDot, ChevronRight, CircleHelp, Columns3, Eye, Flag, Inbox, Info, Keyboard, Layers, List, ListTodo, Plus, Search, Send, Tag, User, Users, X } from 'lucide-react';
import { Kbd, ShortcutsDialog, isTypingIn, useHotkeys, type ShortcutGroup } from '@/components/panel/shortcuts';
import { ListResultLine } from '@/components/panel/ListControls';
import { useListParams } from '@/lib/hooks/useListParams';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import TaskListView from './TaskList';
import { useTaskPages } from './hooks';
import TaskBoard from './TaskBoard';
import TaskDetail, { type TaskNav } from './TaskDetail';
import TaskForm, { useAssignees } from './TaskForm';
import { Dialog, TaskWindow } from './Overlays';
import { groupTasks } from './grouping';
import InboxView, { inboxOrder, useInboxPages } from './Inbox';
import { TimerChip, TimerNotice } from './Timer';
import { teamColour } from '@/components/chat/chatUi';
import { STAFF_TEAM_OPTIONS } from '@/lib/staffTeams';
import {
  TASK_GROUPINGS, TASK_PRIORITIES, TASK_SORTS, TASK_STATUSES, personLabel, unreadLabel,
  type InboxFilter, type Task, type TaskDue, type TaskFilters, type TaskGroupBy, type TaskPriority, type TaskSort, type TaskView,
} from './types';

type Layout = 'list' | 'board';
const LAYOUT_KEY = 'tasks-view-mode';
const HELP_KEY = 'tasks-help-hidden';
const GROUP_KEY = 'tasks-group-by';

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage blocked: this visit only */ } };

const asGroup = (v: string | null): TaskGroupBy => (TASK_GROUPINGS.some((g) => g.value === v) ? v as TaskGroupBy : 'status');
const asSort = (v: string): TaskSort => (TASK_SORTS.some((g) => g.value === v) ? v as TaskSort : 'due');
/** The admin's team "spaces": every team, plus the admin's own tasks. */
const SPACES = [...STAFF_TEAM_OPTIONS, { value: 'admin', label: 'Admin' }] as const;

const asDue = (v: string | null): TaskDue | '' => (v === 'late' || v === 'overdue' || v === 'today' || v === 'week' ? v : '');
const asPriority = (v: string): TaskPriority | '' => (TASK_PRIORITIES.some((p) => p.value === v) ? v as TaskPriority : '');

const DUES: { value: TaskDue | ''; label: string }[] = [
  { value: '', label: 'Any date' },
  { value: 'overdue', label: 'Late' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
];

/**
 * Plain-words explanation, shown until the person hides it (remembered on this
 * device). Once hidden, the "?" beside the page title brings it back.
 */
function useHelp() {
  const [hidden, setHidden] = useState(true);
  useEffect(() => { setHidden(read(HELP_KEY) === '1'); }, []);
  return {
    hidden,
    hide: () => { setHidden(true); write(HELP_KEY, '1'); },
    show: () => { setHidden(false); write(HELP_KEY, '0'); },
  };
}

function HowItWorks({ onHide }: { onHide: () => void }) {
  return (
    <aside className="relative flex gap-3 rounded-xl border border-blue-100 bg-blue-50/70 px-3.5 py-2.5 pr-10 text-[13px] text-gray-700">
      <span aria-hidden className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700"><Info className="h-3.5 w-3.5" /></span>
      <div>
        <p className="font-semibold text-gray-900">How tasks work</p>
        <p className="mt-0.5 leading-relaxed">
          Press <strong>New task</strong> (or the N key), choose who should do it — yourself or anyone in the panel — and pick a due date.
          They get a pop-up and find it under Assigned to me. Tick the circle when a job is done; open a task to comment, add steps or change it.
        </p>
      </div>
      <button onClick={onHide} aria-label="Hide how tasks work" className="absolute right-2 top-2 rounded-md p-1 text-gray-500 hover:bg-blue-100 hover:text-gray-800">
        <X className="h-4 w-4" />
      </button>
    </aside>
  );
}

function EmptyState({ view, narrowed, onNew }: { view: TaskView; narrowed: boolean; onNew: () => void }) {
  const [title, body] = narrowed
    ? ['No tasks match', 'Try another filter, or clear the search.']
    : view === 'mine' ? ['Nothing on your plate', 'Tasks given to you show up here. Add one for yourself to get started.']
      : view === 'created' ? ['You haven’t given out any tasks', 'Give a job to someone in your team and follow it here.']
        : view === 'following' ? ['You aren’t following any tasks', 'Open a task and press Follow to hear about it without doing it.']
        : ['No open tasks in the team', 'Everyone is up to date.'];
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><ListTodo className="h-6 w-6" /></span>
      <p className="font-semibold text-gray-900">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-gray-500">{body}</p>
      {!narrowed && (
        <button onClick={onNew} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> New task
        </button>
      )}
    </div>
  );
}

/**
 * The Tasks page (team panel and admin panel): counters, search, list or board,
 * filters, and a task opening in a side panel. `base` is where full task pages
 * live (/team/tasks or /admin/tasks); `?task=<id>` opens one in the panel and
 * `?due=late` (from the bell) starts on what is due now. Whose tasks, the
 * search, filters and sort live in the page address too, so Back, a refresh or
 * a shared link reopens the same view. The page must wrap this in <Suspense>.
 */
export default function TasksWorkspace({ base, canSeeTeam }: { base: string; canSeeTeam: boolean }) {
  const isAdmin = base.startsWith('/admin');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);

  // Remembered on this device: list or board, and how the list groups.
  const [layout, setLayoutState] = useState<Layout>('list');
  const [groupBy, setGroupByState] = useState<TaskGroupBy>('status');
  useEffect(() => {
    if (read(LAYOUT_KEY) === 'board') setLayoutState('board');
    setGroupByState(asGroup(read(GROUP_KEY)));
  }, []);
  const setLayout = (l: Layout) => { setLayoutState(l); write(LAYOUT_KEY, l); };
  const setGroupBy = (g: TaskGroupBy) => { setGroupByState(g); write(GROUP_KEY, g); };

  const { values: lp, set: setList, clear: clearList } = useListParams({
    view: 'mine', team: '', due: '', priority: '', assignee: '', tag: '', q: '', sort: 'due',
  });
  // The Inbox (?view=inbox) is not a list of tasks: it replaces the list, filters and board.
  const inInbox = lp.view === 'inbox';
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('all');
  // A view this person cannot see (an old or shared link) falls back to "Assigned to me".
  const view: TaskView = lp.view === 'created' || lp.view === 'following' || (lp.view === 'team' && canSeeTeam) ? lp.view : 'mine';
  // The admin's team view: one team, or '' for all of them.
  const team = view === 'team' && isAdmin && SPACES.some((sp) => sp.value === lp.team) ? lp.team : '';
  // The bell's ?due=late means "late or due today".
  const due = asDue(lp.due);
  const priority = asPriority(lp.priority);
  const assignee = view === 'team' ? lp.assignee : '';
  const tag = lp.tag;
  const sort = asSort(lp.sort);
  const q = lp.q;
  const setView = (v: TaskView, nextTeam = '') => setList({ view: v, team: v === 'team' ? nextTeam : '' });
  const setDue = (d: TaskDue | '') => setList({ due: d });

  // Typing is local; the address (and the list) follow once the person pauses.
  const [search, setSearch] = useState(q);
  const written = useRef(q);
  useEffect(() => {
    const t = setTimeout(() => {
      const next = search.trim();
      if (next !== written.current) { written.current = next; setList({ q: next }); }
    }, 250);
    return () => clearTimeout(t);
  }, [search, setList]);
  // A change from outside (Clear, Back, a link) replaces what is in the box.
  useEffect(() => { if (q !== written.current) { written.current = q; setSearch(q); } }, [q]);
  const [creating, setCreating] = useState(false);

  const openId = params.get('task');
  const setOpenId = useCallback((id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set('task', id); else next.delete('task');
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [params, pathname, router]);

  const [shortcuts, setShortcuts] = useState(false);
  // N new task, / search, L list, B board, ? the list of shortcuts — never while typing.
  const idle = !openId && !creating;
  useHotkeys([
    { key: 'n', run: (e) => { if (!idle) return; e.preventDefault(); setCreating(true); } },
    { key: '/', run: (e) => { if (!idle) return; e.preventDefault(); searchRef.current?.focus(); } },
    { key: 'l', run: () => { if (idle) setLayout('list'); } },
    { key: 'b', run: () => { if (idle) setLayout('board'); } },
    { key: '?', run: (e) => { if (!idle) return; e.preventDefault(); setShortcuts(true); } },
  ]);

  const summary = useQuery({
    queryKey: taskKeys.summary(),
    queryFn: () => apiClient.get<{ late: number; today: number; inbox?: number }>('/staff/tasks/summary'),
    refetchInterval: 60_000,
  });
  const people = useAssignees();

  const views: { value: TaskView; label: string }[] = [
    { value: 'mine', label: 'Assigned to me' },
    { value: 'following', label: 'Following' },
    { value: 'created', label: 'I gave out' },
    ...(canSeeTeam ? [{ value: 'team' as const, label: isAdmin ? 'All teams' : 'My team' }] : []),
  ];
  const filters: TaskFilters = { view, due, priority, q, tag, sort, assignee, team };
  const narrowed = !!(due || priority || q || tag || assignee);
  // The same requests (and cache entries) as the list's or board's own: no extra call.
  const openPages = useTaskPages(filters, 'open', !inInbox);
  const counted = openPages.data?.pages[0]?.summary;
  // The board's Complete column; the list folds done tasks away, so it is not read there.
  const donePages = useTaskPages(filters, 'done', !inInbox && layout === 'board' && !filters.due);
  // The same request (and cache) as the Inbox screen's own.
  const inboxPages = useInboxPages(inboxFilter, inInbox);
  // Unread Inbox lines come with the header counts (one request, polled each minute).
  const inboxUnread = summary.data?.inbox ?? 0;

  /*
    The tasks in the order they are on screen, for "previous / next" in the
    task window (and J / K): the list's groups top to bottom, or the board's
    columns left to right. A task under several people appears once.
  */
  const order = useMemo(() => {
    if (inInbox) return inboxOrder(inboxPages.data);
    const open = (openPages.data?.pages ?? []).flatMap((pg) => pg.tasks);
    const rows: Task[] = layout === 'board'
      ? TASK_STATUSES.flatMap((st) => (st.value === 'done'
        ? (filters.due ? [] : (donePages.data?.pages ?? []).flatMap((pg) => pg.tasks))
        : open.filter((t) => t.status === st.value)))
      : groupTasks(open, groupBy).flatMap((g) => g.tasks);
    return [...new Set(rows.map((t) => t.id))];
  }, [inInbox, inboxPages.data, openPages.data, donePages.data, layout, groupBy, filters.due]);
  // Quick add in the team list with one person picked gives it to them; otherwise to me.
  const quickAddFor = view === 'team' && assignee ? assignee : undefined;
  // Whose tasks (and which team), and the order, are where you are — not filters.
  const clear = () => { clearList(['view', 'team', 'sort']); setSearch(''); };
  // "Today & overdue" is Assigned to me with the bell's filter: late or due today.
  const dueNow = !inInbox && view === 'mine' && due === 'late';
  const showDueNow = () => setList({ view: 'mine', team: '', due: dueNow ? '' : 'late' });
  const filterTag = (t: string) => setList({ tag: tag === t ? '' : t });

  const at = openId ? order.indexOf(openId) : -1;
  const nav: TaskNav | undefined = at < 0 ? undefined : {
    at: at + 1,
    of: `${order.length}${(inInbox ? inboxPages.hasNextPage : openPages.hasNextPage && layout === 'list') ? '+' : ''}`,
    prev: at > 0 ? () => setOpenId(order[at - 1]) : undefined,
    next: at < order.length - 1 ? () => setOpenId(order[at + 1]) : undefined,
  };
  // J / K step through the list while a task is open (never while typing, or with another window on top).
  const navRef = useRef(nav);
  useEffect(() => { navRef.current = nav; });
  useEffect(() => {
    if (!openId) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || isTypingIn(e.target)) return;
      if (document.querySelectorAll('[aria-modal="true"]').length > 1) return;
      const k = e.key.toLowerCase();
      const go = k === 'j' ? navRef.current?.next : k === 'k' ? navRef.current?.prev : undefined;
      if (go) { e.preventDefault(); go(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId]);

  const control = 'h-8 rounded-full border border-gray-200 bg-white pl-3 pr-7 text-[13px] font-medium text-gray-700 shadow-[0_1px_1px_rgba(20,22,40,0.03)] hover:border-gray-300 hover:bg-gray-50';
  const help = useHelp();
  const space = SPACES.find((sp) => sp.value === team);
  const title = inInbox ? 'Inbox' : view === 'team' && space ? `${space.label} tasks` : dueNow ? 'Today & overdue' : view === 'mine' ? 'Assigned to me' : (views.find((v) => v.value === view) ?? views[0]).label;
  const late = summary.data?.late ?? 0;
  const today = summary.data?.today ?? 0;
  const VIEW_ICONS: Record<TaskView, typeof Inbox> = { mine: Inbox, following: Eye, created: Send, team: Users };
  const shortcutGroups: ShortcutGroup[] = [
    { title: 'Tasks', items: [
      { keys: ['N'], label: 'New task' },
      { keys: ['/'], label: 'Search tasks' },
      { keys: ['L'], label: 'Show as a list' },
      { keys: ['B'], label: 'Show as a board' },
      { keys: ['Space'], label: 'Tick the task in focus (to change several at once)' },
      { keys: ['J'], label: 'Next task (with a task open)' },
      { keys: ['K'], label: 'Previous task (with a task open)' },
      { keys: ['Esc'], label: 'Close a task or a pop-up' },
      { keys: ['?'], label: 'Show these shortcuts' },
    ] },
  ];
  const navItem = 'tk-menu-item inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 max-lg:border max-lg:border-gray-200 max-lg:bg-white lg:min-h-8 lg:rounded-md lg:px-2 lg:py-1.5';
  const sectionLabel = 'hidden px-2 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400 lg:block';
  // Where you are, ClickUp-style: Tasks › My work (or Team / a space) › this list.
  const crumbSection = view === 'team' && !inInbox ? (isAdmin ? 'Spaces' : 'Team') : 'My work';
  const personal = views.filter((v) => v.value !== 'team');
  const teamViews = views.filter((v) => v.value === 'team');
  const viewButton = (v: (typeof views)[number]) => {
    const Icon = VIEW_ICONS[v.value];
    const active = !inInbox && view === v.value && !team && !(v.value === 'mine' && dueNow);
    return (
      <button key={v.value} aria-pressed={active} onClick={() => setView(v.value)} className={navItem}>
        <Icon aria-hidden className="hidden h-4 w-4 text-gray-500 lg:block" />{v.label}
      </button>
    );
  };

  return (
    // Edge to edge: cancels the panel's padding (PanelShell `tightPage`), so the
    // side menu and the board use the whole width, the way ClickUp does.
    <div className="tk-theme tk-edge -m-3 md:-m-5 lg:flex lg:min-h-[calc(100dvh-3.5rem)] lg:items-stretch">
      {/* Which tasks: a menu flush down the side on a wide screen, a row of chips on a phone. */}
      <nav
        aria-label="Task lists"
        className="tk-side relative flex gap-1.5 overflow-x-auto border-b px-3 py-2.5 [scrollbar-width:none] md:px-5 lg:sticky lg:top-14 lg:h-[calc(100dvh-3.5rem)] lg:w-56 lg:shrink-0 lg:flex-col lg:gap-0 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-2 lg:py-3"
      >
        <p className="hidden items-center gap-2 px-2 pb-3 lg:flex">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-sm"><ListTodo aria-hidden className="h-3.5 w-3.5" /></span>
          <span className="text-sm font-bold text-gray-900">Tasks</span>
        </p>
        <div className="flex gap-1.5 lg:flex-col lg:gap-px" role="group" aria-label="Whose tasks">
          <button aria-pressed={inInbox} onClick={() => setList({ view: 'inbox', team: '' })} className={navItem}>
            <BellDot aria-hidden className="hidden h-4 w-4 text-gray-500 lg:block" />Inbox
            {inboxUnread > 0 && (
              <span className="ml-auto rounded-full bg-blue-600 px-1.5 text-[11px] font-bold leading-[18px] text-white">
                {unreadLabel(inboxUnread)}<span className="sr-only"> unread</span>
              </span>
            )}
          </button>
          {viewButton(personal[0])}
          <button aria-pressed={dueNow} onClick={showDueNow} className={navItem}>
            <AlarmClock aria-hidden className="hidden h-4 w-4 text-gray-500 lg:block" />Today &amp; overdue
            {late + today > 0 && (
              <span
                className={`ml-auto rounded-full px-1.5 text-[11px] font-bold leading-[18px] ${late > 0 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}
                title={`${late} late, ${today} due today`}
              >
                {late + today}<span className="sr-only"> due now</span>
              </span>
            )}
          </button>
          {personal.slice(1).map(viewButton)}
        </div>
        {teamViews.length > 0 && (
          <>
            <p className={sectionLabel}>{isAdmin ? 'Spaces' : 'Team'}</p>
            <div className="flex gap-1.5 lg:flex-col lg:gap-px" role="group" aria-label={isAdmin ? 'Teams' : 'Team'}>
              {teamViews.map(viewButton)}
              {isAdmin && SPACES.map((sp) => {
                const active = view === 'team' && team === sp.value;
                return (
                  <button key={sp.value} aria-pressed={active} onClick={() => setView('team', sp.value)} className={navItem}>
                    <span aria-hidden className={`hidden h-5 w-5 items-center justify-center rounded text-[10px] font-bold lg:flex ${teamColour(sp.value)}`}>{sp.label[0]}</span>
                    {sp.label}
                  </button>
                );
              })}
            </div>
          </>
        )}
        <p className={sectionLabel}>Shortcuts</p>
        <button
          onClick={() => setShortcuts(true)}
          aria-label="Keyboard shortcuts"
          className="hidden min-h-8 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 lg:flex"
        >
          <Keyboard aria-hidden className="h-4 w-4 text-gray-500" /> Shortcuts <Kbd className="ml-auto">?</Kbd>
        </button>
      </nav>

      <div className="min-w-0 flex-1 space-y-3 px-3 py-3 md:px-5 lg:px-6 lg:py-4">
        <header className="tk-line flex flex-wrap items-end gap-x-3 gap-y-2 border-b">
          <div className="min-w-0 flex-1 pb-2">
            <nav aria-label="Breadcrumb" className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-500">
              <button onClick={() => setView('mine')} className="rounded px-0.5 hover:text-gray-900 hover:underline">Tasks</button>
              <ChevronRight aria-hidden className="h-3 w-3 text-gray-400" />
              <span>{crumbSection}</span>
              <ChevronRight aria-hidden className="h-3 w-3 text-gray-400" />
              <span aria-current="page" className="truncate text-gray-700">{title}</span>
            </nav>
            <h1 className="pn-title flex flex-wrap items-center gap-2 text-xl text-gray-900">
              {space && <span aria-hidden className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold ${teamColour(space.value)}`}>{space.label[0]}</span>}
              {title}
              {!inInbox && help.hidden && (
                <button onClick={help.show} aria-label="Show how tasks work" title="How tasks work" className="rounded-full p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                  <CircleHelp aria-hidden className="h-4 w-4" />
                </button>
              )}
              {!inInbox && view === 'mine' && late > 0 && <span className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">{late} late</span>}
              {!inInbox && view === 'mine' && today > 0 && <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{today} due today</span>}
            </h1>
            <p className="mt-0.5 text-[13px] text-gray-500">
              {inInbox ? 'What happened on your tasks: new tasks, status changes, comments and mentions.'
                : view === 'created' ? 'Jobs you gave to others, and how far they have got.'
                : view === 'following' ? 'Tasks you watch without doing them: you hear about every change.'
                : view === 'team' ? (space ? `Open work in ${space.label}.` : isAdmin ? 'Every team’s open work.' : 'Everything your team is working on.')
                  : 'Who has to do what, and by when.'}
            </p>
          </div>
          {!inInbox && <div className="order-last -mt-1 flex basis-full gap-1" role="tablist" aria-label="Show as">
            {([['list', 'List', List], ['board', 'Board', Columns3]] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                role="tab"
                aria-selected={layout === value}
                onClick={() => setLayout(value)}
                title={`${label} (${value === 'list' ? 'L' : 'B'})`}
                className={`-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 px-2.5 text-sm font-medium transition-colors ${
                  layout === value ? 'border-blue-500 font-semibold text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-900'
                }`}
              >
                <Icon aria-hidden className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>}
          <div className="ml-auto flex items-center gap-2 pb-2">
          <TimerChip onOpen={setOpenId} />
          <button onClick={() => setShortcuts(true)} title="Keyboard shortcuts (?)" aria-label="Show keyboard shortcuts" className="hidden h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 md:inline-flex lg:hidden">
            <Keyboard aria-hidden className="h-4 w-4" /><Kbd>?</Kbd>
          </button>
          <button onClick={() => setCreating(true)} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-3.5 text-sm font-semibold text-white shadow-sm transition-[background-color,transform] hover:bg-blue-700 active:scale-[0.98]" title="New task (N)">
            <Plus className="h-4 w-4" /> New task <span className="hidden sm:contents"><Kbd className="border-transparent! bg-white/20! text-white! shadow-none!">N</Kbd></span>
          </button>
          </div>
        </header>
        <TimerNotice onOpen={setOpenId} />

        {inInbox ? (
          <InboxView filter={inboxFilter} onFilter={setInboxFilter} openId={openId} onOpen={setOpenId} />
        ) : (<>
        {!help.hidden && <HowItWorks onHide={help.hide} />}

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex min-w-0 flex-1 basis-56 items-center sm:max-w-xs">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 h-4 w-4 text-gray-400" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); (e.target as HTMLInputElement).blur(); } }}
              placeholder="Search tasks or T-number"
              aria-label="Search tasks"
              maxLength={100}
              className="h-8 w-full rounded-full border border-gray-200 bg-white pl-8 pr-8 text-[13px] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <span className="pointer-events-none absolute right-2 hidden sm:block"><Kbd>/</Kbd></span>
          </label>
          <div className="-mx-3 flex min-w-0 basis-full items-center gap-2 overflow-x-auto px-3 [scrollbar-width:none] sm:mx-0 sm:basis-auto sm:flex-wrap sm:overflow-visible sm:px-0">
          {layout === 'list' && (
            <label className="inline-flex shrink-0 items-center gap-1" title="Group by">
              <Layers aria-hidden className="h-4 w-4 text-gray-400" />
              <select value={groupBy} onChange={(e) => setGroupBy(asGroup(e.target.value))} aria-label="Group by" className={control}>
                {TASK_GROUPINGS.map((g) => <option key={g.value} value={g.value}>Group: {g.label}</option>)}
              </select>
            </label>
          )}
          <label className="inline-flex shrink-0 items-center gap-1" title="Order">
            <ArrowDownUp aria-hidden className="h-4 w-4 text-gray-400" />
            <select value={sort} onChange={(e) => setList({ sort: e.target.value })} aria-label="Sort" className={control}>
              {TASK_SORTS.map((o) => <option key={o.value} value={o.value}>Sort: {o.label}</option>)}
            </select>
          </label>
          {view === 'team' && (
            <label className="inline-flex shrink-0 items-center gap-1">
              <User aria-hidden className="h-4 w-4 text-gray-400" />
              <select value={assignee} onChange={(e) => setList({ assignee: e.target.value })} aria-label="Person" className={control}>
                <option value="">Everyone</option>
                {(people.data?.people ?? []).map((p) => <option key={p.id} value={p.id}>{personLabel(p)}</option>)}
              </select>
            </label>
          )}
          <label className="inline-flex shrink-0 items-center gap-1">
            <Flag aria-hidden className="h-4 w-4 text-gray-400" />
            <select value={priority} onChange={(e) => setList({ priority: e.target.value })} aria-label="Priority filter" className={control}>
              <option value="">Any priority</option>
              {TASK_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <div className="flex shrink-0 gap-0.5 rounded-full border border-gray-200 bg-white p-0.5" role="group" aria-label="Due date">
            {DUES.map((d) => {
              const on = due === d.value || (d.value === 'overdue' && due === 'late');
              return (
                <button
                  key={d.value || 'any'}
                  aria-pressed={on}
                  onClick={() => setDue(d.value)}
                  className={`h-7 whitespace-nowrap rounded-full px-2.5 text-[13px] font-medium transition ${on ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          {due === 'late' && <span className="shrink-0 whitespace-nowrap text-xs text-gray-500">(late or due today)</span>}
          {tag && (
            <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-blue-50 pl-2 pr-1 text-sm font-medium text-blue-800">
              <Tag aria-hidden className="h-3.5 w-3.5" /> {tag}
              <button onClick={() => setList({ tag: '' })} aria-label={`Stop filtering by ${tag}`} className="rounded p-0.5 hover:bg-blue-100"><X className="h-3.5 w-3.5" /></button>
            </span>
          )}
          {narrowed && <button onClick={clear} className="shrink-0 whitespace-nowrap text-sm font-medium text-blue-700 hover:underline">Clear all</button>}
          </div>
        </div>
        {counted && <ListResultLine count={counted.count} capped={counted.capped} noun={['open task', 'open tasks']} />}

        {layout === 'board' ? (
          <TaskBoard filters={filters} onOpen={setOpenId} quickAddFor={quickAddFor} onTag={filterTag} base={base} />
        ) : (
          <TaskListView
            // A new list is a new selection: ticks never carry over to tasks no longer shown.
            key={JSON.stringify(filters)}
            filters={filters}
            onOpen={setOpenId}
            quickAddFor={quickAddFor}
            groupBy={groupBy}
            onTag={filterTag}
            empty={<EmptyState view={view} narrowed={narrowed} onNew={() => setCreating(true)} />}
          />
        )}
        </>)}
      </div>

      <TaskWindow open={!!openId} onClose={() => setOpenId(null)} label="Task">
        {openId && <TaskDetail key={openId} id={openId} base={base} onClose={() => setOpenId(null)} onOpen={setOpenId} nav={nav} />}
      </TaskWindow>

      <Dialog open={creating} onClose={() => setCreating(false)} label="New task">
        <TaskForm onDone={(t) => { setCreating(false); if (t?.id) setOpenId(t.id); }} onCancel={() => setCreating(false)} />
      </Dialog>
      {shortcuts && <ShortcutsDialog groups={shortcutGroups} onClose={() => setShortcuts(false)} />}
    </div>
  );
}
