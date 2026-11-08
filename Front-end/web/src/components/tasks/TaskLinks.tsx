'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Link2, Loader2, Lock, Plus, TriangleAlert, X } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { taskKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import { StatusPill } from './ui';
import type { Task, TaskLinkKind, TaskLinkOption, TaskLinkRow, TaskLinks } from './types';

/*
 * Links between tasks: waiting on, blocking and related. The server decides who
 * may do what and answers every change with the links as they now are, so what
 * is on screen is always what was saved.
 */

const base = (id: string) => `/staff/tasks/${encodeURIComponent(id)}/links`;
const KINDS: { value: TaskLinkKind; label: string; hint: string }[] = [
  { value: 'waiting_on', label: 'Waiting on', hint: 'That task must be finished before this one can start' },
  { value: 'blocking', label: 'Blocking', hint: 'This task must be finished before that one can start' },
  { value: 'related', label: 'Related', hint: 'The two belong together' },
];

/** One request per task: the warning and the panel share it. Fresh each time the task opens. */
export function useTaskLinks(taskId: string) {
  return useQuery({
    queryKey: taskKeys.links(taskId),
    queryFn: () => apiClient.get<TaskLinks>(base(taskId)),
    staleTime: 0,
  });
}

function useRefreshLinks() {
  const queryClient = useQueryClient();
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: taskKeys.allLinks() }),
    queryClient.invalidateQueries({ queryKey: taskKeys.lists() }),
      ]);
}

const stillOpen = (l: TaskLinkRow) => l.task.bucket === 'open';

/** At the top of a task: what it is still waiting for. Advice only — the task can still be finished. */
export function WaitingWarning({ task, onOpen }: { task: Task; onOpen?: (id: string) => void }) {
  const q = useTaskLinks(task.id);
  if (task.bucket !== 'open' || !q.data) return null;
  const open = q.data.waitingOn.filter(stillOpen);
  const unseen = q.data.hiddenWaiting;
  if (!open.length && !unseen) return null;
  return (
    <p role="status" className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
      <TriangleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">
        Waiting on{' '}
        {open.map((l, i) => (
          <span key={l.linkId}>
            {i > 0 && ', '}
            {onOpen
              ? <button type="button" onClick={() => onOpen(l.task.id)} className="font-semibold underline">{l.task.code} {l.task.title}</button>
              : <strong>{l.task.code} {l.task.title}</strong>}
          </span>
        ))}
        {unseen > 0 && `${open.length ? ', and ' : ''}${unseen} task${unseen === 1 ? '' : 's'} you can’t open`}
        {' '}— not finished yet.
      </span>
    </p>
  );
}

