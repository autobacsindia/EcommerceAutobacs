'use client';

import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { usePathPages } from './hooks';
import { primaryButton, quietButton } from './types';

export default function PathList({ base }: { base: string }) {
  const pages = usePathPages();
  const rows = pages.data?.pages.flatMap((p) => p.paths) ?? [];
  return (
    <div className="max-w-4xl">
      <Link href={base} className="mb-3 inline-flex items-center gap-1 text-sm text-gray-700 hover:underline"><ArrowLeft aria-hidden className="h-4 w-4" />Training</Link>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Set up training</h1>
        <Link href={`${base}/paths/new`} className={primaryButton}><Plus aria-hidden className="h-4 w-4" />New training</Link>
      </div>
      {pages.isLoading && <p className="text-sm text-gray-600">Loading…</p>}
      {pages.isError && <p className="text-sm text-red-700">This could not be loaded. <button type="button" className="underline" onClick={() => pages.refetch()}>Try again</button></p>}
      {pages.isSuccess && !rows.length && <p className="text-sm text-gray-600">No training set up yet. Make one for each job, such as “Procurement executive”.</p>}
      <div className="space-y-3">
        {rows.map((p) => (
          <Link key={p.id} href={`${base}/paths/${p.id}`} className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-blue-400">
            <h2 className="font-semibold text-gray-900">{p.title}</h2>
            <p className="mt-1 text-sm text-gray-600">{p.teamLabel} · {p.lessonCount} lessons · {p.questionCount} questions</p>
          </Link>
        ))}
      </div>
      {pages.hasNextPage && <div className="mt-4 text-center"><button type="button" onClick={() => pages.fetchNextPage()} className={quietButton}>Show more</button></div>}
    </div>
  );
}
