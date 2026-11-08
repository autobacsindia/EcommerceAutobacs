'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Check, RotateCcw, UserPlus, X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import type { Person, Task, TaskComment } from './types';

type Put = (next: TaskComment) => void;

function useAssignWrites(task: Task, c: TaskComment, put: Put) {
  const queryClient = useQueryClient();
  const path = `/staff/tasks/${encodeURIComponent(task.id)}/comments/${encodeURIComponent(c.id)}`;
  const done = (r: { comment: TaskComment }) => {
    put(r.comment);
    queryClient.invalidateQueries({ queryKey: taskKeys.allAssignedComments() });
    queryClient.invalidateQueries({ queryKey: taskKeys.summary() });
    queryClient.invalidateQueries({ queryKey: taskKeys.one(task.id) });
  };
  const fail = (e: unknown) => toast.error(errorMessage(e, 'Could not update the comment.'));
  return {
    assign: useMutation({
      mutationFn: (userId: string | null) => apiClient.put<{ comment: TaskComment }>(`${path}/assignee`, { userId }),
      onSuccess: done,
      onError: fail,
    }),
    resolve: useMutation({
      mutationFn: (resolved: boolean) => apiClient.put<{ comment: TaskComment }>(`${path}/resolved`, { resolved }),
      onSuccess: done,
      onError: fail,
    }),
  };
}

/** The small "Assign" button on a comment, and its list of people. */
export function AssignCommentButton({ task, c, put }: { task: Task; c: TaskComment; put: Put }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const { assign } = useAssignWrites(task, c, put);
  const people = useQuery({
    queryKey: [...taskKeys.one(task.id), 'mentionable'],
    queryFn: () => apiClient.get<{ people: Person[]; me?: Person }>(`/staff/tasks/${encodeURIComponent(task.id)}/mentionable`),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  const me = people.data?.me;
  const list = [...(me ? [{ ...me, name: `${me.name} (me)` }] : []), ...(people.data?.people ?? []).filter((p) => p.id !== me?.id)];
  const pick = (id: string) => { setOpen(false); assign.mutate(id); };

  return (
    <span ref={box} className="relative block">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Assign comment" aria-expanded={open} title="Assign to someone" className="rounded p-1 hover:bg-gray-200">
        <UserPlus aria-hidden className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span role="menu" aria-label="Assign to" className="absolute block right-0 top-full z-20 mt-1 max-h-56 w-48 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {people.isPending ? <span className="block px-3 py-2 text-xs text-gray-500">Loading…</span>
            : people.isError ? <span className="block px-3 py-2 text-xs text-red-700">Could not load people.</span>
            : list.length === 0 ? <span className="block px-3 py-2 text-xs text-gray-500">Nobody to assign to.</span>
            : list.map((p) => (
              <button key={p.id} type="button" role="menuitem" onClick={() => pick(p.id)} className="block w-full truncate px-3 py-1.5 text-left text-sm text-gray-800 hover:bg-gray-100">{p.name}</button>
            ))}
        </span>
      )}
    </span>
  );
}

/** The line under an assigned comment: who has it, and Resolve. */
export function CommentAssignment({ task, c, put }: { task: Task; c: TaskComment; put: Put }) {
  const a = c.assignment;
  const { assign, resolve } = useAssignWrites(task, c, put);
  if (!a) return null;
  const busy = assign.isPending || resolve.isPending;
  const action = 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium hover:bg-white/70 disabled:opacity-50';
  return (
    <div className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-2 py-1 text-xs ${a.resolvedAt ? 'bg-emerald-50 text-emerald-800' : 'bg-blue-50 text-blue-800'}`}>
      <span className="min-w-0">
        {a.resolvedAt
          ? <>Resolved by <strong className="font-semibold">{a.resolvedBy || 'someone'}</strong></>
          : <>Assigned to <strong className="font-semibold">{a.to.name || 'someone'}</strong>{a.by.name ? ` by ${a.by.name}` : ''}</>}
      </span>
      {a.canChange && (
        <span className="ml-auto flex items-center gap-0.5">
          {a.resolvedAt
            ? <button type="button" disabled={busy} onClick={() => resolve.mutate(false)} className={action}><RotateCcw aria-hidden className="h-3 w-3" />Reopen</button>
            : <button type="button" disabled={busy} onClick={() => resolve.mutate(true)} className={action}><Check aria-hidden className="h-3 w-3" />Resolve</button>}
          {task.bucket !== 'archived' && <button type="button" disabled={busy} onClick={() => assign.mutate(null)} aria-label="Remove assignment" className={action}><X aria-hidden className="h-3 w-3" /></button>}
        </span>
      )}
    </div>
  );
}
