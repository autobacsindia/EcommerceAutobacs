'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { useAssignmentPages, useTrainingMeta } from './hooks';
import { STATUS, quietButton, type AssignmentSummary } from './types';

export function StatusPill({ status }: { status: AssignmentSummary['status'] }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS[status].pill}`}>{STATUS[status].label}</span>;
}

function Row({ a, base, showPerson }: { a: AssignmentSummary; base: string; showPerson: boolean }) {
  const pct = a.lessonsTotal ? Math.round((a.lessonsDone / a.lessonsTotal) * 100) : 0;
  return (
    <Link href={`${base}/${a.id}`} className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-blue-400">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="font-semibold text-gray-900">{showPerson ? `${a.user.name} · ${a.pathTitle}` : a.pathTitle}</h2>
        <StatusPill status={a.status} />
      </div>
      <p className="mt-1 text-sm text-gray-600">Buddy: {a.buddy.name} · {a.lessonsDone} of {a.lessonsTotal} lessons</p>
      <div className="mt-2 h-1.5 rounded-full bg-gray-200" aria-hidden><div className="h-1.5 rounded-full bg-blue-600" style={{ width: `${pct}%` }} /></div>
    </Link>
  );
}

const VIEWS = [{ key: 'mine', label: 'My training' }, { key: 'buddy', label: 'I am the buddy' }, { key: 'team', label: 'Team' }];
const EMPTY: Record<string, string> = {
  mine: 'You have no training yet. Your team head assigns it.',
  buddy: 'You are not anyone’s buddy right now.',
  team: 'Nobody in the team is on training. Open a training to assign it.',
};

export default function TrainingHome({ base }: { base: string }) {
  const params = useSearchParams();
  const meta = useTrainingMeta();
  const isManager = (meta.data?.teams.length ?? 0) > 0;
  const [view, setView] = useState(params.get('view') ?? 'mine');
  const views = VIEWS.filter((v) => v.key !== 'team' || isManager);
  const pages = useAssignmentPages(view, view !== 'team' || isManager);
  const rows = pages.data?.pages.flatMap((p) => p.assignments) ?? [];

  return (
    <div className="max-w-4xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Training</h1>
          <p className="mt-1 text-sm text-gray-600">Lessons in order, a test at the end, then your head signs you off.</p>
        </div>
        {isManager && <Link href={`${base}/paths`} className={quietButton}>Set up training</Link>}
      </div>
      <div role="tablist" className="mb-4 flex flex-wrap gap-2">
        {views.map((v) => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)} className={view === v.key ? 'rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white' : quietButton}>{v.label}</button>
        ))}
      </div>
      {pages.isLoading && <p className="text-sm text-gray-600">Loading…</p>}
      {pages.isError && <p className="text-sm text-red-700">Training could not be loaded. <button type="button" className="underline" onClick={() => pages.refetch()}>Try again</button></p>}
      {pages.isSuccess && !rows.length && (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center">
          <GraduationCap aria-hidden className="mx-auto h-8 w-8 text-gray-400" />
          <p className="mt-2 text-sm text-gray-600">{EMPTY[view] ?? EMPTY.mine}</p>
        </div>
      )}
      <div className="space-y-3">{rows.map((a) => <Row key={a.id} a={a} base={base} showPerson={view !== 'mine'} />)}</div>
      {pages.hasNextPage && <div className="mt-4 text-center"><button type="button" disabled={pages.isFetchingNextPage} onClick={() => pages.fetchNextPage()} className={quietButton}>Show more</button></div>}
    </div>
  );
}
