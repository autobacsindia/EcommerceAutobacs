'use client';

/**
 * Projects in the Tasks module (services/staffProjectService.js): one piece of
 * work — an owner, people, dates and a deadline — whose tasks may come from
 * several teams. A task stays in its own team's list; it also names a project.
 *
 * The server decides everything: who sees a project, who may change it, its
 * progress and its status. These screens show what it says and hide only what
 * it would refuse (`can`, `canCreate`).
 */
import { useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowDown, ArrowUp, CalendarDays, ChevronRight, CircleDot, FolderKanban, ListTree, Loader2, Pencil, Plus, Trash2, TriangleAlert, UserPlus, Users, X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import AssigneePicker from './AssigneePicker';
import { useAssignees } from './TaskForm';
import { Avatar, AvatarStack } from './ui';
import { Dialog } from './Overlays';
import { STAGE_TYPES, formatDueDay, isConflict, newClientId, type Project, type ProjectPage, type ProjectStatus, type TaskStatus } from './types';
import { PROJECT_COLOURS, projectDot } from './ProjectPicker';
import { ProjectDetailsPanel } from './ProjectDetails';
import { SaveAsTemplate, TemplatePicker, fromTemplateMessage, type FromTemplate } from './JobTemplates';

export { PROJECT_COLOURS, projectDot, ProjectPicker, useProjectPick } from './ProjectPicker';

const STATUS_STYLE: Record<ProjectStatus, string> = {
  on_track: 'bg-green-100 text-green-800',
  at_risk: 'bg-amber-100 text-amber-900',
  late: 'bg-red-100 text-red-800',
  done: 'bg-blue-100 text-blue-800',
};
const BAR: Record<ProjectStatus, string> = {
  on_track: 'bg-green-600', at_risk: 'bg-amber-500', late: 'bg-red-600', done: 'bg-blue-600',
};
export const PROJECT_STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: 'on_track', label: 'On track' },
  { value: 'at_risk', label: 'At risk' },
  { value: 'late', label: 'Late' },
  { value: 'done', label: 'Done' },
];

export function ProjectStatusPill({ p }: { p: Pick<Project, 'status' | 'statusLabel' | 'statusOverride'> }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[p.status]}`}
      title={p.statusOverride ? 'Set by the project owner' : 'Worked out from the tasks and the deadline'}
    >
      {p.statusLabel}
    </span>
  );
}

/** "3 of 5 done", with a bar coloured by how the project stands. */
export function ProgressBar({ p, className = '' }: { p: Pick<Project, 'progress' | 'status'>; className?: string }) {
  const { total, done, percent } = p.progress;
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-2 text-xs text-gray-600">
        <span>{total ? `${done} of ${total} task${total === 1 ? '' : 's'} done` : 'No tasks yet'}</span>
        <span className="font-semibold tabular-nums text-gray-900">{percent}%</span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-200"
        role="progressbar"
        aria-label="Progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className={`h-full rounded-full ${BAR[p.status]}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

const datesText = (p: Pick<Project, 'startOn' | 'dueOn'>) => (p.startOn && p.dueOn
  ? `${formatDueDay(p.startOn)} → ${formatDueDay(p.dueOn)}`
  : p.dueOn ? `Due ${formatDueDay(p.dueOn)}` : p.startOn ? `From ${formatDueDay(p.startOn)}` : 'No deadline');

// ── Reads ───────────────────────────────────────────────────────────────────

export function useProjectPages(state: 'active' | 'archived', enabled = true) {
  return useInfiniteQuery({
    queryKey: taskKeys.projectList(state),
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ state, ...(pageParam ? { cursor: pageParam } : {}) });
      return apiClient.get<ProjectPage>(`/staff/tasks/projects?${qs}`);
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    refetchInterval: 60_000,
    enabled,
  });
}

export function useProject(id: string | null | undefined) {
  return useQuery({
    queryKey: taskKeys.project(id || ''),
    queryFn: () => apiClient.get<{ project: Project }>(`/staff/tasks/projects/${encodeURIComponent(id || '')}`).then((r) => r.project),
    enabled: !!id,
    // "Not found" (deleted, or not yours) will not change on a retry: say so at once.
    retry: (count, e) => (e as { status?: number })?.status !== 404 && count < 1,
    refetchInterval: 60_000,
  });
}

