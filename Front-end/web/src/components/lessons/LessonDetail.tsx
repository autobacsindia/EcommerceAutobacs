'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, ExternalLink, Play, Trash2, Upload } from 'lucide-react';
import RichText from '@/components/ui/RichText';
import { errorMessage } from '@/components/staff/sales/types';
import LessonForm from './LessonForm';
import {
  lessonFileLink, useAddLessonFile, useArchiveLesson, useLesson, useLessonChecked, useLessonDone,
  useLessonProgress, useRemoveLessonFile, useUpdateLesson,
} from './hooks';
import { KIND_LABEL, LESSON_FILE_ACCEPT, formatDay, formatSize, lessonFileProblem, type Lesson, type LessonFile } from './types';

const quietButton = 'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50';

function FileRow({ lesson, file, onRemove }: { lesson: Lesson; file: LessonFile; onRemove?: () => void }) {
  const [videoUrl, setVideoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const failed = (e: unknown) => toast.error(errorMessage(e, 'That file could not be opened. Please try again.'));

  const play = async () => {
    setBusy(true);
    try { setVideoUrl(await lessonFileLink(lesson.id, file.fileName)); } catch (e) { failed(e); }
    setBusy(false);
  };
  const open = async () => {
    // Opened before the wait, or the browser treats it as a pop-up and blocks it.
    const tab = window.open('', '_blank');
    setBusy(true);
    try {
      const url = await lessonFileLink(lesson.id, file.fileName);
      if (tab) { tab.opener = null; tab.location.href = url; } else window.location.href = url;
    } catch (e) { tab?.close(); failed(e); }
    setBusy(false);
  };
  const viewable = file.kind === 'pdf' || file.kind === 'image';

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium text-gray-900">{file.name}</p>
          <p className="text-xs text-gray-600">{KIND_LABEL[file.kind]} · {formatSize(file.size)}</p>
        </div>
        <div className="flex gap-2">
          {file.kind === 'video' && !videoUrl && <button type="button" disabled={busy} onClick={play} className={quietButton}><Play aria-hidden className="h-4 w-4" />Play</button>}
          {viewable && <button type="button" disabled={busy} onClick={open} className={quietButton}><ExternalLink aria-hidden className="h-4 w-4" />Open</button>}
          {!viewable && file.kind !== 'video' && <button type="button" disabled={busy} onClick={open} className={quietButton}><Download aria-hidden className="h-4 w-4" />Download</button>}
          {onRemove && <button type="button" aria-label={`Remove ${file.name}`} onClick={onRemove} className={quietButton}><Trash2 aria-hidden className="h-4 w-4" /></button>}
        </div>
      </div>
      {videoUrl && (
        <video
          controls
          src={videoUrl}
          className="mt-3 w-full rounded-lg bg-black"
          // The private link expired during a long watch: ask for another.
          onError={() => { setVideoUrl(''); toast.error('The video could not be played. Press Play to try again.'); }}
        />
      )}
    </li>
  );
}

function Files({ lesson }: { lesson: Lesson }) {
  const add = useAddLessonFile(lesson.id);
  const remove = useRemoveLessonFile(lesson.id);
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ name: string; pct: number } | null>(null);
  const files = lesson.files ?? [];

  const addFiles = async (chosen: File[]) => {
    for (const file of chosen) {
      const problem = lessonFileProblem(file);
      if (problem) { toast.error(problem); continue; }
      setUploading({ name: file.name, pct: 0 });
      try {
        await add.mutateAsync({ file, onProgress: (pct) => setUploading({ name: file.name, pct }) });
      } catch (e) {
        toast.error(errorMessage(e, `"${file.name}" could not be added. Please try again.`));
      }
    }
    setUploading(null);
    if (input.current) input.current.value = '';
  };
  const removeFile = (file: LessonFile) => {
    if (!window.confirm(`Remove "${file.name}"? This can't be undone.`)) return;
    remove.mutate(file.fileName, { onError: (e) => toast.error(errorMessage(e, 'That file could not be removed.')) });
  };

  if (!files.length && !lesson.can.edit) return null;
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-gray-900">Files</h2>
        {lesson.can.edit && (
          <>
            <input ref={input} data-testid="lesson-file-input" type="file" multiple hidden accept={LESSON_FILE_ACCEPT} onChange={(e) => addFiles(Array.from(e.target.files ?? []))} />
            <button type="button" disabled={!!uploading} onClick={() => input.current?.click()} className={quietButton}><Upload aria-hidden className="h-4 w-4" />Add files</button>
          </>
        )}
      </div>
      {uploading && <p role="status" className="mb-2 text-sm text-gray-700">Uploading {uploading.name}: {uploading.pct}%. Keep this page open.</p>}
      {files.length ? (
        <ul className="space-y-2">
          {files.map((f) => <FileRow key={f.fileName} lesson={lesson} file={f} onRemove={lesson.can.edit ? () => removeFile(f) : undefined} />)}
        </ul>
      ) : !uploading && <p className="text-sm text-gray-600">No files yet. Add a video, PDF or PowerPoint.</p>}
    </section>
  );
}

