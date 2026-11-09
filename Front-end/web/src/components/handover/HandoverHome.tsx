'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Handshake } from 'lucide-react';
import { errorMessage } from '@/components/staff/sales/types';
import { useLessonMeta } from '@/components/lessons/hooks';
import { useTrainingMeta } from '@/components/training/hooks';
import { field, primaryButton, quietButton } from '@/components/training/types';
import { useDeparturePages, useMyHandovers, useRecordDeparture } from './hooks';
import { dayLabel, timing, type Departure } from './types';

function Row({ d, base, title }: { d: Departure; base: string; title: string }) {
  const t = timing(d);
  return (
    <Link href={`${base}/${d.id}`} className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-blue-400">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="font-semibold text-gray-900">{title}</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${t.pill}`}>{t.label}</span>
      </div>
      <p className="mt-1 text-sm text-gray-600">{d.teamLabel} · Last day {dayLabel(d.lastDay)} · Taking over: {d.successor?.name ?? 'not named yet'}</p>
    </Link>
  );
}

function RecordForm({ base, teams, onClose }: { base: string; teams: string[]; onClose: () => void }) {
  const router = useRouter();
  const people = (useLessonMeta().data?.people ?? []).filter((p) => !p.isAdmin && teams.includes(p.team ?? ''));
  const record = useRecordDeparture();
  const [userId, setUserId] = useState('');
  const [lastDay, setLastDay] = useState('');
  const [reason, setReason] = useState('');
  const [successorId, setSuccessorId] = useState('');
  const [error, setError] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    record.mutate({ userId, lastDay, reason, successorId }, {
      onSuccess: (d) => router.push(`${base}/${d.id}`),
      onError: (err) => setError(errorMessage(err, 'This could not be saved. Please try again.')),
    });
  };
  return (
    <form onSubmit={submit} className="mb-5 max-w-3xl space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="font-semibold text-gray-900">Record a resignation</h2>
      <p className="text-sm text-gray-600">This does not remove their access or move any work.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="d-user" className="mb-1 block text-sm font-medium text-gray-800">Who is leaving</label>
          <select id="d-user" className={field} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Choose…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="d-day" className="mb-1 block text-sm font-medium text-gray-800">Last day</label>
          <input id="d-day" type="date" className={field} value={lastDay} onChange={(e) => setLastDay(e.target.value)} />
        </div>
      </div>
      <div>
        <label htmlFor="d-next" className="mb-1 block text-sm font-medium text-gray-800">Who takes over (optional)</label>
        <select id="d-next" className={field} value={successorId} onChange={(e) => setSuccessorId(e.target.value)}>
          <option value="">Not named yet</option>
          {people.filter((p) => p.id !== userId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="d-reason" className="mb-1 block text-sm font-medium text-gray-800">Reason (private: only admins and their team head)</label>
        <textarea id="d-reason" className={field} rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={!userId || !lastDay || record.isPending} className={primaryButton}>Save</button>
        <button type="button" onClick={onClose} className={quietButton}>Close</button>
      </div>
    </form>
  );
}

export default function HandoverHome({ base }: { base: string }) {
  const meta = useTrainingMeta();
  const teams = (meta.data?.teams ?? []).map((t) => t.key);
  const isManager = teams.length > 0;
  const mine = useMyHandovers();
  const pages = useDeparturePages(isManager);
  const [adding, setAdding] = useState(false);
  const canRecord = pages.data?.pages[0]?.canRecord === true;
  const rows = pages.data?.pages.flatMap((p) => p.departures) ?? [];
  const myRows = mine.data ?? [];
  const nothing = mine.isSuccess && !myRows.length && (!isManager || (pages.isSuccess && !rows.length));

  return (
    <div className="max-w-4xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Handover</h1>
          <p className="mt-1 text-sm text-gray-600">When someone leaves, this keeps their last day and handover note together.</p>
        </div>
        {canRecord && !adding && <button type="button" onClick={() => setAdding(true)} className={primaryButton}>Record a resignation</button>}
      </div>
      {adding && canRecord && <RecordForm base={base} teams={teams} onClose={() => setAdding(false)} />}
      {(mine.isError || pages.isError) && <p className="text-sm text-red-700">This could not be loaded. <button type="button" className="underline" onClick={() => { void mine.refetch(); void pages.refetch(); }}>Try again</button></p>}
      {(mine.isLoading || pages.isLoading) && <p className="text-sm text-gray-600">Loading…</p>}
      {nothing && (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center">
          <Handshake aria-hidden className="mx-auto h-8 w-8 text-gray-400" />
          <p className="mt-2 text-sm text-gray-600">No handovers right now.</p>
        </div>
      )}
      {myRows.length > 0 && (
        <section className="mb-6 space-y-3">
          <h2 className="font-semibold text-gray-900">Yours</h2>
          {myRows.map((d) => <Row key={d.id} d={d} base={base} title={d.mine === 'leaving' ? 'Your handover note' : `Taking over from ${d.user.name}`} />)}
        </section>
      )}
      {rows.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold text-gray-900">People leaving</h2>
          {rows.map((d) => <Row key={d.id} d={d} base={base} title={d.user.name} />)}
        </section>
      )}
      {pages.hasNextPage && <div className="mt-4 text-center"><button type="button" disabled={pages.isFetchingNextPage} onClick={() => pages.fetchNextPage()} className={quietButton}>Show more</button></div>}
    </div>
  );
}
