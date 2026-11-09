'use client';

import Link from 'next/link';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, CheckCircle2, Circle } from 'lucide-react';
import { errorMessage } from '@/components/staff/sales/types';
import { formatDay } from '@/components/lessons/types';
import { StatusPill } from './TrainingHome';
import { useAssignment, useAssignmentAction, useMarkTest, useStartTest, useSubmitTest } from './hooks';
import { STAGES, field, primaryButton, quietButton, type Assignment, type Attempt, type OpenAttempt } from './types';

const failed = (fallback: string) => (e: unknown) => toast.error(errorMessage(e, fallback));

function Paper({ assignmentId, attempt }: { assignmentId: string; attempt: OpenAttempt }) {
  const submit = useSubmitTest(assignmentId);
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const blank = attempt.questions.filter((q) => (q.type === 'written' ? !String(answers[q.id] ?? '').trim() : answers[q.id] === undefined)).length;
  const handIn = () => {
    const warning = blank ? `${blank} left blank will count as wrong. ` : '';
    if (!window.confirm(`${warning}Hand in your test? This uses attempt ${attempt.number}.`)) return;
    submit.mutate({ attemptId: attempt.id, answers }, { onError: failed('Your test could not be handed in. Your answers are still here, so please try again.') });
  };
  return (
    <section className="mt-6">
      <h2 className="mb-1 font-semibold text-gray-900">Test: attempt {attempt.number}</h2>
      <p className="mb-3 text-sm text-gray-600">Keep this page open until you hand in.</p>
      <ol className="space-y-3">
        {attempt.questions.map((q, n) => (
          <li key={q.id} className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="mb-2 text-sm font-medium text-gray-900">{n + 1}. {q.text}</p>
            {q.type === 'written' ? (
              <textarea aria-label={`Answer to question ${n + 1}`} className={field} rows={3} maxLength={2000} value={String(answers[q.id] ?? '')} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
            ) : q.options.map((o, i) => (
              <label key={o} className="flex items-center gap-2 py-1 text-sm text-gray-900">
                <input type="radio" name={q.id} checked={answers[q.id] === i} onChange={() => setAnswers((a) => ({ ...a, [q.id]: i }))} />{o}
              </label>
            ))}
          </li>
        ))}
      </ol>
      <button type="button" disabled={submit.isPending} onClick={handIn} className={`${primaryButton} mt-3`}>{submit.isPending ? 'Handing in…' : 'Hand in'}</button>
    </section>
  );
}

function Marking({ assignmentId, attempt }: { assignmentId: string; attempt: Attempt }) {
  const mark = useMarkTest(assignmentId);
  const written = (attempt.questions ?? []).filter((q) => q.right === null);
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const complete = written.every((q) => typeof marks[q.id] === 'boolean');
  return (
    <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="font-semibold text-gray-900">Mark the written answers</h2>
      {written.map((q) => (
        <div key={q.id} className="mt-3">
          <p className="text-sm font-medium text-gray-900">{q.text}</p>
          <p className="mt-1 whitespace-pre-wrap rounded-md bg-gray-50 p-2 text-sm text-gray-900">{String(q.answer ?? '')}</p>
          <div className="mt-1 flex gap-4 text-sm text-gray-900">
            <label className="flex items-center gap-1.5"><input type="radio" name={`mark-${q.id}`} checked={marks[q.id] === true} onChange={() => setMarks((m) => ({ ...m, [q.id]: true }))} />Right</label>
            <label className="flex items-center gap-1.5"><input type="radio" name={`mark-${q.id}`} checked={marks[q.id] === false} onChange={() => setMarks((m) => ({ ...m, [q.id]: false }))} />Wrong</label>
          </div>
        </div>
      ))}
      <button type="button" disabled={!complete || mark.isPending} onClick={() => mark.mutate({ attemptId: attempt.id, marks }, { onError: failed('The marks could not be saved.') })} className={`${primaryButton} mt-3`}>Save marks</button>
    </section>
  );
}

