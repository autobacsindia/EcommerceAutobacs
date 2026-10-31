'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, CalendarClock, Columns3, Flag, Inbox, Info, Keyboard, List, ListTodo, Plus, Search, Send, User, Users, X } from 'lucide-react';
import { Kbd, ShortcutsDialog, useHotkeys, type ShortcutGroup } from '@/components/panel/shortcuts';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import TaskListView from './TaskList';
import TaskBoard from './TaskBoard';
import TaskDetail from './TaskDetail';
import TaskForm, { useAssignees } from './TaskForm';
import { Dialog, SidePanel } from './Overlays';
import { TASK_PRIORITIES, personLabel, type TaskDue, type TaskFilters, type TaskPriority, type TaskView } from './types';

type Layout = 'list' | 'board';
const LAYOUT_KEY = 'tasks-view-mode';
const HELP_KEY = 'tasks-help-hidden';

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage blocked: this visit only */ } };

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

  const [layout, setLayoutState] = useState<Layout>('list');
  useEffect(() => { if (read(LAYOUT_KEY) === 'board') setLayoutState('board'); }, []);
  const setLayout = (l: Layout) => { setLayoutState(l); write(LAYOUT_KEY, l); };

  const [view, setView] = useState<TaskView>('mine');
  // The bell's ?due=late means "late or due today".
  const [due, setDue] = useState<TaskDue | ''>(asDue(params.get('due')));
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [assignee, setAssignee] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(search), 250); return () => clearTimeout(t); }, [search]);
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
    queryFn: () => apiClient.get<{ late: number; today: number }>('/staff/tasks/summary'),
    refetchInterval: 60_000,
  });
  const people = useAssignees();

  const views: { value: TaskView; label: string }[] = [
    { value: 'mine', label: 'For me' },
    { value: 'created', label: 'I gave out' },
    ...(canSeeTeam ? [{ value: 'team' as const, label: isAdmin ? 'All teams' : 'My team' }] : []),
  ];
  const filters: TaskFilters = { view, due, priority, q, assignee: view === 'team' ? assignee : '' };
  const narrowed = !!(due || priority || q || (view === 'team' && assignee));
  // Quick add in the team list with one person picked gives it to them; otherwise to me.
  const quickAddFor = view === 'team' && assignee ? assignee : undefined;
  const clear = () => { setDue(''); setPriority(''); setAssignee(''); setSearch(''); setQ(''); };
  const showMine = (d: TaskDue) => { setView('mine'); setDue(due === d && view === 'mine' ? '' : d); };

  const control = 'h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-700 hover:border-gray-300';
  const current = views.find((v) => v.value === view) ?? views[0];
  const late = summary.data?.late ?? 0;
  const today = summary.data?.today ?? 0;
  const VIEW_ICONS: Record<TaskView, typeof Inbox> = { mine: Inbox, created: Send, team: Users };
  const shortcutGroups: ShortcutGroup[] = [
    { title: 'Tasks', items: [
      { keys: ['N'], label: 'New task' },
      { keys: ['/'], label: 'Search tasks' },
      { keys: ['L'], label: 'Show as a list' },
      { keys: ['B'], label: 'Show as a board' },
      { keys: ['Esc'], label: 'Close a task or a pop-up' },
      { keys: ['?'], label: 'Show these shortcuts' },
    ] },
  ];

  return (
    <div className="lg:flex lg:items-start lg:gap-6">
      {/* Which tasks: a column on a wide screen, a row of chips on a phone. */}
      <nav
        aria-label="Task lists"
        className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] lg:sticky lg:top-4 lg:mx-0 lg:mb-0 lg:w-52 lg:shrink-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:rounded-2xl lg:bg-white lg:p-3 lg:shadow-sm"
      >
        <p className="hidden px-2 pb-2 pt-1 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500 lg:block">Tasks</p>
        <div className="flex gap-1.5 lg:flex-col lg:gap-0.5" role="group" aria-label="Whose tasks">
          {views.map((v) => {
            const Icon = VIEW_ICONS[v.value];
            const active = view === v.value;
            return (
              <button
                key={v.value}
                aria-pressed={active}
                onClick={() => setView(v.value)}
                className={`inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors lg:rounded-xl lg:px-2.5 lg:py-2 ${
                  active ? 'bg-gray-900 text-white lg:bg-blue-50 lg:font-semibold lg:text-blue-800' : 'bg-white text-gray-700 shadow-sm hover:bg-gray-100 lg:bg-transparent lg:shadow-none'
                }`}
              >
                <Icon aria-hidden className="hidden h-4 w-4 lg:block" />{v.label}
              </button>
            );
          })}
        </div>
        {(late > 0 || today > 0) && (
          <>
            <p className="hidden px-2 pb-1 pt-4 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500 lg:block">Needs attention</p>
            <div className="flex gap-1.5 lg:flex-col lg:gap-1 lg:px-1">
              {late > 0 && <Counter n={late} label="late" tone="bg-red-100 text-red-800" active={view === 'mine' && due === 'overdue'} onClick={() => showMine('overdue')} />}
              {today > 0 && <Counter n={today} label="today" tone="bg-amber-100 text-amber-800" active={view === 'mine' && due === 'today'} onClick={() => showMine('today')} />}
            </div>
          </>
        )}
        <button
          onClick={() => setShortcuts(true)}
          aria-label="Keyboard shortcuts"
          className="mt-4 hidden items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 lg:flex"
        >
          <Keyboard aria-hidden className="h-4 w-4" /> Shortcuts <Kbd className="ml-auto">?</Kbd>
        </button>
      </nav>

      <div className="min-w-0 flex-1 space-y-4">
        <header className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1 basis-full sm:basis-auto">
            <h1 className="pn-title text-2xl text-gray-900">{current.label === 'For me' ? 'Tasks for me' : current.label}</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {view === 'mine' && (late || today)
                ? <>{late > 0 && <span className="font-semibold text-red-700">{late} late</span>}{late > 0 && today > 0 && ' · '}{today > 0 && <span className="font-semibold text-amber-800">{today} due today</span>}</>
                : view === 'created' ? 'Jobs you gave to others, and how far they have got.'
                  : view === 'team' ? (isAdmin ? 'Every team’s open work.' : 'Everything your team is working on.')
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
              className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-8 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <span className="pointer-events-none absolute right-2 hidden sm:block"><Kbd>/</Kbd></span>
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
          {narrowed && <button onClick={clear} className="text-sm font-medium text-blue-700 hover:underline">Clear filters</button>}
        </div>

        {layout === 'board' ? (
          <TaskBoard filters={filters} onOpen={setOpenId} quickAddFor={quickAddFor} />
        ) : (
          <TaskListView
            filters={filters}
            onOpen={setOpenId}
            quickAddFor={quickAddFor}
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
