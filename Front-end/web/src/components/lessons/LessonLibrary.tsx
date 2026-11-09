'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, GraduationCap, Plus } from 'lucide-react';
import { ListSearch, ListSelect } from '@/components/panel/ListControls';
import { useLessonMeta, useLessonPages } from './hooks';
import { KIND_LABEL, type Lesson } from './types';

function LessonCard({ lesson, base }: { lesson: Lesson; base: string }) {
  return (
    <Link href={`${base}/${lesson.id}`} className="block rounded-xl border border-gray-200 bg-white p-4 transition hover:border-blue-400">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold text-gray-900">{lesson.title}</h2>
        {lesson.doneAt && <CheckCircle2 aria-label="Finished" className="h-5 w-5 shrink-0 text-emerald-600" />}
      </div>
      <p className="mt-1 text-sm text-gray-600">
        {lesson.audienceLabel}{lesson.topic ? ` · ${lesson.topic}` : ''}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
        {lesson.fileKinds.map((k) => <span key={k} className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">{KIND_LABEL[k]}</span>)}
        {lesson.stale && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
            <AlertTriangle aria-hidden className="h-3 w-3" />Needs checking
          </span>
        )}
      </div>
    </Link>
  );
}

/** Every lesson this person may see, by section. `base` is /team/lessons or /admin/lessons. */
export default function LessonLibrary({ base }: { base: string }) {
  const meta = useLessonMeta();
  const [section, setSection] = useState('');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(typed), 300);
    return () => clearTimeout(t);
  }, [typed]);
  const pages = useLessonPages({ section, q });
  const lessons = pages.data?.pages.flatMap((p) => p.lessons) ?? [];
  const canPost = (meta.data?.postTo.length ?? 0) > 0;

  return (
    <div className="max-w-5xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Lessons</h1>
          <p className="mt-1 text-sm text-gray-600">Learn how the work is done here: notes, videos, PDFs and slides.</p>
        </div>
        {canPost && (
          <Link href={`${base}/new`} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <Plus aria-hidden className="h-4 w-4" />Post a lesson
          </Link>
        )}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ListSearch value={typed} onChange={setTyped} placeholder="Search lessons" label="Search lessons" />
        <ListSelect
          label="Section"
          value={section}
          onChange={setSection}
          allLabel="All sections"
          options={(meta.data?.sections ?? []).map((s) => ({ value: s.key, label: s.label }))}
        />
      </div>
      {pages.isLoading && <p className="text-sm text-gray-500">Loading lessons…</p>}
      {pages.isError && (
        <p className="text-sm text-red-700">
          Lessons could not be loaded. <button type="button" className="underline" onClick={() => pages.refetch()}>Try again</button>
        </p>
      )}
      {pages.isSuccess && !lessons.length && (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center">
          <GraduationCap aria-hidden className="mx-auto h-8 w-8 text-gray-400" />
          <p className="mt-2 text-sm text-gray-600">{q || section ? 'No lessons match.' : 'No lessons yet.'}</p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {lessons.map((l) => <LessonCard key={l.id} lesson={l} base={base} />)}
      </div>
      {pages.hasNextPage && (
        <div className="mt-4 text-center">
          <button type="button" disabled={pages.isFetchingNextPage} onClick={() => pages.fetchNextPage()} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-800 disabled:opacity-50">
            {pages.isFetchingNextPage ? 'Loading…' : 'Show more'}
          </button>
        </div>
      )}
    </div>
  );
}
