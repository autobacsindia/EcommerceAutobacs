'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, CalendarClock, Columns3, Flag, Info, List, ListTodo, Plus, Search, User, X } from 'lucide-react';
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
function HowItWorks({ canGive }: { canGive: boolean }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => { setHidden(read(HELP_KEY) === '1'); }, []);
  if (hidden) return null;
  return (
    <aside className="relative flex gap-3 rounded-xl border border-sky-200 bg-sky-50 p-3 pr-10 text-sm text-sky-900">
      <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-semibold">How tasks work</p>
        <p className="mt-0.5">
          Press <strong>New task</strong> (or the N key){canGive ? ', choose who should do it' : ''} and pick a due date.
          {canGive ? ' They get a pop-up and find it under For me.' : ''} Tick the circle when a job is done; open a task to comment, add steps or change it.
          {!canGive && ' Team heads and the admin can give jobs to other people; you can add jobs for yourself.'}
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
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition ${tone} ${active ? 'ring-2 ring-offset-1 ring-current' : 'hover:opacity-80'}`}
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

  // N = new task, / = search — not while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      const typing = el instanceof Element && !!el.closest('input, textarea, select, [contenteditable="true"]');
      if (e.metaKey || e.ctrlKey || e.altKey || typing) return;
      if (openId || creating) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setCreating(true); }
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId, creating]);

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

  const pill = (active: boolean) => `rounded-full px-3 py-1 text-sm font-medium transition ${
    active ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
  }`;
  const control = 'rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 hover:border-gray-300';

  return (
    <div className="space-y-4">
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Tasks</h1>
            <p className="text-sm text-gray-500">Who has to do what, and by when.</p>
          </div>
          <button onClick={() => setCreating(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700" title="New task (N)">
            <Plus className="h-4 w-4" /> New task
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex min-w-0 flex-1 items-center sm:max-w-sm">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 h-4 w-4 text-gray-400" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); (e.target as HTMLInputElement).blur(); } }}
              placeholder="Search tasks or T-number"
              aria-label="Search tasks"
              maxLength={100}
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-8 pr-8 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <kbd className="pointer-events-none absolute right-2 hidden rounded border border-gray-200 px-1 text-[10px] text-gray-400 sm:block">/</kbd>
          </label>
          {(summary.data?.late ?? 0) > 0 && (
            <Counter n={summary.data!.late} label="late" tone="bg-red-100 text-red-800" active={view === 'mine' && due === 'overdue'} onClick={() => showMine('overdue')} />
          )}
          {(summary.data?.today ?? 0) > 0 && (
            <Counter n={summary.data!.today} label="today" tone="bg-amber-100 text-amber-800" active={view === 'mine' && due === 'today'} onClick={() => showMine('today')} />
          )}
        </div>
      </header>

      <HowItWorks canGive={canSeeTeam} />

      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-200">
        <div className="flex gap-1" role="tablist" aria-label="Show as">
          {([['list', 'List', List], ['board', 'Board', Columns3]] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              role="tab"
              aria-selected={layout === value}
              onClick={() => setLayout(value)}
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
                layout === value ? 'border-blue-600 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              <Icon aria-hidden className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        <div className="mb-1.5 flex gap-1 rounded-full bg-gray-100 p-0.5" role="group" aria-label="Whose tasks">
          {views.map((v) => (
            <button key={v.value} aria-pressed={view === v.value} onClick={() => setView(v.value)} className={pill(view === v.value)}>{v.label}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
        <div className="flex flex-wrap gap-1" role="group" aria-label="Due date">
          {DUES.map((d) => (
            <button
              key={d.value || 'any'}
              aria-pressed={due === d.value || (d.value === 'overdue' && due === 'late')}
              onClick={() => setDue(d.value)}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                due === d.value || (d.value === 'overdue' && due === 'late') ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              {d.label}
            </button>
          ))}
          {due === 'late' && <span className="self-center text-xs text-gray-500">(late or due today)</span>}
        </div>
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

      <SidePanel open={!!openId} onClose={() => setOpenId(null)} label="Task">
        {openId && <TaskDetail id={openId} base={base} onClose={() => setOpenId(null)} />}
      </SidePanel>

      <Dialog open={creating} onClose={() => setCreating(false)} label="New task">
        <TaskForm onDone={(t) => { setCreating(false); if (t?.id) setOpenId(t.id); }} onCancel={() => setCreating(false)} />
      </Dialog>
    </div>
  );
}
