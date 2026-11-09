'use client';

import toast from 'react-hot-toast';
import { errorMessage } from '@/components/staff/sales/types';
import { primaryButton } from '@/components/training/types';
import { useHandoverWork, useStartHandover } from './hooks';
import type { Departure, HandoverMove, WorkItem } from './types';

function Group({ title, rows, note }: { title: string; rows: WorkItem[]; note?: string }) {
  if (!rows.length) return null;
  return (
    <div className="mt-3">
      <h3 className="text-sm font-medium text-gray-800">{title} ({rows.length})</h3>
      {note && <p className="text-xs text-gray-600">{note}</p>}
      <ul className="mt-1 space-y-1">
        {rows.map((r) => <li key={r.id} className="rounded-md bg-gray-50 px-3 py-1.5 text-sm text-gray-900">{r.label}{r.status ? ` · ${r.status.replace(/_/g, ' ')}` : ''}</li>)}
      </ul>
    </div>
  );
}

const KIND: Record<HandoverMove['kind'], string> = { task: 'Task', lead: 'Lead', quotation: 'Quotation', lesson: 'Lesson' };

export default function WorkPanel({ d }: { d: Departure }) {
  const query = useHandoverWork(d.id, true);
  const start = useStartHandover(d.id);
  if (query.isLoading) return <p className="mt-6 text-sm text-gray-600">Loading their work…</p>;
  if (query.isError || !query.data) return <p className="mt-6 text-sm text-red-700">Their work could not be loaded. <button type="button" className="underline" onClick={() => query.refetch()}>Try again</button></p>;
  const { work, goesTo, moves } = query.data;
  const toMove = work.tasks.length + work.leads.length + work.quotations.length + work.lessons.length;
  const failed = moves.filter((m) => m.state === 'failed');
  const press = () => {
    if (!goesTo) return;
    if (!window.confirm(`Give ${toMove} item${toMove === 1 ? '' : 's'} from ${d.user.name} to ${goesTo.name}? The team will see the tasks. Lessons go to the team head.`)) return;
    start.mutate(undefined, {
      onSuccess: (r) => { if (r.result.failed) toast.error(`${r.result.failed} could not be moved. See the list.`); else toast.success(`${r.result.moved} moved`); },
      onError: (e) => toast.error(errorMessage(e, 'The handover could not be started.')),
    });
  };
  return (
    <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="font-semibold text-gray-900">What {d.user.name} still has</h2>
      {!toMove && !work.orders.length && <p className="mt-1 text-sm text-gray-600">Nothing left to move.</p>}
      <Group title="Open tasks" rows={work.tasks} />
      <Group title="Open leads" rows={work.leads} />
      <Group title="Open quotations" rows={work.quotations} />
      <Group title="Lessons they look after" rows={work.lessons} note="These go to the team head." />
      <Group title="Orders still in progress" rows={work.orders} note="These stay under their name. Please follow them up." />
      {toMove > 0 && (
        <div className="mt-4">
          {goesTo
            ? <p className="text-sm text-gray-900">{toMove} item{toMove === 1 ? '' : 's'} will go to <strong>{goesTo.name}</strong>. Please do this before removing access.</p>
            : <p className="text-sm text-red-700">Name someone to take over first.</p>}
          <button type="button" disabled={!goesTo || start.isPending} onClick={press} className={`${primaryButton} mt-2`}>{start.isPending ? 'Moving…' : 'Start handover'}</button>
        </div>
      )}
      {failed.length > 0 && (
        <div role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">Not moved yet. Fix the reason, then press Start handover again.</p>
          <ul className="mt-1 space-y-0.5">{failed.map((m) => <li key={m.id}>{KIND[m.kind]}: {m.label}: {m.error}</li>)}</ul>
        </div>
      )}
      {moves.some((m) => m.state === 'moved') && (
        <details className="mt-4 text-sm text-gray-800">
          <summary className="cursor-pointer font-medium">Moved so far ({moves.filter((m) => m.state === 'moved').length})</summary>
          <ul className="mt-1 space-y-0.5">{moves.filter((m) => m.state === 'moved').map((m) => <li key={m.id}>{KIND[m.kind]}: {m.label}, from {m.fromName} to {m.toName}, by {m.byName}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
