'use client';

/**
 * The "⋯" menu on every task — a list row, a board card and the task window:
 * open in a new tab, copy link, copy the T-number, duplicate, and delete (or
 * restore, from Trash). Deleting moves the task to Trash (the server archives
 * it; nothing is ever erased), and the toast offers Undo.
 *
 * Every click and key is stopped here: a row and a card open the task on click,
 * and React passes events from the portal up to them too.
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Copy, ExternalLink, Hash, Link2, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import { useRefreshTasks } from './hooks';
import { placePopover } from './AssigneePicker';
import { isConflict, newClientId, peopleOf, type Task } from './types';

const stop = (e: SyntheticEvent) => e.stopPropagation();
const taskPath = (id: string) => `/staff/tasks/${encodeURIComponent(id)}`;

/** After a delete or restore: the task itself, its sub-tasks and its parent's count change too. */
function useAfterBinChange() {
  const queryClient = useQueryClient();
  const refresh = useRefreshTasks();
  return (task: Task) => {
    queryClient.setQueryData(taskKeys.one(task.id), { task });
    queryClient.invalidateQueries({ queryKey: taskKeys.subtasks(task.id) });
    if (task.parent) {
      queryClient.invalidateQueries({ queryKey: taskKeys.one(task.parent.id) });
      queryClient.invalidateQueries({ queryKey: taskKeys.subtasks(task.parent.id) });
    }
    return refresh();
  };
}

/** Take a task out of Trash, against the revision it was shown at. */
export function useRestoreTask() {
  const after = useAfterBinChange();
  return useMutation({
    mutationFn: (t: Task) => apiClient.patch<{ task: Task }>(taskPath(t.id), { rev: t.rev, archived: false }),
    onSuccess: (res, t) => { toast.success(`${t.code} restored`, { id: `bin-${t.id}` }); return after(res.task); },
    onError: (e, t) => {
      toast.error(isConflict(e) ? `${t.code} was changed by someone else just now — refreshed.` : errorMessage(e, `Could not restore ${t.code}.`), { id: `bin-${t.id}` });
    },
  });
}

/**
 * Move a task to Trash. A task with sub-tasks asks first (they go with it);
 * otherwise it goes at once and the toast offers Undo for a few seconds.
 */
export function useDeleteTask() {
  const after = useAfterBinChange();
  const restore = useRestoreTask();
  const mutation = useMutation({
    mutationFn: (t: Task) => apiClient.patch<{ task: Task }>(taskPath(t.id), { rev: t.rev, archived: true }),
    onSuccess: (res, t) => {
      toast.success((shown) => (
        <span className="flex items-center gap-3 text-sm">
          <span><b>{t.code}</b> moved to Trash</span>
          <button
            type="button"
            onClick={() => { toast.dismiss(shown.id); restore.mutate(res.task); }}
            className="rounded-md px-2 py-0.5 font-semibold text-blue-700 hover:bg-blue-50"
          >
            Undo
          </button>
        </span>
      ), { id: `bin-${t.id}`, duration: 6000 });
      return after(res.task);
    },
    onError: (e, t) => {
      toast.error(isConflict(e) ? `${t.code} was changed by someone else just now — refreshed.` : errorMessage(e, `Could not delete ${t.code}.`), { id: `bin-${t.id}` });
    },
  });
  return {
    ...mutation,
    /** Asks first only when sub-tasks would go too. Resolves false when the person said no. */
    remove: (t: Task) => {
      const n = t.subtasks?.total ?? 0;
      if (n && !window.confirm(`Delete ${t.code} and its ${n === 1 ? 'sub-task' : `${n} sub-tasks`}? They move to Trash and can be restored together.`)) return false;
      mutation.mutate(t);
      return true;
    },
  };
}

/**
 * A copy of the task: same notes, people, dates, priority, tags, order and
 * checklist steps, as a new task with "(copy)" on the title. Sub-tasks,
 * comments, files and time stay with the original, the way ClickUp's quick
 * duplicate works. The whole task is read first — a list row does not carry
 * the checklist — and one `clientId` per click makes a retry one copy.
 */
export function useDuplicateTask(onCreated?: (id: string) => void) {
  const refresh = useRefreshTasks();
  return useMutation({
    mutationFn: async (t: Task) => {
      const full = (await apiClient.get<{ task: Task }>(taskPath(t.id))).task;
      const people = peopleOf(full).map((p) => p.id).filter(Boolean);
      const title = `${full.title} (copy)`.slice(0, 200);
      return apiClient.post<{ task: Task }>('/staff/tasks', {
        title,
        description: full.description || '',
        ...(full.status === 'in_progress' || full.status === 'waiting' ? { status: full.status } : {}),
        priority: full.priority,
        ...(full.dueOn ? { dueOn: full.dueOn } : {}),
        ...(full.startOn ? { startOn: full.startOn } : {}),
        ...(full.tags?.length ? { tags: full.tags } : {}),
        ...(people.length ? { assigneeIds: people, shared: true } : {}),
        ...(full.order ? { orderId: full.order.id } : {}),
        ...(full.parent ? { parentId: full.parent.id } : {}),
        ...(full.checklistItems?.length ? { checklist: full.checklistItems.slice(0, 30).map((c) => c.text) } : {}),
        clientId: newClientId(),
      });
    },
    onSuccess: (res) => {
      toast.success(`Copy made: ${res.task.code}`, { id: `copy-${res.task.id}` });
      refresh();
      onCreated?.(res.task.id);
    },
    onError: (e, t) => { toast.error(errorMessage(e, `Could not duplicate ${t.code}.`)); },
  });
}