function LinkRow({ l, href, onOpen, onRemove, busy }: {
  l: TaskLinkRow; href: string; onOpen?: (id: string) => void; onRemove: () => void; busy: boolean;
}) {
  const done = l.task.bucket !== 'open';
  const name = <span className={`truncate ${done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{l.task.title}</span>;
  return (
    <li className="group flex items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-gray-50">
      <span className="font-mono text-[11px] text-gray-400">{l.task.code}</span>
      {onOpen
        ? <button type="button" onClick={() => onOpen(l.task.id)} className="flex min-w-0 flex-1 text-left hover:underline">{name}</button>
        : <Link href={href} className="flex min-w-0 flex-1 hover:underline">{name}</Link>}
      <StatusPill status={l.task.status} />
      {l.canRemove && (
        <button type="button" disabled={busy} onClick={onRemove} aria-label={`Remove the link to ${l.task.code}`} title="Remove link" className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50">
          <X aria-hidden className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

function AddLink({ task, onClose, onSaved }: { task: Task; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [kind, setKind] = useState<TaskLinkKind>('waiting_on');
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const options = useQuery({
    queryKey: [...taskKeys.links(task.id), 'options', term],
    queryFn: () => apiClient.get<{ tasks: TaskLinkOption[] }>(`${base(task.id)}/options${term ? `?q=${encodeURIComponent(term)}` : ''}`),
  });
  const add = useMutation({
    mutationFn: (taskId: string) => apiClient.post<TaskLinks>(base(task.id), { kind, taskId }),
    onSuccess: async () => { await onSaved(); onClose(); },
    onError: (e) => setError(errorMessage(e, 'Could not link the tasks.')),
  });
  const list = options.data?.tasks ?? [];
  return (
    <div className="space-y-2 rounded-lg border border-gray-200 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="How they are linked" value={kind} onChange={(e) => setKind(e.target.value as TaskLinkKind)} title={KINDS.find((k) => k.value === kind)?.hint} className="h-8 rounded-md border border-gray-200 bg-white px-2 text-sm">
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <input
          autoFocus
          value={text}
          maxLength={100}
          aria-label="Find a task to link"
          placeholder="Search tasks or T-number"
          onChange={(e) => { setText(e.target.value); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}
          className="h-8 min-w-0 flex-1 basis-40 rounded-md border border-gray-200 px-2 text-sm"
        />
        <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
      </div>
      {error && <p role="alert" className="text-xs font-medium text-red-700">{error}</p>}
      {options.isLoading ? <p className="flex items-center gap-1.5 text-sm text-gray-400"><Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> Looking…</p>
        : options.isError ? <p role="alert" className="text-sm text-red-700">{errorMessage(options.error, 'Could not search the tasks.')}</p>
          : !list.length ? <p className="text-sm text-gray-500">No tasks to link{term ? ' match that' : ' yet'}.</p>
            : (
              <ul aria-label="Tasks you can link" className="max-h-52 overflow-y-auto">
                {list.map((o) => (
                  <li key={o.id}>
                    <button type="button" disabled={add.isPending} onClick={() => add.mutate(o.id)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-gray-50 disabled:opacity-50">
                      <span className="font-mono text-[11px] text-gray-400">{o.code}</span>
                      <span className="min-w-0 flex-1 truncate text-gray-800">{o.title}</span>
                      <StatusPill status={o.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
    </div>
  );
}

export default function Links({ task, base: pageBase, onOpen }: { task: Task; base: string; onOpen?: (id: string) => void }) {
  const q = useTaskLinks(task.id);
  const refresh = useRefreshLinks();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const remove = useMutation({
    mutationFn: (linkId: string) => apiClient.delete<TaskLinks>(`${base(task.id)}/${encodeURIComponent(linkId)}`),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e, 'Could not remove the link.')),
  });
  const d = q.data;
  const groups = d ? ([
    ['Waiting on', d.waitingOn], ['Blocking', d.blocking], ['Related', d.related],
  ] as const).filter(([, rows]) => rows.length) : [];
  return (
    <section aria-label="Links">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900"><Link2 aria-hidden className="h-4 w-4 text-gray-500" /> Links</h3>
        <span className="flex-1" />
        {d?.canAdd && !adding && (
          <button type="button" onClick={() => { setAdding(true); setError(''); }} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">
            <Plus aria-hidden className="h-3.5 w-3.5" /> Add link
          </button>
        )}
      </div>
      {adding && <div className="mb-2"><AddLink task={task} onClose={() => setAdding(false)} onSaved={refresh} /></div>}
      {error && <p role="alert" className="mb-1 text-xs font-medium text-red-700">{error}</p>}
      {q.isLoading ? <p className="text-sm text-gray-400">Loading links…</p>
        : q.isError ? <p role="alert" className="text-sm text-red-700">{errorMessage(q.error, 'Could not load the links.')}</p>
          : !groups.length && !d?.hidden ? <p className="text-sm text-gray-500">No links yet. Link a task this one waits on, blocks or goes with.</p>
            : (
              <div className="space-y-2">
                {groups.map(([title, rows]) => (
                  <div key={title}>
                    <p className="flex items-center gap-1 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      {title === 'Waiting on' && <Ban aria-hidden className="h-3 w-3" />}{title}
                    </p>
                    <ul className="divide-y divide-gray-50">
                      {rows.map((l) => <LinkRow key={l.linkId} l={l} href={`${pageBase}/${l.task.id}`} onOpen={onOpen} busy={remove.isPending} onRemove={() => { setError(''); remove.mutate(l.linkId); }} />)}
                    </ul>
                  </div>
                ))}
                {!!d?.hidden && (
                  <p className="flex items-center gap-1 px-2.5 text-xs text-gray-500"><Lock aria-hidden className="h-3 w-3" /> {d.hidden} linked task{d.hidden === 1 ? '' : 's'} you can’t open</p>
                )}
              </div>
            )}
    </section>
  );
}
