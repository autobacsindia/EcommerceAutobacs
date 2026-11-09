'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { errorMessage } from '@/components/staff/sales/types';
import { useLessonMeta } from '@/components/lessons/hooks';
import { useArchivePath, useAssignPath, useLessonOptions, usePath, useSavePath, useTrainingMeta } from './hooks';
import { STAGES, field, primaryButton, quietButton, type Path, type PathItem, type PathQuestion, type Stage } from './types';

const blankChoice = (): PathQuestion => ({ type: 'choice', text: '', options: ['', ''], correct: null, lessonId: '' });
const blankWritten = (): PathQuestion => ({ type: 'written', text: '', options: [], correct: null, lessonId: '' });

function QuestionCard({ q, n, lessons, onChange, onRemove }: {
  q: PathQuestion; n: number; lessons: { id: string; title: string }[]; onChange: (q: PathQuestion) => void; onRemove: () => void;
}) {
  const setOption = (i: number, v: string) => onChange({ ...q, options: q.options.map((o, x) => (x === i ? v : o)) });
  const removeOption = (i: number) => onChange({
    ...q,
    options: q.options.filter((_, x) => x !== i),
    correct: q.correct === i ? null : (q.correct !== null && q.correct > i ? q.correct - 1 : q.correct),
  });
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-gray-900">Question {n} · {q.type === 'choice' ? 'Multiple choice' : 'Written answer'}</p>
        <button type="button" aria-label={`Remove question ${n}`} onClick={onRemove} className={quietButton}><Trash2 aria-hidden className="h-4 w-4" /></button>
      </div>
      <label className="sr-only" htmlFor={`q-${n}`}>Question {n} text</label>
      <input id={`q-${n}`} className={field} maxLength={500} placeholder="Write the question" value={q.text} onChange={(e) => onChange({ ...q, text: e.target.value })} />
      {q.type === 'choice' && (
        <fieldset className="mt-2 space-y-1.5">
          <legend className="mb-1 text-xs text-gray-600">Tick the right answer</legend>
          {q.options.map((o, i) => (
             
            <div key={i} className="flex items-center gap-2">
              <input type="radio" name={`right-${n}`} aria-label={`Option ${i + 1} is right`} checked={q.correct === i} onChange={() => onChange({ ...q, correct: i })} />
              <input aria-label={`Question ${n} option ${i + 1}`} className={field} maxLength={200} value={o} onChange={(e) => setOption(i, e.target.value)} />
              {q.options.length > 2 && <button type="button" aria-label={`Remove option ${i + 1}`} onClick={() => removeOption(i)} className={quietButton}><Trash2 aria-hidden className="h-4 w-4" /></button>}
            </div>
          ))}
          {q.options.length < 6 && <button type="button" onClick={() => onChange({ ...q, options: [...q.options, ''] })} className={quietButton}>Add option</button>}
        </fieldset>
      )}
      <label className="mt-2 block text-xs text-gray-600" htmlFor={`q-lesson-${n}`}>If they get this wrong, tell them to re-read (optional)</label>
      <select id={`q-lesson-${n}`} className={field} value={q.lessonId} onChange={(e) => onChange({ ...q, lessonId: e.target.value })}>
        <option value="">No lesson</option>
        {lessons.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
      </select>
    </div>
  );
}

