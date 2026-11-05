'use client';

/**
 * Folders and lists inside a team's space, ClickUp-style:
 *
 *   Procurement
 *     📁 Suppliers
 *        ● Bosch orders   6
 *     ● Weekly stock check 4
 *     ● Other tasks        8   ← tasks in no list
 *
 * Everyone in a team sees its space (like a Google Chat space); the team head
 * and the admin arrange it. Deleting a list never deletes a task: they go back
 * to "Other tasks". The server decides all of it (services/staffTaskListService.js).
 */
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ChevronRight, Folder, FolderPlus, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import { teamColour } from '@/components/chat/chatUi';
import { Dialog } from './Overlays';
import { placePopover } from './AssigneePicker';
import { useRefreshTasks } from './hooks';

export type SpaceItem = { id: string; kind: 'folder' | 'list'; name: string; colour: string; folderId: string | null; rev: number; open: number };
export type SpaceFolder = SpaceItem & { lists: SpaceItem[] };
export type Space = {
  team: string; teamLabel: string; canManage: boolean;
  folders: SpaceFolder[]; lists: SpaceItem[]; other: number; colours: string[];
};

/** The dot beside a list. Whole class names, so the stylesheet keeps them. */
export const LIST_DOT: Record<string, string> = {
  gray: 'bg-gray-400', red: 'bg-red-500', orange: 'bg-orange-500', amber: 'bg-amber-400', green: 'bg-green-500',
  teal: 'bg-teal-500', blue: 'bg-blue-500', violet: 'bg-violet-500', pink: 'bg-pink-500',
};
const COLOUR_NAMES: Record<string, string> = {
  gray: 'Grey', red: 'Red', orange: 'Orange', amber: 'Yellow', green: 'Green', teal: 'Teal', blue: 'Blue', violet: 'Purple', pink: 'Pink',
};
export const dotOf = (colour?: string) => LIST_DOT[colour || 'gray'] || LIST_DOT.gray;

/** One team's folders and lists. Refreshed with the task lists (useRefreshTasks). */
export function useSpace(team: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: taskKeys.space(team || ''),
    queryFn: () => apiClient.get<{ space: Space }>(`/staff/tasks/space?team=${encodeURIComponent(team || '')}`).then((r) => r.space),
    enabled: !!team && enabled,
    staleTime: 60_000,
    // Another team's space is a 403 by design: asking again cannot change that.
    retry: (count, e) => {
      const status = (e as unknown as { status?: number })?.status;
      return count < 1 && !(status && status < 500);
    },
  });
}

/** Every list of a space, each with where it is: "Suppliers › Bosch orders". */
export function allLists(space: Space | undefined): (SpaceItem & { path: string; folderName: string | null })[] {
  if (!space) return [];
  return [
    ...space.folders.flatMap((f) => f.lists.map((l) => ({ ...l, path: `${f.name} › ${l.name}`, folderName: f.name }))),
    ...space.lists.map((l) => ({ ...l, path: l.name, folderName: null })),
  ];
}

function useListItemActions(team: string) {
  const refresh = useRefreshTasks();
  const queryClient = useQueryClient();
  const after = () => Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: taskKeys.space(team) })]);
  const create = useMutation({
    mutationFn: (body: { kind: 'folder' | 'list'; name: string; colour: string; folderId: string | null }) =>
      apiClient.post<{ item: SpaceItem }>('/staff/tasks/space/items', { team, ...body }),
    onSuccess: (res) => { toast.success(`${res.item.kind === 'folder' ? 'Folder' : 'List'} “${res.item.name}” made`); return after(); },
  });
  const update = useMutation({
    mutationFn: ({ item, patch }: { item: SpaceItem; patch: { name?: string; colour?: string; folderId?: string | null } }) =>
      apiClient.patch<{ item: SpaceItem }>(`/staff/tasks/space/items/${encodeURIComponent(item.id)}`, { rev: item.rev, ...patch }),
    onSuccess: () => after(),
  });
  const remove = useMutation({
    mutationFn: (item: SpaceItem) => apiClient.delete<{ tasksMoved: number }>(`/staff/tasks/space/items/${encodeURIComponent(item.id)}`),
    onSuccess: (res, item) => {
      toast.success(res.tasksMoved
        ? `“${item.name}” deleted. ${res.tasksMoved === 1 ? '1 task is' : `${res.tasksMoved} tasks are`} now in Other tasks.`
        : `“${item.name}” deleted`);
      return after();
    },
    onError: (e) => { toast.error(errorMessage(e, 'Could not delete it.')); after(); },
  });
  return { create, update, remove };
}