/** Save one change to a project (its lists, from the tabs), against the revision shown. */
function useSaveProject(p: Project) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) => apiClient.patch<{ project: Project }>(`/staff/tasks/projects/${encodeURIComponent(p.id)}`, { rev: p.rev, ...patch }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.projects() });
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
    onError: (e) => {
      if (isConflict(e)) queryClient.invalidateQueries({ queryKey: taskKeys.projects() });
      toast.error(isConflict(e) ? 'Someone changed this project just now — it has been reloaded. Try again.' : errorMessage(e, 'Could not save the project.'));
    },
  });
}

/**
 * The lists inside a project, as tabs over its tasks (ClickUp's Folder → Lists):
 * "All tasks", each list, and "No list" for tasks in none. The owner (and the
 * admin) adds a list right here; renaming, ordering and deleting are in Edit.
 */
export function ProjectListTabs({ p, value, onChange }: { p: Project; value: string; onChange: (plist: string) => void }) {
  const save = useSaveProject(p);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  // A list deleted since the link was made: show everything rather than nothing.
  const current = value === 'none' || p.lists.some((l) => l.id === value) ? value : '';
  if (!p.lists.length && !p.can.edit) return null;
  const tab = (key: string, label: string) => (
    <button
      key={key || 'all'}
      role="tab"
      aria-selected={current === key}
      onClick={() => onChange(key)}
      className={`-mb-px inline-flex h-9 shrink-0 items-center whitespace-nowrap border-b-2 px-2.5 text-sm font-medium ${
        current === key ? 'border-blue-500 font-semibold text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-900'
      }`}
    >
      {label}
    </button>
  );
  const add = () => {
    const n = name.replace(/\s+/g, ' ').trim();
    if (!n) { setAdding(false); return; }
    save.mutate({ lists: [...p.lists, { name: n }] }, {
      onSuccess: (res) => {
        setName('');
        setAdding(false);
        const made = res.project.lists.find((l) => l.name.toLowerCase() === n.toLowerCase());
        if (made) onChange(made.id);
      },
    });
  };
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-gray-200 [scrollbar-width:thin]">
      <ListTree aria-hidden className="mr-1 h-4 w-4 shrink-0 text-gray-400" />
      <div role="tablist" aria-label="Lists in this project" className="flex shrink-0 items-center">
        {tab('', 'All tasks')}
        {p.lists.map((l) => tab(l.id, l.name))}
        {p.lists.length > 0 && tab('none', 'No list')}
      </div>
      {p.can.edit && (adding ? (
        <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex shrink-0 items-center gap-1 py-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setAdding(false); setName(''); } }}
            maxLength={60}
            placeholder="List name, e.g. Ads"
            aria-label="New list name"
            className="h-8 w-40 rounded-md border border-gray-300 px-2 text-sm"
          />
          <button type="submit" disabled={save.isPending} className="h-8 rounded-md bg-blue-600 px-2.5 text-xs font-semibold text-white disabled:opacity-50">Add</button>
          <button type="button" onClick={() => { setAdding(false); setName(''); }} aria-label="Cancel" className="rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex h-9 shrink-0 items-center gap-1 px-2 text-sm font-medium text-gray-500 hover:text-blue-700">
          <Plus aria-hidden className="h-4 w-4" /> Add list
        </button>
      ))}
    </div>
  );
}

// ── The Projects page ───────────────────────────────────────────────────────