type Item = { key: string; label: string; icon: ReactNode; run: () => void; danger?: boolean; href?: string };

/**
 * The menu itself. `base` is where full task pages live (/team/tasks or
 * /admin/tasks); `onOpen` opens the copy a Duplicate makes. `className` styles
 * the ⋯ button (a row and a card show it on hover, the window always).
 */
export default function TaskMenu({ t, base, onOpen, className = '', size = 'sm' }: {
  t: Task; base: string; onOpen?: (id: string) => void; className?: string; size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const del = useDeleteTask();
  const restore = useRestoreTask();
  const duplicate = useDuplicateTask(onOpen);
  const archived = t.bucket === 'archived';
  const href = `${base}/${t.id}`;
  const close = (refocus = true) => { setOpen(false); if (refocus) button.current?.focus(); };

  useEffect(() => {
    if (!open) return undefined;
    const r = button.current?.getBoundingClientRect();
    if (r) setPlace(placePopover(r, 'right', window.innerWidth, window.innerHeight));
    const away = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
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
  useEffect(() => {
    if (open && place) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, place]);

  const copy = async (text: string, done: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(done); } catch { toast.error('Could not copy'); }
  };
  const items: (Item | 'line')[] = [
    { key: 'tab', label: 'Open in new tab', icon: <ExternalLink aria-hidden className="h-4 w-4" />, href, run: () => {} },
    { key: 'link', label: 'Copy link', icon: <Link2 aria-hidden className="h-4 w-4" />, run: () => copy(`${window.location.origin}${href}`, 'Link copied') },
    { key: 'code', label: `Copy ID (${t.code})`, icon: <Hash aria-hidden className="h-4 w-4" />, run: () => copy(t.code, `${t.code} copied`) },
    ...(!archived ? [{ key: 'dup', label: 'Duplicate', icon: <Copy aria-hidden className="h-4 w-4" />, run: () => duplicate.mutate(t) }] : []),
    ...(t.can.archive || t.can.restore ? ['line' as const] : []),
    ...(t.can.archive ? [{ key: 'del', label: 'Delete', icon: <Trash2 aria-hidden className="h-4 w-4" />, danger: true, run: () => { del.remove(t); } }] : []),
    ...(t.can.restore ? [{ key: 'restore', label: 'Restore from Trash', icon: <RotateCcw aria-hidden className="h-4 w-4" />, run: () => restore.mutate(t) }] : []),
  ];

  const onMenuKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    const all = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); all[(at + 1) % all.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); all[(at - 1 + all.length) % all.length]?.focus(); }
    if (e.key === 'Tab') close(false);
  };
  const busy = del.isPending || restore.isPending || duplicate.isPending;
  const itemClass = 'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] focus:outline-none';

  return (
    <>
      <button
        ref={button}
        type="button"
        disabled={busy}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onKeyDown={stop}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${t.code}`}
        title="More actions"
        className={`tk-more inline-flex shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40 ${size === 'md' ? 'h-8 w-8' : 'h-6 w-6'} ${className}`}
      >
        <MoreHorizontal aria-hidden className="h-4 w-4" />
      </button>
      {open && place && createPortal(
        <div
          ref={menu}
          role="menu"
          aria-label={`Actions for ${t.code}`}
          style={place}
          onClick={stop}
          onMouseDown={stop}
          onKeyDown={onMenuKey}
          className="panel-theme admin-panel tk-theme fixed z-[60] w-56 rounded-xl border border-gray-200 bg-white p-1 shadow-xl"
        >
          {items.map((it, i) => {
            if (it === 'line') return <div key={`line${i}`} role="separator" className="my-1 h-px bg-gray-100" />;
            const tone = it.danger ? 'text-red-600 hover:bg-red-50 focus:bg-red-50' : 'text-gray-800 hover:bg-gray-100 focus:bg-gray-100';
            return it.href ? (
              <a key={it.key} role="menuitem" href={it.href} target="_blank" rel="noopener noreferrer" onClick={() => close(false)} className={`${itemClass} ${tone}`}>
                <span className="text-gray-500">{it.icon}</span>{it.label}
              </a>
            ) : (
              <button key={it.key} type="button" role="menuitem" onClick={() => { close(); it.run(); }} className={`${itemClass} ${tone}`}>
                <span className={it.danger ? '' : 'text-gray-500'}>{it.icon}</span>{it.label}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
