'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, ArrowDownUp, CalendarClock, Columns3, Flag, Inbox, Info, Keyboard, Layers, List, ListTodo, Plus, Search, Send, Tag, User, Users, X } from 'lucide-react';
import { Kbd, ShortcutsDialog, useHotkeys, type ShortcutGroup } from '@/components/panel/shortcuts';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import TaskListView from './TaskList';
import TaskBoard from './TaskBoard';
import TaskDetail from './TaskDetail';
import TaskForm, { useAssignees } from './TaskForm';
import { Dialog, SidePanel } from './Overlays';
import { teamColour } from '@/components/chat/chatUi';
import { STAFF_TEAM_OPTIONS } from '@/lib/staffTeams';
import {
  TASK_GROUPINGS, TASK_PRIORITIES, TASK_SORTS, personLabel,
  type TaskDue, type TaskFilters, type TaskGroupBy, type TaskPriority, type TaskSort, type TaskView,
} from './types';

type Layout = 'list' | 'board';
const LAYOUT_KEY = 'tasks-view-mode';
const HELP_KEY = 'tasks-help-hidden';
const GROUP_KEY = 'tasks-group-by';
const SORT_KEY = 'tasks-sort';

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage blocked: this visit only */ } };

const asGroup = (v: string | null): TaskGroupBy => (TASK_GROUPINGS.some((g) => g.value === v) ? v as TaskGroupBy : 'status');
const asSort = (v: string | null): TaskSort => (TASK_SORTS.some((g) => g.value === v) ? v as TaskSort : 'due');
/** The admin's team "spaces": every team, plus the admin's own tasks. */
const SPACES = [...STAFF_TEAM_OPTIONS, { value: 'admin', label: 'Admin' }] as const;

const asDue = (v: string | null): TaskDue | '' => (v === 'late' || v === 'overdue' || v === 'today' || v === 'week' ? v : '');