function ProjectCard({ p, onOpen }: { p: Project; onOpen: (id: string) => void }) {
  return (
    <li>
      <button
        onClick={() => onOpen(p.id)}
        className="group flex h-full w-full flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left shadow-[0_1px_2px_rgba(20,22,40,0.04)] transition hover:border-gray-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-blue-500"
      >
        <span className="flex min-w-0 items-start gap-2">
          <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm ${projectDot(p.colour)}`} />
          <span className="min-w-0 flex-1 truncate font-semibold text-gray-900 group-hover:text-blue-700" title={p.name}>{p.name}</span>
          {p.code && <ProjectCode code={p.code} />}
          <ProjectStatusPill p={p} />
        </span>
        <ProgressBar p={p} />
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1"><CalendarDays aria-hidden className="h-3.5 w-3.5 text-gray-400" />{datesText(p)}</span>
          {p.progress.overdue > 0 && (
            <span className="inline-flex items-center gap-1 font-medium text-red-700"><TriangleAlert aria-hidden className="h-3.5 w-3.5" />{p.progress.overdue} late</span>
          )}
        </span>
        <span className="mt-auto flex min-w-0 items-center justify-between gap-2 border-t border-gray-100 pt-2.5">
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-gray-700">
            <Avatar name={p.owner.name} id={p.owner.id} size="xs" />
            <span className="truncate"><span className="text-gray-500">Owner </span>{p.owner.name}</span>
          </span>
          <span className="flex min-w-0 flex-wrap justify-end gap-1">
            {p.teams.slice(0, 3).map((t) => (
              <span key={t.value} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-700">{t.label}</span>
            ))}
            {p.teams.length > 3 && <span className="text-[11px] text-gray-500">+{p.teams.length - 3}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

/** Every project this person sees, soonest deadline first; deleted ones (to restore) behind a switch. */
export function ProjectsView({ onOpen, isAdmin }: { onOpen: (id: string) => void; isAdmin: boolean }) {
  const [state, setState] = useState<'active' | 'archived'>('active');
  const [creating, setCreating] = useState(false);
  const pages = useProjectPages(state);
  const rows = (pages.data?.pages ?? []).flatMap((pg) => pg.projects);
  const canCreate = pages.data?.pages[0]?.canCreate ?? false;
  // A plain member owns what they start; the admin and heads may start one for someone else.
  const canPickOwner = isAdmin || (pages.data?.pages[0]?.canPickOwner ?? true);
  return (
    <section aria-label="Projects" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-0.5 rounded-full border border-gray-200 bg-white p-0.5" role="group" aria-label="Which projects">
          {(['active', 'archived'] as const).map((s) => (
            <button
              key={s}
              aria-pressed={state === s}
              onClick={() => setState(s)}
              className={`h-7 rounded-full px-3 text-[13px] font-medium ${state === s ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {s === 'active' ? 'Active' : 'Deleted'}
            </button>
          ))}
        </div>
        {canCreate && (
          <button onClick={() => setCreating(true)} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50">
            <Plus aria-hidden className="h-4 w-4" /> New project
          </button>
        )}
      </div>

      {pages.isPending ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => <li key={i} className="h-40 animate-pulse rounded-xl border border-gray-200 bg-gray-50" />)}
        </ul>
      ) : pages.isError ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage(pages.error, 'Could not load the projects.')}</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><FolderKanban className="h-6 w-6" /></span>
          <p className="font-semibold text-gray-900">{state === 'archived' ? 'No deleted projects' : 'No projects yet'}</p>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            {state === 'archived'
              ? 'Projects you delete land here, ready to restore.'
              : canCreate
                ? 'A project groups tasks from any team — for example a Diwali launch with Marketing, Procurement and Developer tasks — with an owner, a deadline and a progress bar.'
                : 'When you are added to a project, it shows up here.'}
          </p>
          {state === 'active' && canCreate && (
            <button onClick={() => setCreating(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              <Plus className="h-4 w-4" /> New project
            </button>
          )}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => <ProjectCard key={p.id} p={p} onOpen={onOpen} />)}
        </ul>
      )}
      {pages.hasNextPage && (
        <div className="flex justify-center">
          <button onClick={() => pages.fetchNextPage()} disabled={pages.isFetchingNextPage} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {pages.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />} Show more projects
          </button>
        </div>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} label="New project">
        {creating && <ProjectForm isAdmin={isAdmin} pickOwner={canPickOwner} onCancel={() => setCreating(false)} onDone={(p) => { setCreating(false); onOpen(p.id); }} />}
      </Dialog>
    </section>
  );
}

// ── One project ─────────────────────────────────────────────────────────────

