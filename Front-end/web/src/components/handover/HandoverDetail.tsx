'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft } from 'lucide-react';
import RichText from '@/components/ui/RichText';
import RichTextBox from '@/components/ui/RichTextBox';
import { errorMessage } from '@/components/staff/sales/types';
import { useLessonMeta } from '@/components/lessons/hooks';
import { useTrainingMeta } from '@/components/training/hooks';
import { field, primaryButton, quietButton } from '@/components/training/types';
import WorkPanel from './WorkPanel';
import { useCancelDeparture, useDeparture, useUpdateDeparture } from './hooks';
import { dayLabel, timing, type Departure } from './types';

function Details({ d, base }: { d: Departure; base: string }) {
  const update = useUpdateDeparture(d.id);
  const cancel = useCancelDeparture(d.id);
  const teams = (useTrainingMeta().data?.teams ?? []).map((t) => t.key);
  const people = (useLessonMeta().data?.people ?? []).filter((p) => !p.isAdmin && teams.includes(p.team ?? '') && p.id !== d.user.id);
  const [lastDay, setLastDay] = useState(d.lastDay);
  const [reason, setReason] = useState(d.reason ?? '');
  const [successorId, setSuccessorId] = useState(d.successor?.id ?? '');
  const removeAt = base.startsWith('/admin') ? '/admin/staff' : '/team/members';
  const save = () => update.mutate({ rev: d.rev, lastDay, reason, successorId }, {
    onSuccess: () => toast.success('Saved'),
    onError: (e) => toast.error(errorMessage(e, 'This could not be saved.')),
  });
  return (
    <section className="mt-5 space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="e-day" className="mb-1 block text-sm font-medium text-gray-800">Last day</label>
          <input id="e-day" type="date" className={field} value={lastDay} onChange={(e) => setLastDay(e.target.value)} />
        </div>
        <div>
          <label htmlFor="e-next" className="mb-1 block text-sm font-medium text-gray-800">Who takes over</label>
          <select id="e-next" className={field} value={successorId} onChange={(e) => setSuccessorId(e.target.value)}>
            <option value="">Not named yet</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="e-reason" className="mb-1 block text-sm font-medium text-gray-800">Reason (private: only admins and their team head)</label>
        <textarea id="e-reason" className={field} rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={update.isPending} onClick={save} className={primaryButton}>Save</button>
        <Link href={removeAt} className={quietButton}>Remove access in My team</Link>
        <button type="button" disabled={cancel.isPending} className={quietButton} onClick={() => { if (window.confirm(`${d.user.name} is staying? This cancels the record.`)) cancel.mutate(undefined, { onError: (e) => toast.error(errorMessage(e, 'That could not be saved.')) }); }}>They are staying</button>
      </div>
    </section>
  );
}

function Note({ d }: { d: Departure }) {
  const update = useUpdateDeparture(d.id);
  const [note, setNote] = useState(d.note ?? '');
  useEffect(() => { setNote(d.note ?? ''); }, [d.note]);
  if (!d.can.writeNote) return <RichText value={d.note ?? ''} empty={<p className="text-sm text-gray-600">Nothing written yet.</p>} />;
  return (
    <>
      <RichTextBox value={note} onChange={setNote} ariaLabel="Handover note" placeholder="What is in progress, key suppliers or customers, what the next person must know" maxLength={20000} />
      <p className="mt-1 text-xs text-gray-600">Never write passwords here.</p>
      <button type="button" disabled={update.isPending} className={`${primaryButton} mt-2`} onClick={() => update.mutate({ rev: d.rev, note }, { onSuccess: () => toast.success('Note saved'), onError: (e) => toast.error(errorMessage(e, 'The note could not be saved. Your text is still here.')) })}>Save note</button>
    </>
  );
}

export default function HandoverDetail({ id, base }: { id: string; base: string }) {
  const query = useDeparture(id);
  if (query.isLoading) return <p className="text-sm text-gray-600">Loading…</p>;
  if (query.isError || !query.data) return <div><p className="text-sm text-gray-700">This isn&apos;t available.</p><Link href={base} className="mt-2 inline-block text-sm text-blue-700 underline">Back to Handover</Link></div>;
  const d = query.data;
  const t = timing(d);
  return (
    <article className="max-w-3xl">
      <Link href={base} className="mb-3 inline-flex items-center gap-1 text-sm text-gray-700 hover:underline"><ArrowLeft aria-hidden className="h-4 w-4" />Handover</Link>
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold text-gray-900">{d.user.name}</h1><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${t.pill}`}>{t.label}</span></div>
      <p className="mt-1 text-sm text-gray-600">{d.teamLabel} · Last day {dayLabel(d.lastDay)} · Taking over: {d.successor?.name ?? 'not named yet'}</p>
      {d.can.manage && <Details key={d.rev} d={d} base={base} />}
      {!d.can.manage && d.reason && <p className="mt-4 text-sm text-gray-800"><span className="font-medium">Reason (private):</span> {d.reason}</p>}
      {d.can.handover && <WorkPanel key={d.successor?.id ?? 'none'} d={d} />}
      <section className="mt-6">
        <h2 className="mb-2 font-semibold text-gray-900">Handover note</h2>
        <Note d={d} />
        {d.noteAt && d.noteByName && <p className="mt-2 text-xs text-gray-600">Last updated by {d.noteByName}.</p>}
      </section>
    </article>
  );
}