function AttemptRow({ t, passMark }: { t: Attempt; passMark: number }) {
  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-900">
      <p className="font-medium">
        Attempt {t.number}: {t.status === 'marking' ? 'waiting for marking' : `${t.score}% (${t.passed ? 'passed' : `needs ${passMark}%`})`}
      </p>
      {t.toReview.length > 0 && <p className="mt-1 text-gray-700">Re-read: {t.toReview.join(', ')}</p>}
      {t.questions && t.status === 'graded' && (
        <ul className="mt-2 space-y-1 text-gray-700">
          {t.questions.map((q) => (
            <li key={q.id}>
              {q.right ? '✓' : '✗'} {q.text}
              {q.type === 'choice' && !q.right && q.correct !== null && <span className="text-gray-600"> (answer: {q.options[q.correct]})</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Manager({ a }: { a: Assignment }) {
  const retry = useAssignmentAction(a.id, 'allow-retry');
  const sign = useAssignmentAction(a.id, 'sign-off');
  const cancel = useAssignmentAction(a.id, 'cancel');
  if (!a.can.signOff && !a.can.allowRetry && !a.can.cancel) return null;
  return (
    <div className="mt-6 flex flex-wrap gap-2">
      {a.can.signOff && <button type="button" disabled={sign.isPending} className={primaryButton} onClick={() => { if (window.confirm(`Sign off ${a.user.name} as trained?`)) sign.mutate(undefined, { onError: failed('This could not be signed off.') }); }}>Sign off</button>}
      {a.can.allowRetry && <button type="button" disabled={retry.isPending} className={primaryButton} onClick={() => retry.mutate(undefined, { onError: failed('That could not be saved.') })}>Allow another attempt</button>}
      {a.can.cancel && <button type="button" disabled={cancel.isPending} className={quietButton} onClick={() => { if (window.confirm('Cancel this training?')) cancel.mutate(undefined, { onError: failed('That could not be saved.') }); }}>Cancel training</button>}
    </div>
  );
}

export default function TrainingDetail({ id, base }: { id: string; base: string }) {
  const query = useAssignment(id);
  const start = useStartTest(id);
  if (query.isLoading) return <p className="text-sm text-gray-600">Loading…</p>;
  if (query.isError || !query.data) {
    return <div><p className="text-sm text-gray-700">This training isn&apos;t available.</p><Link href={base} className="mt-2 inline-block text-sm text-blue-700 underline">Back to training</Link></div>;
  }
  const a = query.data;
  const lessonsBase = base.replace(/\/training$/, '/lessons');
  const toMark = a.can.mark ? a.attempts.find((t) => t.status === 'marking') : undefined;
  const left = a.attemptsAllowed !== undefined && a.attemptsUsed !== undefined ? a.attemptsAllowed - a.attemptsUsed : null;

  return (
    <article className="max-w-3xl">
      <Link href={base} className="mb-3 inline-flex items-center gap-1 text-sm text-gray-700 hover:underline"><ArrowLeft aria-hidden className="h-4 w-4" />Training</Link>
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold text-gray-900">{a.pathTitle}</h1><StatusPill status={a.status} /></div>
      <p className="mt-1 text-sm text-gray-600">{a.user.name} · Buddy: {a.buddy.name} · {a.lessonsDone} of {a.lessonsTotal} lessons</p>
      {a.status === 'signed_off' && a.signedOffAt && <p className="mt-3 rounded-lg bg-emerald-100 p-3 text-sm text-emerald-800">Signed off by {a.signedOffByName} on {formatDay(a.signedOffAt)}.</p>}

      {STAGES.map((s) => {
        const here = a.items.filter((i) => i.stage === s.key);
        if (!here.length) return null;
        return (
          <section key={s.key} className="mt-5">
            <h2 className="mb-1.5 font-semibold text-gray-900">{s.label}</h2>
            <ul className="space-y-1">
              {here.map((i) => (
                <li key={i.lessonId} className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm">
                  {i.done ? <CheckCircle2 aria-label="Finished" className="h-4 w-4 shrink-0 text-emerald-600" /> : <Circle aria-label="Not finished" className="h-4 w-4 shrink-0 text-gray-400" />}
                  {i.available ? <Link href={`${lessonsBase}/${i.lessonId}`} className="text-gray-900 underline">{i.title}</Link> : <span className="text-gray-600">{i.title} (no longer in the library)</span>}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {a.openAttempt ? <Paper key={a.openAttempt.id} assignmentId={a.id} attempt={a.openAttempt} /> : a.can.startTest && (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-900">You&apos;ve finished every lesson. Pass mark {a.passMark}%.{left !== null ? ` Attempts left: ${left}.` : ''}</p>
          <button type="button" disabled={start.isPending} onClick={() => start.mutate(undefined, { onError: failed('The test could not be started.') })} className={`${primaryButton} mt-2`}>Start the test</button>
        </div>
      )}
      {toMark && <Marking key={toMark.id} assignmentId={a.id} attempt={toMark} />}
      {a.attempts.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold text-gray-900">Test results</h2>
          <ul className="space-y-2">{a.attempts.map((t) => <AttemptRow key={t.id} t={t} passMark={a.passMark} />)}</ul>
        </section>
      )}
      <Manager a={a} />
    </article>
  );
}
