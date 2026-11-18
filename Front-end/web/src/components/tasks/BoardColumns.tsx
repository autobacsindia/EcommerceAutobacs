'use client';

/**
 * A project's board columns, changed from the board itself, ClickUp-style:
 * "+ Add column" at the end, and a ⋯ menu on each column to rename, recolour,
 * say what it counts as, move it left or right, or delete it.
 *
 * Columns are the project's own statuses (services/staffProjectService.js).
 * Every change is one save of the whole set against the revision shown, so two
 * people editing at once get "someone changed this" instead of a silent
 * overwrite. Deleting a column asks where its tasks go (`statusMoves`); the
 * server refuses moving open tasks into a Done column or the other way round.
 */
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowLeft, ArrowRight, Check, Loader2, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import { Dialog } from './Overlays';
import { PROJECT_COLOURS } from './ProjectPicker';
import { STAGE_PILL } from './ui';
import { STAGE_TYPES, TASK_STATUSES, isConflict, type Project, type ProjectStage, type TaskStatus } from './types';

type Draft = { id?: string; name: string; colour: string; type: TaskStatus };
type Move = { from: string; to: string };

const NAME_MAX = 30;
const STAGES_MAX = 12;
const STARTER_COLOUR: Record<TaskStatus, string> = { todo: 'gray', in_progress: 'blue', done: 'green' };
const folded = (x: string) => x.replace(/\s+/g, ' ').trim().toLowerCase();
const toDraft = (s: ProjectStage): Draft => ({ id: s.id, name: s.name, colour: s.colour, type: s.type });
/** True for a Done column; open (not started / active) otherwise. Tasks never move between the two silently. */
const isDone = (t: TaskStatus) => t === 'done';

/** Save the project's whole column set, against the revision shown. */
function useSaveColumns(p: Project) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ statuses, statusMoves }: { statuses: Draft[]; statusMoves?: Move[] }) =>
      apiClient.patch<{ project: Project }>(`/staff/tasks/projects/${encodeURIComponent(p.id)}`, {
        rev: p.rev,
        statuses: statuses.map((x) => ({ ...(x.id ? { id: x.id } : {}), name: x.name.trim(), colour: x.colour, type: x.type })),
        ...(statusMoves?.length ? { statusMoves } : {}),
      }),
    onSettled: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: taskKeys.projects() }),
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() }),
    ]),
    onError: (e) => {
      toast.error(isConflict(e) ? 'Someone changed this project just now — it has been reloaded. Try again.' : errorMessage(e, 'Could not save the columns.'));
    },
  });
}

/** Why a name can't be used, or '' when it can. */
function nameProblem(name: string, others: Draft[]) {
  if (!name.trim()) return 'Give the column a name.';
  if (others.some((x) => folded(x.name) === folded(name))) return 'Another column already has that name.';
  return '';
}

/**
 * "+ Add column" at the end of the board. On a board still using the usual
 * three, the first new column turns on the project's own columns: To do,
 * In progress and Complete become its first three, so nothing moves.
 */
export function AddColumn({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const save = useSaveColumns(project);
  const current: Draft[] = project.statuses.length
    ? project.statuses.map(toDraft)
    : TASK_STATUSES.map((s) => ({ name: s.label, colour: STARTER_COLOUR[s.value], type: s.value }));
  const problem = name ? nameProblem(name, current) : '';
  if (current.length >= STAGES_MAX) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || problem || save.isPending) return;
    // New columns go before the Done ones: work flows left to right and finishes at the end.
    const at = current.findIndex((x) => isDone(x.type));
    const fresh: Draft = { name: name.trim(), colour: 'gray', type: 'in_progress' };
    const statuses = at < 0 ? [...current, fresh] : [...current.slice(0, at), fresh, ...current.slice(at)];
    save.mutate({ statuses }, {
      onSuccess: () => { toast.success(`Column “${fresh.name}” added`); setName(''); setOpen(false); },
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-[200px] shrink-0 items-center gap-1.5 self-start rounded-xl border border-dashed border-gray-300 px-3 text-sm font-medium text-gray-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 md:w-[180px] md:flex-none"
      >
        <Plus aria-hidden className="h-4 w-4" /> Add column
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="w-[236px] shrink-0 space-y-2 self-start rounded-xl border border-gray-200 bg-white p-2.5 shadow-sm md:flex-none">
      <label className="block text-xs font-medium text-gray-600">
        New column
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setName(''); } }}
          maxLength={NAME_MAX}
          placeholder="e.g. Garage 1"
          className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-900"
        />
      </label>
      {problem && <p role="alert" className="text-xs text-red-700">{problem}</p>}
      <p className="text-xs text-gray-500">Tasks here count as in progress. Change that from the column’s ⋯ menu.</p>
      <div className="flex gap-2">
        <button type="submit" disabled={!name.trim() || !!problem || save.isPending} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {save.isPending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Plus aria-hidden className="h-4 w-4" />} Add
        </button>
        <button type="button" onClick={() => { setOpen(false); setName(''); }} className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
      </div>
    </form>
  );
}