type Editing =
  | { mode: 'new'; kind: 'folder' | 'list'; folderId: string | null }
  | { mode: 'edit'; item: SpaceItem };

/** Make a folder or list, or rename / recolour / move one. */
function ListItemDialog({ space, editing, onClose }: { space: Space; editing: Editing; onClose: () => void }) {
  const { create, update } = useListItemActions(space.team);
  const item = editing.mode === 'edit' ? editing.item : null;
  const [kind, setKind] = useState<'folder' | 'list'>(item?.kind ?? (editing.mode === 'new' ? editing.kind : 'list'));
  const [name, setName] = useState(item?.name ?? '');
  const [colour, setColour] = useState(item?.colour ?? 'gray');
  const [folderId, setFolderId] = useState<string | null>(item ? item.folderId : editing.mode === 'new' ? editing.folderId : null);
  const [error, setError] = useState('');
  const busy = create.isPending || update.isPending;
  const word = kind === 'folder' ? 'folder' : 'list';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = name.replace(/\s+/g, ' ').trim();
    if (!clean) { setError('Give it a name.'); return; }
    const done = { onSuccess: () => onClose(), onError: (err: unknown) => setError(errorMessage(err, `Could not save the ${word}.`)) };
    if (item) {
      update.mutate({ item, patch: { name: clean, colour, ...(item.kind === 'list' ? { folderId } : {}) } }, done);
    } else {
      create.mutate({ kind, name: clean, colour, folderId: kind === 'list' ? folderId : null }, done);
    }
  };

  return (
    <form onSubmit={submit} className="tk-theme panel-theme admin-panel rounded-2xl bg-white p-5 shadow-2xl">
      <h2 className="text-base font-bold text-gray-900">
        {item ? `Edit ${word}` : `New ${word}`} <span className="font-normal text-gray-500">in {space.teamLabel}</span>
      </h2>
      {!item && (
        <div className="mt-3 flex gap-1 rounded-lg bg-gray-100 p-1" role="radiogroup" aria-label="Make a">
          {(['list', 'folder'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`flex-1 rounded-md py-1.5 text-sm font-semibold ${kind === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            >
              {k === 'list' ? 'List' : 'Folder'}
            </button>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-gray-500">
        {kind === 'folder' ? 'A folder holds lists, like “Suppliers” holding “Bosch orders” and “Price follow-ups”.' : 'A list holds tasks, like “Bosch orders”.'}
      </p>
      <label className="mt-4 block text-sm font-medium text-gray-700">
        Name
        <input
          autoFocus
          value={name}
          onChange={(e) => { setName(e.target.value); setError(''); }}
          maxLength={60}
          placeholder={kind === 'folder' ? 'e.g. Suppliers' : 'e.g. Bosch orders'}
          className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
      </label>
      {kind === 'list' && space.folders.length > 0 && (
        <label className="mt-3 block text-sm font-medium text-gray-700">
          Folder
          <select
            value={folderId ?? ''}
            onChange={(e) => setFolderId(e.target.value || null)}
            className="mt-1 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
          >
            <option value="">No folder (straight in {space.teamLabel})</option>
            {space.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
      )}
      <fieldset className="mt-3">
        <legend className="text-sm font-medium text-gray-700">Colour</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {space.colours.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={colour === c}
              aria-label={COLOUR_NAMES[c] || c}
              title={COLOUR_NAMES[c] || c}
              onClick={() => setColour(c)}
              className={`h-7 w-7 rounded-full ring-offset-2 ${dotOf(c)} ${colour === c ? 'ring-2 ring-gray-900' : 'hover:ring-2 hover:ring-gray-300'}`}
            />
          ))}
        </div>
      </fieldset>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-9 rounded-lg px-3 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
        <button type="submit" disabled={busy} className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Saving…' : item ? 'Save' : `Make ${word}`}
        </button>
      </div>
    </form>
  );
}

/** The ⋯ on a folder or list (team head and admin only). */
function ItemMenu({ item, onEdit, onNewList, onDelete }: {
  item: SpaceItem; onEdit: () => void; onNewList?: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const r = button.current?.getBoundingClientRect();
    if (r) setPlace(placePopover(r, 'left', window.innerWidth, window.innerHeight));
    const away = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  useEffect(() => { if (open && place) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(); }, [open, place]);
  const run = (fn: () => void) => () => { setOpen(false); fn(); };
  const itemClass = 'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] focus:outline-none';
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${item.name}`}
        className="tk-more hidden h-6 w-6 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-200 hover:text-gray-900 lg:inline-flex"
      >
        <MoreHorizontal aria-hidden className="h-4 w-4" />
      </button>
      {open && place && createPortal(
        <div ref={menu} role="menu" aria-label={`Actions for ${item.name}`} style={place} className="panel-theme admin-panel tk-theme fixed z-[60] w-56 rounded-xl border border-gray-200 bg-white p-1 shadow-xl">
          <button type="button" role="menuitem" onClick={run(onEdit)} className={`${itemClass} text-gray-800 hover:bg-gray-100 focus:bg-gray-100`}>
            <Pencil aria-hidden className="h-4 w-4 text-gray-500" />Rename or change colour
          </button>
          {onNewList && (
            <button type="button" role="menuitem" onClick={run(onNewList)} className={`${itemClass} text-gray-800 hover:bg-gray-100 focus:bg-gray-100`}>
              <Plus aria-hidden className="h-4 w-4 text-gray-500" />New list in this folder
            </button>
          )}
          <div role="separator" className="my-1 h-px bg-gray-100" />
          <button type="button" role="menuitem" onClick={run(onDelete)} className={`${itemClass} text-red-600 hover:bg-red-50 focus:bg-red-50`}>
            <Trash2 aria-hidden className="h-4 w-4" />Delete {item.kind}
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

const CLOSED_KEY = 'tasks-folders-closed';
function useClosedFolders() {
  const [closed, setClosed] = useState<string[]>([]);
  useEffect(() => {
    try { setClosed(JSON.parse(localStorage.getItem(CLOSED_KEY) || '[]')); } catch { /* storage blocked: all open */ }
  }, []);
  const toggle = (id: string) => setClosed((now) => {
    const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
    try { localStorage.setItem(CLOSED_KEY, JSON.stringify(next)); } catch { /* this visit only */ }
    return next;
  });
  return { closed, toggle };
}

/**
 * One team in the side menu: the team itself (all its tasks), then its
 * folders, lists and "Other tasks". On a phone the lists show as chips.
 * `active` is the list being shown ('' = the whole team, 'none' = Other tasks).
 */
export function SpaceTree({ team, label, expanded, onToggle, isCurrent, active, onPick, itemClass }: {
  team: string; label: string; expanded: boolean; onToggle: () => void;
  /** This team's tasks are on screen (the team or one of its lists). */
  isCurrent: boolean; active: string;
  onPick: (list: string) => void; itemClass: string;
}) {
  const space = useSpace(team, expanded);
  const { closed, toggle } = useClosedFolders();
  const { remove } = useListItemActions(team);
  const [editing, setEditing] = useState<Editing | null>(null);
  const s = space.data;
  const canManage = !!s?.canManage;

  const del = (item: SpaceItem) => {
    const inside = item.kind === 'folder' ? (s?.folders.find((f) => f.id === item.id)?.lists.length ?? 0) : 0;
    const msg = item.kind === 'folder'
      ? `Delete the folder “${item.name}”${inside ? ` and its ${inside === 1 ? 'list' : `${inside} lists`}` : ''}? No task is deleted: they move to “Other tasks”.`
      : `Delete the list “${item.name}”? No task is deleted: ${item.open ? `its ${item.open === 1 ? 'task moves' : `${item.open} tasks move`}` : 'any tasks in it move'} to “Other tasks”.`;
    if (window.confirm(msg)) remove.mutate(item);
  };

  const listRow = (l: SpaceItem, nested: boolean) => (
    <div key={l.id} className="tk-more-host group flex items-center">
      <button
        aria-pressed={isCurrent && active === l.id}
        onClick={() => onPick(l.id)}
        className={`${itemClass} min-w-0 flex-1 ${nested ? 'lg:pl-9' : 'lg:pl-6'}`}
        title={l.name}
      >
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${dotOf(l.colour)}`} />
        <span className="truncate">{l.name}</span>
        {l.open > 0 && <span className="ml-auto text-[11px] font-medium text-gray-400">{l.open}</span>}
      </button>
      {canManage && <ItemMenu item={l} onEdit={() => setEditing({ mode: 'edit', item: l })} onDelete={() => del(l)} />}
    </div>
  );

  return (
    <div className="contents lg:block" role="group" aria-label={`${label} space`}>
      <div className="flex items-center">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? `Fold ${label}` : `Unfold ${label}`}
          className="hidden h-6 w-5 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 lg:flex"
        >
          <ChevronRight aria-hidden className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </button>
        <button aria-pressed={isCurrent && !active} onClick={() => onPick('')} className={`${itemClass} min-w-0 flex-1 lg:pl-1`}>
          <span aria-hidden className={`hidden h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold lg:flex ${teamColour(team)}`}>{label[0]}</span>
          <span className="truncate">{label}</span>
        </button>
      </div>
      {expanded && s && (
        <>
          {s.folders.map((f) => {
            const open = !closed.includes(f.id);
            return (
              <div key={f.id} className="contents lg:block">
                <div className="tk-more-host group hidden items-center lg:flex">
                  <button
                    type="button"
                    onClick={() => toggle(f.id)}
                    aria-expanded={open}
                    className={`${itemClass} min-w-0 flex-1 lg:pl-6`}
                    title={f.name}
                  >
                    <Folder aria-hidden className="h-4 w-4 shrink-0 text-gray-400" />
                    <span className="truncate">{f.name}</span>
                    <ChevronRight aria-hidden className={`ml-auto h-3 w-3 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                  </button>
                  {canManage && (
                    <ItemMenu
                      item={f}
                      onEdit={() => setEditing({ mode: 'edit', item: f })}
                      onNewList={() => setEditing({ mode: 'new', kind: 'list', folderId: f.id })}
                      onDelete={() => del(f)}
                    />
                  )}
                </div>
                {/* On a phone every list shows as a chip, folders or not. */}
                {f.lists.map((l) => <div key={l.id} className={`contents ${open ? '' : 'lg:hidden'}`}>{listRow(l, true)}</div>)}
              </div>
            );
          })}
          {s.lists.map((l) => listRow(l, false))}
          {(s.other > 0 || s.folders.length > 0 || s.lists.length > 0) && (
            <button aria-pressed={isCurrent && active === 'none'} onClick={() => onPick('none')} className={`${itemClass} lg:pl-6`}>
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full border border-gray-400" />
              <span className="truncate">Other tasks</span>
              {s.other > 0 && <span className="ml-auto text-[11px] font-medium text-gray-400">{s.other}</span>}
            </button>
          )}
          {canManage && (
            <button
              type="button"
              onClick={() => setEditing({ mode: 'new', kind: 'list', folderId: null })}
              className="hidden min-h-8 items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] font-medium text-blue-700 hover:bg-blue-50 lg:flex lg:pl-6"
            >
              <FolderPlus aria-hidden className="h-4 w-4" /> New folder or list
            </button>
          )}
        </>
      )}
      {space.isError && expanded && <p className="hidden px-2 py-1 text-xs text-red-600 lg:block">{errorMessage(space.error, 'Could not load the lists.')}</p>}
      {/* On the page itself: the side menu is sticky, a stacking context the list paints over. */}
      {s && editing && createPortal(
        <Dialog open onClose={() => setEditing(null)} label={editing.mode === 'edit' ? 'Edit folder or list' : 'New folder or list'}>
          <ListItemDialog key={JSON.stringify(editing)} space={s} editing={editing} onClose={() => setEditing(null)} />
        </Dialog>,
        document.body,
      )}
    </div>
  );
}

/**
 * The list a task is in, as a picker (or plain text for someone who may not
 * move it). Only the lists of the task's own team's space are offered.
 */
export function ListPicker({ team, teamLabel, value, onChange, disabled, label = 'List', className = '' }: {
  team: string | null | undefined; teamLabel?: string; value: string | null | undefined; onChange: (listId: string | null) => void;
  disabled?: boolean; label?: string; className?: string;
}) {
  const space = useSpace(team);
  const s = space.data;
  if (!team) return null;
  if (!s) {
    if (space.isPending) return <span className="text-sm text-gray-400">…</span>;
    // Another team's space is not shown to this person: say where the task is, plainly.
    return <span className="text-sm text-gray-500">{value ? `In a ${teamLabel || 'team'} list` : 'No list'}</span>;
  }
  const known = allLists(s);
  const current = known.find((l) => l.id === value);
  if (!known.length && !value) return <span className="text-sm text-gray-400">No lists in {s.teamLabel} yet</span>;
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${current ? dotOf(current.colour) : 'border border-gray-400'}`} />
      <select
        value={current ? current.id : ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label={label}
        // `!`: the panel styles every select with a white box (globals.css); a quiet inline picker has to win that.
        className={`min-w-0 max-w-full truncate rounded-md border-transparent! bg-transparent! py-0.5 text-sm text-gray-800 ${disabled ? 'cursor-default appearance-none pr-1' : 'pr-6 hover:border-gray-200!'}`}
      >
        <option value="">Other tasks (no list)</option>
        {s.folders.map((f) => (f.lists.length ? (
          <optgroup key={f.id} label={f.name}>
            {f.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </optgroup>
        ) : null))}
        {s.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </span>
  );
}