function AssignBox({ path, base }: { path: Path; base: string }) {
  const router = useRouter();
  const meta = useLessonMeta();
  const assign = useAssignPath(path.id);
  const [userId, setUserId] = useState('');
  const [buddyId, setBuddyId] = useState('');
  const people = meta.data?.people ?? [];
  const team = people.filter((p) => p.team === path.team);
  const ready = path.lessonCount > 0 && path.questionCount > 0;
  return (
    <section className="mt-8 max-w-3xl rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="font-semibold text-gray-900">Assign to someone</h2>
      {!ready && <p className="mt-1 text-sm text-gray-600">Save at least one lesson and one question first.</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="assign-user" className="mb-1 block text-sm font-medium text-gray-800">Person</label>
          <select id="assign-user" className={field} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Choose…</option>
            {team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="assign-buddy" className="mb-1 block text-sm font-medium text-gray-800">Buddy</label>
          <select id="assign-buddy" className={field} value={buddyId} onChange={(e) => setBuddyId(e.target.value)}>
            <option value="">Choose…</option>
            {people.filter((p) => p.id !== userId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      <button
        type="button"
        disabled={!ready || !userId || !buddyId || assign.isPending}
        className={`${primaryButton} mt-3`}
        onClick={() => assign.mutate({ userId, buddyId }, {
          onSuccess: (a) => router.push(`${base}/${a.id}`),
          onError: (e) => toast.error(errorMessage(e, 'That could not be assigned.')),
        })}
      >
        Assign
      </button>
    </section>
  );
}

export default function PathEditor({ id, base }: { id?: string; base: string }) {
  const router = useRouter();
  const meta = useTrainingMeta();
  const existing = usePath(id);
  const save = useSavePath(id);
  const archive = useArchivePath(id ?? '');
  const [title, setTitle] = useState('');
  const [team, setTeam] = useState('');
  const [items, setItems] = useState<PathItem[]>([]);
  const [questions, setQuestions] = useState<PathQuestion[]>([]);
  const [stage, setStage] = useState<Stage>('day1');
  const [error, setError] = useState('');
  const options = useLessonOptions(team).data ?? [];
  const available = options.filter((l) => !items.some((i) => i.lessonId === l.id));

  const loaded = existing.data;
  useEffect(() => {
    if (!loaded) return;
    setTitle(loaded.title);
    setTeam(loaded.team);
    setItems(loaded.items);
    setQuestions(loaded.questions);
  }, [loaded]);

  if (id && existing.isLoading) return <p className="text-sm text-gray-600">Loading…</p>;
  if (id && existing.isError) return <p className="text-sm text-gray-700">This training isn&apos;t available.</p>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const path = await save.mutateAsync({ title, items, questions, ...(id ? { rev: loaded?.rev ?? 0 } : { team }) });
      toast.success('Saved');
      if (!id) router.push(`${base}/paths/${path.id}`);
    } catch (err) {
      setError(errorMessage(err, 'This could not be saved. Please try again.'));
    }
  };
  const addLesson = (lessonId: string) => {
    const lesson = options.find((l) => l.id === lessonId);
    if (lesson) setItems((all) => [...all, { stage, lessonId, title: lesson.title }]);
  };
  // A question can't keep pointing at a lesson that left the list: saving would be refused.
  const removeLesson = (lessonId: string) => {
    setItems((all) => all.filter((x) => x.lessonId !== lessonId));
    setQuestions((all) => all.map((q) => (q.lessonId === lessonId ? { ...q, lessonId: '' } : q)));
  };
  const remove = () => {
    if (!window.confirm(`Remove "${title}"? People already on it keep their training.`)) return;
    archive.mutate(undefined, { onSuccess: () => router.push(`${base}/paths`), onError: (e) => toast.error(errorMessage(e, 'This could not be removed.')) });
  };

  return (
    <div>
      <Link href={`${base}/paths`} className="mb-3 inline-flex items-center gap-1 text-sm text-gray-700 hover:underline"><ArrowLeft aria-hidden className="h-4 w-4" />Set up training</Link>
      <h1 className="mb-5 text-2xl font-bold text-gray-900">{id ? 'Edit training' : 'New training'}</h1>
      <form onSubmit={submit} className="max-w-3xl space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="path-title" className="mb-1 block text-sm font-medium text-gray-800">Job</label>
            <input id="path-title" className={field} maxLength={100} placeholder="For example: Procurement executive" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          {!id && (
            <div>
              <label htmlFor="path-team" className="mb-1 block text-sm font-medium text-gray-800">Team</label>
              <select id="path-team" className={field} value={team} onChange={(e) => { setTeam(e.target.value); setItems([]); setQuestions((all) => all.map((q) => ({ ...q, lessonId: '' }))); }}>
                <option value="">Choose…</option>
                {(meta.data?.teams ?? []).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
          )}
        </div>

        <section>
          <h2 className="mb-2 font-semibold text-gray-900">Lessons, in order</h2>
          {STAGES.map((s) => {
            const here = items.filter((i) => i.stage === s.key);
            if (!here.length) return null;
            return (
              <div key={s.key} className="mb-3">
                <h3 className="mb-1 text-sm font-medium text-gray-800">{s.label}</h3>
                <ul className="space-y-1">
                  {here.map((i) => (
                    <li key={i.lessonId} className="flex items-center justify-between gap-2 rounded-md bg-gray-50 px-3 py-1.5 text-sm text-gray-900">
                      {i.title}
                      <button type="button" aria-label={`Remove ${i.title}`} onClick={() => removeLesson(i.lessonId)} className={quietButton}><Trash2 aria-hidden className="h-4 w-4" /></button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
            <select aria-label="When" className={field} value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <select aria-label="Add a lesson" className={field} value="" disabled={!team} onChange={(e) => addLesson(e.target.value)}>
              <option value="">{team ? 'Add a lesson…' : 'Choose a team first'}</option>
              {available.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
            </select>
          </div>
        </section>

        <section>
          <h2 className="mb-1 font-semibold text-gray-900">Test questions</h2>
          <p className="mb-2 text-sm text-gray-600">Pass mark {meta.data?.passMark ?? 80}%. Written answers are marked by the head. 10 to 15 questions works well.</p>
          <div className="space-y-3">
            {questions.map((q, i) => (
              <QuestionCard
                 
                key={q.id ?? `new-${i}`}
                q={q}
                n={i + 1}
                lessons={items.map((x) => ({ id: x.lessonId, title: x.title }))}
                onChange={(next) => setQuestions((all) => all.map((x, n) => (n === i ? next : x)))}
                onRemove={() => setQuestions((all) => all.filter((_, n) => n !== i))}
              />
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" className={quietButton} onClick={() => setQuestions((all) => [...all, blankChoice()])}>Add multiple choice</button>
            <button type="button" className={quietButton} onClick={() => setQuestions((all) => [...all, blankWritten()])}>Add written question</button>
          </div>
        </section>

        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={save.isPending} className={primaryButton}>{save.isPending ? 'Saving…' : 'Save'}</button>
          {id && <button type="button" onClick={remove} disabled={archive.isPending} className={quietButton}>Remove</button>}
        </div>
      </form>
      {loaded && <AssignBox path={loaded} base={base} />}
    </div>
  );
}