function Progress({ lesson }: { lesson: Lesson }) {
  const progress = useLessonProgress(lesson.id, lesson.can.edit);
  if (!lesson.can.edit) return null;
  const people = progress.data ?? [];
  return (
    <section className="mt-6">
      <h2 className="mb-2 font-semibold text-gray-900">
        Who has finished{progress.data ? ` (${people.filter((p) => p.doneAt).length} of ${people.length})` : ''}
      </h2>
      {progress.isLoading && <p className="text-sm text-gray-600">Loading…</p>}
      {progress.isError && <p className="text-sm text-red-700">This could not be loaded.</p>}
      <ul className="grid gap-1 text-sm sm:grid-cols-2">
        {people.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-gray-50 px-3 py-1.5">
            <span className="text-gray-900">{p.name} <span className="text-gray-600">· {p.teamLabel}</span></span>
            <span className="shrink-0 text-xs text-gray-600">{p.doneAt ? formatDay(p.doneAt) : 'Not yet'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function LessonDetail({ id, base }: { id: string; base: string }) {
  const router = useRouter();
  const query = useLesson(id);
  const update = useUpdateLesson(id);
  const done = useLessonDone(id);
  const checked = useLessonChecked(id);
  const archive = useArchiveLesson(id);
  const [editing, setEditing] = useState(false);
  const failed = (fallback: string) => (e: unknown) => toast.error(errorMessage(e, fallback));

  if (query.isLoading) return <p className="text-sm text-gray-600">Loading lesson…</p>;
  if (query.isError || !query.data) {
    return (
      <div>
        <p className="text-sm text-gray-700">This lesson isn&apos;t available. It may have been removed, or be for another team.</p>
        <Link href={base} className="mt-2 inline-block text-sm text-blue-700 underline">Back to lessons</Link>
      </div>
    );
  }
  const lesson = query.data;

  if (editing) {
    return (
      <div>
        <h1 className="mb-5 text-2xl font-bold text-gray-900">Edit lesson</h1>
        <LessonForm
          canManage={lesson.can.manage}
          submitLabel="Save"
          initial={{ title: lesson.title, body: lesson.body ?? '', topic: lesson.topic, audience: lesson.audience, ownerId: lesson.owner.id }}
          onCancel={() => setEditing(false)}
          onSubmit={async ({ title, body, topic, audience, ownerId }) => {
            await update.mutateAsync({
              rev: lesson.rev, title, body, topic,
              ...(lesson.can.manage ? { audience, ...(ownerId ? { ownerId } : {}) } : {}),
            });
            setEditing(false);
          }}
        />
      </div>
    );
  }

  const remove = () => {
    if (!window.confirm(`Remove "${lesson.title}" from the library?`)) return;
    archive.mutate(undefined, { onSuccess: () => router.push(base), onError: failed('The lesson could not be removed.') });
  };

  return (
    <article className="max-w-3xl">
      <Link href={base} className="mb-3 inline-flex items-center gap-1 text-sm text-gray-700 hover:underline"><ArrowLeft aria-hidden className="h-4 w-4" />Lessons</Link>
      <h1 className="text-2xl font-bold text-gray-900">{lesson.title}</h1>
      <p className="mt-1 text-sm text-gray-600">
        {lesson.audienceLabel}{lesson.topic ? ` · ${lesson.topic}` : ''} · Kept up to date by {lesson.owner.name} · Last checked {formatDay(lesson.lastCheckedAt)}
      </p>
      {lesson.stale && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-100 p-3 text-sm text-amber-800">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          This lesson hasn&apos;t been checked for over 90 days, so parts of it may be out of date.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {lesson.can.edit && <button type="button" onClick={() => setEditing(true)} className={quietButton}>Edit</button>}
        {lesson.can.edit && <button type="button" disabled={checked.isPending} onClick={() => checked.mutate(undefined, { onError: failed('That could not be saved.') })} className={quietButton}>Mark as checked</button>}
        {lesson.can.manage && <button type="button" disabled={archive.isPending} onClick={remove} className={quietButton}>Remove</button>}
      </div>
      <div className="mt-5 text-gray-900">
        <RichText value={lesson.body} empty={<p className="text-sm text-gray-600">No written notes.</p>} />
      </div>
      <Files lesson={lesson} />
      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
        {lesson.doneAt ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm text-gray-900"><CheckCircle2 aria-hidden className="h-5 w-5 text-emerald-600" />You finished this on {formatDay(lesson.doneAt)}.</p>
            <button type="button" disabled={done.isPending} onClick={() => done.mutate(false, { onError: failed('That could not be saved.') })} className={quietButton}>Mark as not finished</button>
          </div>
        ) : (
          <button type="button" disabled={done.isPending} onClick={() => done.mutate(true, { onError: failed('That could not be saved.') })} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            I&apos;ve finished this lesson
          </button>
        )}
      </div>
      <Progress lesson={lesson} />
    </article>
  );
}