/** The ⋯ on a column heading: rename, colour, what it counts as, move, delete. */
export function ColumnMenu({ project, stageId, shownTasks }: {
  project: Project;
  stageId: string;
  /** How many cards the board shows in it (the Done column shows only the latest). */
  shownTasks: number;
}) {
  const [open, setOpen] = useState(false);
  const stage = project.statuses.find((x) => x.id === stageId);
  if (!stage) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Change column ${stage.name}`}
        className="ml-auto rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-900"
      >
        <MoreHorizontal aria-hidden className="h-4 w-4" />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} label={`Column ${stage.name}`}>
        {open && <ColumnEditor project={project} stage={stage} shownTasks={shownTasks} onDone={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

function ColumnEditor({ project, stage, shownTasks, onDone }: { project: Project; stage: ProjectStage; shownTasks: number; onDone: () => void }) {
  const save = useSaveColumns(project);
  const all = project.statuses.map(toDraft);
  const index = all.findIndex((x) => x.id === stage.id);
  const others = all.filter((x) => x.id !== stage.id);
  const [name, setName] = useState(stage.name);
  const [colour, setColour] = useState(stage.colour);
  const [type, setType] = useState<TaskStatus>(stage.type);
  const [deleting, setDeleting] = useState(false);
  // Where its tasks go: a column that stays and is open/done the same way.
  const targets = others.filter((x) => isDone(x.type) === isDone(stage.type));
  const [picked, setTarget] = useState('');
  const target = targets.some((x) => x.id === picked) ? picked : targets[0]?.id ?? '';

  const problem = nameProblem(name, others);
  const changed = name.trim() !== stage.name || colour !== stage.colour || type !== stage.type;
  // The server's rule, said before it would refuse: one Not started and one Done column always stay.
  const keepsKinds = (list: Draft[]) => list.some((x) => x.type === 'todo') && list.some((x) => x.type === 'done');
  const edited = all.map((x) => (x.id === stage.id ? { ...x, name: name.trim(), colour, type } : x));
  const kindProblem = changed && !keepsKinds(edited)
    ? 'Keep at least one “Not started” column (new tasks start there) and one “Done” column.' : '';
  const deleteProblem = !keepsKinds(others)
    ? `“${stage.name}” is the last ${stage.type === 'done' ? '“Done”' : '“Not started”'} column. Add another first, or change what this one counts as.`
    : !targets.length ? 'There is no other column to move its tasks to.' : '';

  const saveEdits = (e: FormEvent) => {
    e.preventDefault();
    if (!changed || problem || kindProblem || save.isPending) return;
    save.mutate({ statuses: edited }, { onSuccess: () => { toast.success('Column saved'); onDone(); } });
  };
  const shift = (by: -1 | 1) => {
    const j = index + by;
    if (j < 0 || j >= all.length || save.isPending) return;
    const next = [...all];
    [next[index], next[j]] = [next[j], next[index]];
    save.mutate({ statuses: next });
  };
  const remove = () => {
    if (deleteProblem || !target || save.isPending) return;
    const goesTo = others.find((x) => x.id === target);
    save.mutate({ statuses: others, statusMoves: [{ from: stage.id, to: target }] }, {
      onSuccess: () => { toast.success(`Column “${stage.name}” deleted${goesTo ? ` — its tasks are in “${goesTo.name}”` : ''}`); onDone(); },
    });
  };

  return (
    <div className="max-h-[80vh] overflow-y-auto rounded-2xl bg-white p-4 shadow-xl">
      {!deleting ? (
        <form onSubmit={saveEdits} className="space-y-4">
          <h2 className="text-base font-semibold text-gray-900">Column “{stage.name}”</h2>
          <label className="block text-sm font-medium text-gray-700">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm text-gray-900" />
          </label>
          {problem && <p role="alert" className="text-xs text-red-700">{problem}</p>}
          <fieldset>
            <legend className="text-sm font-medium text-gray-700">Colour</legend>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {PROJECT_COLOURS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColour(c)}
                  aria-label={c}
                  aria-pressed={colour === c}
                  className={`flex h-7 w-7 items-center justify-center rounded-full ${STAGE_PILL[c]} ${colour === c ? 'ring-2 ring-gray-900 ring-offset-2' : ''}`}
                >
                  {colour === c && <Check aria-hidden className="h-4 w-4" />}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm font-medium text-gray-700">
            Tasks here count as
            <select value={type} onChange={(e) => setType(e.target.value as TaskStatus)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm text-gray-900">
              {STAGE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <span className="mt-1 block text-xs font-normal text-gray-500">“Done” finishes a task when it is moved here. The others keep it open.</span>
          </label>
          {kindProblem && <p role="alert" className="text-xs text-red-700">{kindProblem}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={!changed || !!problem || !!kindProblem || save.isPending} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {save.isPending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />} Save
            </button>
            <button type="button" onClick={onDone} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">Close</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
            <button type="button" onClick={() => shift(-1)} disabled={index === 0 || save.isPending} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">
              <ArrowLeft aria-hidden className="h-4 w-4" /> Move left
            </button>
            <button type="button" onClick={() => shift(1)} disabled={index === all.length - 1 || save.isPending} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">
              Move right <ArrowRight aria-hidden className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setDeleting(true)} className="ml-auto inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50">
              <Trash2 aria-hidden className="h-4 w-4" /> Delete column
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-gray-900">Delete column “{stage.name}”?</h2>
          {deleteProblem ? (
            <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{deleteProblem}</p>
          ) : (
            <label className="block text-sm text-gray-700">
              {shownTasks > 0
                ? `Its ${shownTasks === 1 ? 'task' : `${shownTasks} tasks`} will move to:`
                : 'Any tasks in it will move to:'}
              <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Move its tasks to" className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm text-gray-900">
                {targets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <span className="mt-1 block text-xs text-gray-500">No task is deleted. {isDone(stage.type) ? 'Finished tasks stay finished.' : 'Open tasks stay open.'}</span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={remove} disabled={!!deleteProblem || !target || save.isPending} className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {save.isPending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Trash2 aria-hidden className="h-4 w-4" />} Delete and move tasks
            </button>
            <button type="button" onClick={() => setDeleting(false)} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">Back</button>
          </div>
        </div>
      )}
    </div>
  );
}