/** The project's head above its tasks: progress, owner, dates, people — and Edit for its owner. */
export function ProjectHeader({ p, onBack, isAdmin }: { p: Project; onBack: () => void; isAdmin: boolean }) {
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();
  const restore = useMutation({
    mutationFn: () => apiClient.patch<{ project: Project }>(`/staff/tasks/projects/${encodeURIComponent(p.id)}`, { rev: p.rev, archived: false }),
    onSuccess: () => { toast.success('Project restored'); return queryClient.invalidateQueries({ queryKey: taskKeys.projects() }); },
    onError: (e) => toast.error(isConflict(e) ? 'Someone changed this project just now — refreshed.' : errorMessage(e, 'Could not restore the project.')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: taskKeys.projects() }),
  });
  return (
    <section aria-label="Project" className="space-y-2">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs font-medium text-gray-600">
        <button onClick={onBack} className="rounded px-0.5 hover:text-gray-900 hover:underline">Projects</button>
        <ChevronRight aria-hidden className="h-3 w-3 text-gray-500" />
        <span aria-current="page" className="truncate text-gray-900">{p.name}</span>
      </nav>
      {p.archivedAt && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This project is deleted. Its tasks are untouched.
          {p.can.restore && (
            <button onClick={() => restore.mutate()} disabled={restore.isPending} className="font-semibold underline">Restore it</button>
          )}
        </p>
      )}
      <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span aria-hidden className={`h-3 w-3 shrink-0 rounded-sm ${projectDot(p.colour)}`} />
            <h2 className="min-w-0 truncate text-lg font-semibold text-gray-900" title={p.name}>{p.name}</h2>
            {p.code && <ProjectCode code={p.code} />}
            <ProjectStatusPill p={p} />
            {p.can.edit && (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <SaveAsTemplate p={p} />
                <button onClick={() => setEditing(true)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  <Pencil aria-hidden className="h-3.5 w-3.5" /> Edit
                </button>
              </div>
            )}
          </div>
          {p.description && <p className="whitespace-pre-line text-sm text-gray-700">{p.description}</p>}
          <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
            <div className="flex min-w-0 items-center gap-1.5">
              <dt className="text-gray-500">Owner</dt>
              <dd className="flex min-w-0 items-center gap-1.5 text-gray-900"><Avatar name={p.owner.name} id={p.owner.id} size="xs" /><span className="truncate">{p.owner.name}</span></dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Dates</dt>
              <dd className="flex items-center gap-1 text-gray-700"><CalendarDays aria-hidden className="h-4 w-4 text-gray-400" />{datesText(p)}</dd>
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <dt className="flex items-center gap-1 text-gray-500"><Users aria-hidden className="h-4 w-4 text-gray-400" /><span className="sr-only">People</span></dt>
              <dd className="flex min-w-0 items-center gap-1.5" title={p.people.map((x) => x.name).join(', ')}>
                <AvatarStack people={p.people} max={5} />
                <span className="text-gray-700">{p.people.length} {p.people.length === 1 ? 'person' : 'people'}</span>
              </dd>
            </div>
            {p.teams.length > 0 && (
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                <dt className="sr-only">Teams</dt>
                {p.teams.map((t) => <dd key={t.value} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700">{t.label}</dd>)}
              </div>
            )}
          </dl>
        </div>
        <div className="space-y-2 lg:border-l lg:border-gray-100 lg:pl-4">
          <ProgressBar p={p} />
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-gray-50 px-2 py-1.5">
              <p className="text-lg font-semibold tabular-nums text-gray-900">{p.progress.total - p.progress.done}</p>
              <p className="text-xs text-gray-600">open</p>
            </div>
            <div className={`rounded-lg px-2 py-1.5 ${p.progress.overdue ? 'bg-red-50' : 'bg-gray-50'}`}>
              <p className={`text-lg font-semibold tabular-nums ${p.progress.overdue ? 'text-red-700' : 'text-gray-900'}`}>{p.progress.overdue}</p>
              <p className="text-xs text-gray-600">late</p>
            </div>
          </div>
        </div>
      </div>
      <ProjectDetailsPanel p={p} />
      <Dialog open={editing} onClose={() => setEditing(false)} label="Edit project">
        {editing && <ProjectForm project={p} isAdmin={isAdmin} onCancel={() => setEditing(false)} onDone={() => setEditing(false)} onDeleted={() => { setEditing(false); onBack(); }} />}
      </Dialog>
    </section>
  );
}

// ── New / edit ──────────────────────────────────────────────────────────────

/**
 * Start a project (admin, team heads) or change one (its owner, the admin).
 * Nothing shows as saved until the server says so; a double click makes one
 * project (one clientId per form).
 */
type ListDraft = { key: string; id?: string; name: string };
type StageDraft = { key: string; id?: string; name: string; colour: string; type: TaskStatus };
let draftSeq = 0;
const draftKey = () => `d${(draftSeq += 1)}`;
/** The usual three, as a starting point when a project turns on its own statuses. */
const STARTER_STAGES = (): StageDraft[] => [
  { key: draftKey(), name: 'To do', colour: 'gray', type: 'todo' },
  { key: draftKey(), name: 'In progress', colour: 'blue', type: 'in_progress' },
  { key: draftKey(), name: 'Done', colour: 'green', type: 'done' },
];
const folded = (x: string) => x.replace(/\s+/g, ' ').trim().toLowerCase();
const dupName = (names: string[]) => names.map(folded).find((n, i, all) => n && all.indexOf(n) !== i);
const moveIn = <T,>(list: T[], i: number, by: number) => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};
const rowButton = 'rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30';