const DUES: { value: TaskDue | ''; label: string }[] = [
  { value: '', label: 'Any date' },
  { value: 'overdue', label: 'Late' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
];

/** Plain-words explanation, shown until the person hides it (remembered on this device). */
function HowItWorks() {
  const [hidden, setHidden] = useState(true);
  useEffect(() => { setHidden(read(HELP_KEY) === '1'); }, []);
  if (hidden) return null;
  return (
    <aside className="relative flex gap-3 rounded-xl border border-sky-200 bg-sky-50 p-3 pr-10 text-sm text-sky-900">
      <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-semibold">How tasks work</p>
        <p className="mt-0.5">
          Press <strong>New task</strong> (or the N key), choose who should do it — yourself or anyone in the panel — and pick a due date.
          They get a pop-up and find it under For me. Tick the circle when a job is done; open a task to comment, add steps or change it.
        </p>
      </div>
      <button onClick={() => { setHidden(true); write(HELP_KEY, '1'); }} aria-label="Hide how tasks work" className="absolute right-2 top-2 rounded p-1 hover:bg-sky-100">
        <X className="h-4 w-4" />
      </button>
    </aside>
  );
}

function Counter({ n, label, tone, onClick, active }: { n: number; label: string; tone: string; onClick: () => void; active: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold transition ${tone} ${active ? 'ring-2 ring-offset-1 ring-current' : 'hover:opacity-80'}`}
    >
      {label === 'late' ? <AlarmClock aria-hidden className="h-3.5 w-3.5" /> : <CalendarClock aria-hidden className="h-3.5 w-3.5" />}
      {n} {label === 'late' ? 'late' : 'due today'}
    </button>
  );
}

function EmptyState({ view, narrowed, onNew }: { view: TaskView; narrowed: boolean; onNew: () => void }) {
  const [title, body] = narrowed
    ? ['No tasks match', 'Try another filter, or clear the search.']
    : view === 'mine' ? ['Nothing on your plate', 'Tasks given to you show up here. Add one for yourself to get started.']
      : view === 'created' ? ['You haven’t given out any tasks', 'Give a job to someone in your team and follow it here.']
        : ['No open tasks in the team', 'Everyone is up to date.'];
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
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
 * `?due=late` (from the bell) starts on what is due now.
 */
export default function TasksWorkspace({ base, canSeeTeam }: { base: string; canSeeTeam: boolean }) {
  const isAdmin = base.startsWith('/admin');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);

  // Remembered on this device: list or board, how the list groups, how it is ordered.
  const [layout, setLayoutState] = useState<Layout>('list');
  const [groupBy, setGroupByState] = useState<TaskGroupBy>('status');
  const [sort, setSortState] = useState<TaskSort>('due');
  useEffect(() => {
    if (read(LAYOUT_KEY) === 'board') setLayoutState('board');
    setGroupByState(asGroup(read(GROUP_KEY)));
    setSortState(asSort(read(SORT_KEY)));
  }, []);
  const setLayout = (l: Layout) => { setLayoutState(l); write(LAYOUT_KEY, l); };
  const setGroupBy = (g: TaskGroupBy) => { setGroupByState(g); write(GROUP_KEY, g); };
  const setSort = (o: TaskSort) => { setSortState(o); write(SORT_KEY, o); };

  const [view, setViewState] = useState<TaskView>('mine');
  // The admin's team view: one team, or '' for all of them.
  const [team, setTeam] = useState('');
  // The bell's ?due=late means "late or due today".
  const [due, setDue] = useState<TaskDue | ''>(asDue(params.get('due')));
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [assignee, setAssignee] = useState('');
  const [tag, setTag] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(search), 250); return () => clearTimeout(t); }, [search]);
  const [creating, setCreating] = useState(false);
  const setView = (v: TaskView, nextTeam = '') => { setViewState(v); setTeam(v === 'team' ? nextTeam : ''); };

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
    queryFn: () => apiClient.get<{ late: number; today: number }>('/staff/tasks/summary'),
    refetchInterval: 60_000,
  });
  const people = useAssignees();

  const views: { value: TaskView; label: string }[] = [
    { value: 'mine', label: 'For me' },
    { value: 'created', label: 'I gave out' },
    ...(canSeeTeam ? [{ value: 'team' as const, label: isAdmin ? 'All teams' : 'My team' }] : []),
  ];
  const filters: TaskFilters = { view, due, priority, q, tag, sort, assignee: view === 'team' ? assignee : '', team: view === 'team' ? team : '' };
  const narrowed = !!(due || priority || q || tag || (view === 'team' && assignee));
  // Quick add in the team list with one person picked gives it to them; otherwise to me.
  const quickAddFor = view === 'team' && assignee ? assignee : undefined;
  const clear = () => { setDue(''); setPriority(''); setAssignee(''); setTag(''); setSearch(''); setQ(''); };
  const showMine = (d: TaskDue) => { setView('mine'); setDue(due === d && view === 'mine' ? '' : d); };
  const filterTag = (t: string) => setTag((cur) => (cur === t ? '' : t));

  const control = 'h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-700 hover:border-gray-300';
  const space = SPACES.find((sp) => sp.value === team);
  const title = view === 'team' && space ? `${space.label} tasks` : view === 'mine' ? 'Tasks for me' : (views.find((v) => v.value === view) ?? views[0]).label;
  const late = summary.data?.late ?? 0;
  const today = summary.data?.today ?? 0;
  const VIEW_ICONS: Record<TaskView, typeof Inbox> = { mine: Inbox, created: Send, team: Users };
  const shortcutGroups: ShortcutGroup[] = [
    { title: 'Tasks', items: [
      { keys: ['N'], label: 'New task' },
      { keys: ['/'], label: 'Search tasks' },
      { keys: ['L'], label: 'Show as a list' },
      { keys: ['B'], label: 'Show as a board' },
      { keys: ['Space'], label: 'Tick the task in focus (to change several at once)' },
      { keys: ['Esc'], label: 'Close a task or a pop-up' },
      { keys: ['?'], label: 'Show these shortcuts' },
    ] },
  ];
  const navItem = (active: boolean) => `inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors lg:rounded-lg lg:px-2.5 lg:py-[7px] ${
    active ? 'bg-gray-900 text-white lg:bg-blue-50 lg:font-semibold lg:text-blue-800' : 'text-gray-700 hover:bg-gray-100 max-lg:bg-white max-lg:shadow-sm'
  }`;
  const sectionLabel = 'hidden px-2.5 pb-1.5 pt-5 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500 lg:block';

  return (
    <div className="lg:flex lg:items-start lg:gap-6">
      {/* Which tasks: a column on a wide screen, a row of chips on a phone. */}
      <nav
        aria-label="Task lists"
        className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] lg:sticky lg:top-4 lg:mx-0 lg:mb-0 lg:w-56 lg:shrink-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:rounded-2xl lg:border lg:border-gray-200 lg:bg-white lg:p-2.5 lg:shadow-sm"
      >
        <p className="hidden items-center gap-2 px-2 pb-2 pt-1 lg:flex">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white"><ListTodo aria-hidden className="h-4 w-4" /></span>
          <span className="text-sm font-bold text-gray-900">Tasks</span>
        </p>
        <div className="flex gap-1.5 lg:flex-col lg:gap-0.5" role="group" aria-label="Whose tasks">
          {views.map((v) => {
            const Icon = VIEW_ICONS[v.value];
            const active = view === v.value && !team;
            return (
              <button key={v.value} aria-pressed={active} onClick={() => setView(v.value)} className={navItem(active)}>
                <Icon aria-hidden className="hidden h-4 w-4 lg:block" />{v.label}
              </button>
            );
          })}
        </div>
        {(late > 0 || today > 0) && (
          <>
            <p className={sectionLabel}>Needs attention</p>
            <div className="flex gap-1.5 lg:flex-col lg:gap-1 lg:px-1">
              {late > 0 && <Counter n={late} label="late" tone="bg-red-100 text-red-800" active={view === 'mine' && due === 'overdue'} onClick={() => showMine('overdue')} />}
              {today > 0 && <Counter n={today} label="today" tone="bg-amber-100 text-amber-800" active={view === 'mine' && due === 'today'} onClick={() => showMine('today')} />}
            </div>
          </>
        )}
        {isAdmin && (
          <>
            <p className={sectionLabel}>Teams</p>
            <div className="flex gap-1.5 lg:flex-col lg:gap-0.5" role="group" aria-label="Teams">
              {SPACES.map((sp) => {
                const active = view === 'team' && team === sp.value;
                return (
                  <button key={sp.value} aria-pressed={active} onClick={() => setView('team', sp.value)} className={navItem(active)}>
                    <span aria-hidden className={`hidden h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold lg:flex ${teamColour(sp.value)}`}>{sp.label[0]}</span>
                    {sp.label}
                  </button>
                );
              })}
            </div>
          </>
        )}
        <button
          onClick={() => setShortcuts(true)}
          aria-label="Keyboard shortcuts"
          className="mt-4 hidden items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 lg:flex"
        >
          <Keyboard aria-hidden className="h-4 w-4" /> Shortcuts <Kbd className="ml-auto">?</Kbd>
        </button>
      </nav>

      <div className="min-w-0 flex-1 space-y-4">
        <header className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1 basis-full sm:basis-auto">
            <h1 className="pn-title flex flex-wrap items-center gap-2 text-2xl text-gray-900">
              {space && <span aria-hidden className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold ${teamColour(space.value)}`}>{space.label[0]}</span>}
              {title}
              {view === 'mine' && late > 0 && <span className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">{late} late</span>}
              {view === 'mine' && today > 0 && <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{today} due today</span>}
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {view === 'created' ? 'Jobs you gave to others, and how far they have got.'
                : view === 'team' ? (space ? `Open work in ${space.label}.` : isAdmin ? 'Every team’s open work.' : 'Everything your team is working on.')
                  : 'Who has to do what, and by when.'}
            </p>
          </div>
          <div className="flex rounded-xl bg-gray-100 p-1" role="tablist" aria-label="Show as">
            {([['list', 'List', List], ['board', 'Board', Columns3]] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                role="tab"
                aria-selected={layout === value}
                onClick={() => setLayout(value)}
                title={`${label} (${value === 'list' ? 'L' : 'B'})`}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition ${
                  layout === value ? 'bg-white font-semibold text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Icon aria-hidden className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
          <button onClick={() => setCreating(true)} className="ml-auto inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition-[background-color,transform] hover:bg-blue-700 active:scale-[0.98]" title="New task (N)">
            <Plus className="h-4 w-4" /> New task <span className="hidden sm:contents"><Kbd className="border-transparent! bg-white/20! text-white! shadow-none!">N</Kbd></span>
          </button>
        </header>

        <HowItWorks />

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
          <label className="relative flex min-w-0 flex-1 basis-48 items-center sm:max-w-xs">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 h-4 w-4 text-gray-400" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); (e.target as HTMLInputElement).blur(); } }}
              placeholder="Search tasks or T-number"
              aria-label="Search tasks"
              maxLength={100}
              className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-8 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <span className="pointer-events-none absolute right-2 hidden sm:block"><Kbd>/</Kbd></span>
          </label>
          {layout === 'list' && (
            <label className="inline-flex items-center gap-1" title="Group by">
              <Layers aria-hidden className="h-4 w-4 text-gray-400" />
              <select value={groupBy} onChange={(e) => setGroupBy(asGroup(e.target.value))} aria-label="Group by" className={control}>
                {TASK_GROUPINGS.map((g) => <option key={g.value} value={g.value}>Group: {g.label}</option>)}
              </select>
            </label>
          )}
          <label className="inline-flex items-center gap-1" title="Order">
            <ArrowDownUp aria-hidden className="h-4 w-4 text-gray-400" />
            <select value={sort} onChange={(e) => setSort(asSort(e.target.value))} aria-label="Order" className={control}>
              {TASK_SORTS.map((o) => <option key={o.value} value={o.value}>Sort: {o.label}</option>)}
            </select>
          </label>
          {view === 'team' && (
            <label className="inline-flex items-center gap-1">
              <User aria-hidden className="h-4 w-4 text-gray-400" />
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Person" className={control}>
                <option value="">Everyone</option>
                {(people.data?.people ?? []).map((p) => <option key={p.id} value={p.id}>{personLabel(p)}</option>)}
              </select>
            </label>
          )}
          <label className="inline-flex items-center gap-1">
            <Flag aria-hidden className="h-4 w-4 text-gray-400" />
            <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority | '')} aria-label="Priority filter" className={control}>
              <option value="">Any priority</option>
              {TASK_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-white p-0.5" role="group" aria-label="Due date">
            {DUES.map((d) => {
              const on = due === d.value || (d.value === 'overdue' && due === 'late');
              return (
                <button
                  key={d.value || 'any'}
                  aria-pressed={on}
                  onClick={() => setDue(d.value)}
                  className={`h-8 rounded-md px-2.5 text-sm font-medium transition ${on ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          {due === 'late' && <span className="text-xs text-gray-500">(late or due today)</span>}
          {tag && (
            <span className="inline-flex h-8 items-center gap-1 rounded-lg bg-blue-50 pl-2 pr-1 text-sm font-medium text-blue-800">
              <Tag aria-hidden className="h-3.5 w-3.5" /> {tag}
              <button onClick={() => setTag('')} aria-label={`Stop filtering by ${tag}`} className="rounded p-0.5 hover:bg-blue-100"><X className="h-3.5 w-3.5" /></button>
            </span>
          )}
          {narrowed && <button onClick={clear} className="text-sm font-medium text-blue-700 hover:underline">Clear filters</button>}
        </div>

        {layout === 'board' ? (
          <TaskBoard filters={filters} onOpen={setOpenId} quickAddFor={quickAddFor} onTag={filterTag} />
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
      </div>

      <SidePanel open={!!openId} onClose={() => setOpenId(null)} label="Task">
        {openId && <TaskDetail id={openId} base={base} onClose={() => setOpenId(null)} />}
      </SidePanel>

      <Dialog open={creating} onClose={() => setCreating(false)} label="New task">
        <TaskForm onDone={(t) => { setCreating(false); if (t?.id) setOpenId(t.id); }} onCancel={() => setCreating(false)} />
      </Dialog>
      {shortcuts && <ShortcutsDialog groups={shortcutGroups} onClose={() => setShortcuts(false)} />}
    </div>
  );
}