/** Lists inside the project: names, in order. A deleted list's tasks go to "No list". */
function ListsEditor({ lists, onChange }: { lists: ListDraft[]; onChange: (l: ListDraft[]) => void }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-500"><ListTree aria-hidden className="h-3.5 w-3.5" /> Lists (optional)</legend>
      {lists.map((l, i) => (
        <div key={l.key} className="flex items-center gap-1">
          <input
            value={l.name}
            onChange={(e) => onChange(lists.map((x) => (x.key === l.key ? { ...x, name: e.target.value } : x)))}
            maxLength={60}
            aria-label={`List ${i + 1} name`}
            placeholder="e.g. Ads"
            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-900"
          />
          <button type="button" onClick={() => onChange(moveIn(lists, i, -1))} disabled={i === 0} aria-label={`Move ${l.name || 'list'} up`} className={rowButton}><ArrowUp className="h-4 w-4" /></button>
          <button type="button" onClick={() => onChange(moveIn(lists, i, 1))} disabled={i === lists.length - 1} aria-label={`Move ${l.name || 'list'} down`} className={rowButton}><ArrowDown className="h-4 w-4" /></button>
          <button type="button" onClick={() => onChange(lists.filter((x) => x.key !== l.key))} aria-label={`Remove ${l.name || 'list'}`} className={rowButton}><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      {lists.length < 20 && (
        <button type="button" onClick={() => onChange([...lists, { key: draftKey(), name: '' }])} className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline">
          <Plus aria-hidden className="h-4 w-4" /> Add a list
        </button>
      )}
      <p className="text-xs text-gray-500">Split the project into parts, like “Ads”, “Website” and “Emails”. Removing a list keeps its tasks: they move to “No list”.</p>
    </fieldset>
  );
}

/** The project's own statuses: name, colour and what each counts as. None = To do / In progress / Done. */
function StatusesEditor({ stages, onChange }: { stages: StageDraft[]; onChange: (s: StageDraft[]) => void }) {
  if (!stages.length) {
    return (
      <fieldset>
        <legend className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-500"><CircleDot aria-hidden className="h-3.5 w-3.5" /> Statuses</legend>
        <p className="text-sm text-gray-700">Using the usual three: To do, In progress, Done.</p>
        <button type="button" onClick={() => onChange(STARTER_STAGES())} className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline">
          <Plus aria-hidden className="h-4 w-4" /> Use this project’s own statuses
        </button>
      </fieldset>
    );
  }
  const set = (key: string, patch: Partial<StageDraft>) => onChange(stages.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-500"><CircleDot aria-hidden className="h-3.5 w-3.5" /> Statuses (board columns, in order)</legend>
      {stages.map((x, i) => (
        <div key={x.key} className="flex flex-wrap items-center gap-1 sm:flex-nowrap">
          <select value={x.colour} onChange={(e) => set(x.key, { colour: e.target.value })} aria-label={`${x.name || 'Status'} colour`} className="w-20 rounded-lg border border-gray-200 px-1 py-1.5 text-xs">
            {PROJECT_COLOURS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            value={x.name}
            onChange={(e) => set(x.key, { name: e.target.value })}
            maxLength={30}
            aria-label={`Status ${i + 1} name`}
            placeholder="e.g. Review"
            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-900"
          />
          <select value={x.type} onChange={(e) => set(x.key, { type: e.target.value as TaskStatus })} aria-label={`${x.name || 'Status'} counts as`} className="rounded-lg border border-gray-200 px-1 py-1.5 text-xs">
            {STAGE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <button type="button" onClick={() => onChange(moveIn(stages, i, -1))} disabled={i === 0} aria-label={`Move ${x.name || 'status'} up`} className={rowButton}><ArrowUp className="h-4 w-4" /></button>
          <button type="button" onClick={() => onChange(moveIn(stages, i, 1))} disabled={i === stages.length - 1} aria-label={`Move ${x.name || 'status'} down`} className={rowButton}><ArrowDown className="h-4 w-4" /></button>
          <button type="button" onClick={() => onChange(stages.filter((y) => y.key !== x.key))} aria-label={`Remove ${x.name || 'status'}`} className={rowButton}><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <div className="flex flex-wrap gap-3">
        {stages.length < 12 && (
          <button type="button" onClick={() => onChange([...stages, { key: draftKey(), name: '', colour: 'gray', type: 'in_progress' }])} className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline">
            <Plus aria-hidden className="h-4 w-4" /> Add a status
          </button>
        )}
        <button type="button" onClick={() => onChange([])} className="text-sm font-medium text-gray-500 hover:underline">Go back to the usual three</button>
      </div>
      <p className="text-xs text-gray-500">“Counts as” decides what the status means everywhere else: Done finishes the task. Removing a status moves its tasks to the first status that counts the same.</p>
    </fieldset>
  );
}

export function ProjectForm({ project, isAdmin, pickOwner = true, onDone, onCancel, onDeleted }: {
  project?: Project; isAdmin: boolean;
  /** New project only: false for a plain member, who owns what they start. */
  pickOwner?: boolean;
  onDone: (p: Project) => void; onCancel: () => void; onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const people = useAssignees();
  const choices = people.data?.people ?? [];
  const me = choices.find((p) => p.me);
  const clientId = useRef(newClientId());
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [colour, setColour] = useState(project?.colour ?? 'blue');
  const [startOn, setStartOn] = useState(project?.startOn ?? '');
  const [dueOn, setDueOn] = useState(project?.dueOn ?? '');
  const [ownerId, setOwnerId] = useState<string>(project?.owner.id ?? '');
  const owner = (!project && !pickOwner ? '' : ownerId) || me?.id || '';
  const [memberIds, setMemberIds] = useState<string[]>(project ? project.people.map((x) => x.id).filter((x) => x !== project.owner.id) : []);
  const [statusOverride, setStatusOverride] = useState<string>(project?.statusOverride ?? 'auto');
  const [lists, setLists] = useState<ListDraft[]>(() => (project?.lists ?? []).map((l) => ({ key: draftKey(), id: l.id, name: l.name })));
  const [stages, setStages] = useState<StageDraft[]>(() => (project?.statuses ?? []).map((x) => ({ key: draftKey(), id: x.id, name: x.name, colour: x.colour, type: x.type })));
  const [error, setError] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  // New project only: start from a job template (its columns, lists and tasks) instead of blank.
  const [templateId, setTemplateId] = useState('');
  const fromTemplate = !project && !!templateId;
  const datesBackwards = !!startOn && !!dueOn && startOn > dueOn;
  const nameMissing = !name.trim();
  // Shown once they leave the box, try to save, or start typing elsewhere —
  // so a name typed into the description box is explained, not silently refused.
  const showNameError = nameTouched || !!description.trim();
  // The server's rules for lists and statuses, said before it would refuse.
  const listProblem = lists.some((l) => !l.name.trim()) ? 'Name every list, or remove the empty one.'
    : dupName(lists.map((l) => l.name)) ? 'Two lists have the same name.' : '';
  const stageProblem = !stages.length ? ''
    : stages.some((x) => !x.name.trim()) ? 'Name every status, or remove the empty one.'
      : dupName(stages.map((x) => x.name)) ? 'Two statuses have the same name.'
        : !stages.some((x) => x.type === 'todo') ? 'Keep at least one status that counts as “Not started”.'
          : !stages.some((x) => x.type === 'done') ? 'Keep at least one status that counts as “Done”.' : '';
  const blockedBecause = nameMissing ? 'Add a project name to continue.' : datesBackwards ? 'Fix the dates to continue.' : !owner ? 'Pick an owner to continue.'
    : fromTemplate ? '' : listProblem || stageProblem;
  const members = memberIds.filter((x) => x !== owner);
  const byId = new Map(choices.map((p) => [p.id, p]));
  const picked = members.map((x) => byId.get(x)).filter((p): p is NonNullable<typeof p> => !!p);
  const done = (p: Project) => {
    queryClient.invalidateQueries({ queryKey: taskKeys.projects() });
    onDone(p);
  };

  const save = useMutation({
    mutationFn: () => {
      const fields = {
        name: name.trim(), description: description.trim(), colour, startOn: startOn || null, dueOn: dueOn || null,
        ...(isAdmin || !project ? { ownerId: owner } : {}), memberIds: members,
        // A template brings its own lists and columns.
        ...(fromTemplate ? { templateId } : {
          lists: lists.map((l) => ({ ...(l.id ? { id: l.id } : {}), name: l.name.trim() })),
          statuses: stages.map((x) => ({ ...(x.id ? { id: x.id } : {}), name: x.name.trim(), colour: x.colour, type: x.type })),
        }),
      };
      return project
        ? apiClient.patch<{ project: Project; fromTemplate?: FromTemplate }>(`/staff/tasks/projects/${encodeURIComponent(project.id)}`, { rev: project.rev, ...fields, statusOverride })
        : apiClient.post<{ project: Project; fromTemplate?: FromTemplate }>('/staff/tasks/projects', { ...fields, clientId: clientId.current });
    },
    onSuccess: (res) => {
      if (res.fromTemplate) {
        // Longer on screen when something was moved or left out, so it can be read.
        const notable = res.fromTemplate.failed.length > 0 || res.fromTemplate.movedEarlier > 0;
        toast.success(fromTemplateMessage(res.fromTemplate), notable ? { duration: 10_000 } : undefined);
      } else toast.success(project ? 'Project saved' : 'Project created');
      done(res.project);
    },
    onError: (e) => {
      if (isConflict(e)) queryClient.invalidateQueries({ queryKey: taskKeys.projects() });
      setError(isConflict(e) ? 'Someone changed this project just now. Close and open it again to see their change.' : errorMessage(e, 'Could not save the project.'));
    },
  });
  const remove = useMutation({
    mutationFn: () => apiClient.patch<{ project: Project }>(`/staff/tasks/projects/${encodeURIComponent(project!.id)}`, { rev: project!.rev, archived: true }),
    onSuccess: () => { toast.success('Project deleted. Its tasks are untouched.'); queryClient.invalidateQueries({ queryKey: taskKeys.projects() }); onDeleted?.(); },
    onError: (e) => setError(errorMessage(e, 'Could not delete the project.')),
  });
  const busy = save.isPending || remove.isPending;

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); setError(''); setNameTouched(true); if (!blockedBecause) save.mutate(); }}
      className="flex max-h-[85vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-gray-900">{project ? 'Edit project' : 'New project'}</h2>
        <button type="button" onClick={onCancel} aria-label="Close" className="rounded-md p-1 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <label className="block text-xs font-medium text-gray-500">
          <span className="mb-1 block">Project name <span aria-hidden className="text-red-600">*</span></span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setNameTouched(true)}
            maxLength={80}
            required
            autoFocus
            aria-label="Project name"
            placeholder="e.g. Diwali 2026 launch"
            aria-invalid={nameMissing && showNameError}
            aria-describedby={nameMissing && showNameError ? 'project-name-error' : undefined}
            className={`w-full rounded-lg border px-3 py-2 text-base font-semibold text-gray-900 placeholder:font-normal placeholder:text-gray-400 ${nameMissing && showNameError ? 'border-red-400' : 'border-gray-300'}`}
          />
          {nameMissing && showNameError && (
            <span id="project-name-error" role="alert" className="mt-1 block font-medium text-red-700">Name is required. Type the project name here.</span>
          )}
        </label>
        <label className="block text-xs font-medium text-gray-500">
          <span className="mb-1 block">Description (optional)</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder="What is it for?"
          className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal text-gray-900"
        />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-gray-500">
            <span className="mb-1 block">Start date</span>
            <input type="date" aria-label="Start date" value={startOn} max={dueOn || undefined} onChange={(e) => setStartOn(e.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-gray-500">
            <span className="mb-1 block">Deadline</span>
            <input type="date" aria-label="Deadline" value={dueOn} min={startOn || undefined} onChange={(e) => setDueOn(e.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
          </label>
        </div>
        {datesBackwards && <p role="alert" className="text-xs font-medium text-red-700">The start date is after the deadline.</p>}
        <label className="block text-xs font-medium text-gray-500">
          <span className="mb-1 block">Owner</span>
          {!project && !pickOwner ? (
            <span className="flex items-center gap-1.5 text-sm text-gray-900">{me && <Avatar name={me.name} id={me.id} size="xs" />}You<span className="text-xs font-normal text-gray-500">(you own the projects you start)</span></span>
          ) : isAdmin || !project ? (
            <select value={owner} onChange={(e) => setOwnerId(e.target.value)} aria-label="Owner" className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm text-gray-900">
              {!owner && <option value="">Pick the owner</option>}
              {choices.map((p) => <option key={p.id} value={p.id}>{p.me ? `Me (${p.name})` : `${p.name}${p.teamLabel ? ` · ${p.teamLabel}` : ''}`}</option>)}
            </select>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-gray-900"><Avatar name={project.owner.name} id={project.owner.id} size="xs" />{project.owner.name}<span className="text-xs font-normal text-gray-500">(only the admin can change the owner)</span></span>
          )}
        </label>
        <div className="space-y-1.5">
          <span className="flex items-center gap-1 text-xs font-medium text-gray-500"><Users aria-hidden className="h-3.5 w-3.5" /> Members</span>
          <AssigneePicker
            people={choices.filter((p) => p.id !== owner)}
            selected={members}
            onChange={setMemberIds}
            max={49}
            label="Members"
            triggerLabel="Add members"
            trigger={picked.length ? (
              <span className="inline-flex max-w-full items-center gap-2 rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-800 hover:border-gray-300">
                <AvatarStack people={picked} max={5} size="sm" />
                <span className="min-w-0 truncate">{picked.map((p) => p.name.split(' ')[0]).join(', ')}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 px-2 py-1 text-sm text-gray-500 hover:border-gray-400">
                <UserPlus aria-hidden className="h-4 w-4" /> Add members
              </span>
            )}
          />
          <p className="text-xs text-gray-500">Members, and the heads of their teams, can read and comment on every task in the project. Who can change a task stays the same.</p>
        </div>
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-gray-500">Colour</legend>
          <div className="flex flex-wrap gap-1.5">
            {PROJECT_COLOURS.map((c) => (
              <label key={c} className="cursor-pointer">
                <input type="radio" name="project-colour" value={c} checked={colour === c} onChange={() => setColour(c)} className="peer sr-only" aria-label={c} />
                <span aria-hidden className={`block h-6 w-6 rounded-md ${projectDot(c)} ring-offset-2 peer-checked:ring-2 peer-checked:ring-gray-900 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500`} />
              </label>
            ))}
          </div>
        </fieldset>
        {!project && <TemplatePicker value={templateId} onChange={setTemplateId} />}
        {fromTemplate ? (
          <p className="text-xs text-gray-500">The lists and columns come from the template. You can change them after the project is made.</p>
        ) : (
          <>
            <ListsEditor lists={lists} onChange={setLists} />
            <StatusesEditor stages={stages} onChange={setStages} />
          </>
        )}
        {project && (
          <label className="block text-xs font-medium text-gray-500">
            <span className="mb-1 block">Project status</span>
            <select value={statusOverride} onChange={(e) => setStatusOverride(e.target.value)} aria-label="Status" className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm text-gray-900">
              <option value="auto">Automatic — from the tasks and the deadline</option>
              {PROJECT_STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        )}
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
      <div className="flex items-center gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
        {project?.can.archive && (
          <button
            type="button"
            onClick={() => { if (window.confirm(`Delete “${project.name}”? Its tasks stay where they are, and you can restore the project later.`)) remove.mutate(); }}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 aria-hidden className="h-4 w-4" /> Delete
          </button>
        )}
        {blockedBecause && !busy && <p className="ml-auto text-xs text-gray-500">{blockedBecause}</p>}
        <button type="button" onClick={onCancel} className={`${blockedBecause && !busy ? '' : 'ml-auto '}rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100`}>Cancel</button>
        <button
          type="submit"
          disabled={busy || !!blockedBecause}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {project ? 'Save' : 'Create project'}
        </button>
      </div>
    </form>
  );
}

/** "PRJ-0007": the ID people type on a payment to link it to this project. */
function ProjectCode({ code }: { code: string }) {
  return (
    <span className="shrink-0 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-gray-600" title="Project ID — type it on a payment to link the payment here">
      {code}
    </span>
  );
}
