'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlarmClock, CalendarClock, HelpCircle, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage } from '@/components/staff/sales/types';
import NextFollowUpPicker from './NextFollowUpPicker';
import type { FollowUpWrite } from './FollowUpRecorder';
import { lateBy, type MetaLead } from './metaLeadTypes';

type Write = FollowUpWrite<MetaLead>;
const REASON_MIN = 5;
const box = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';
const primary = 'inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50';
const plain = 'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50';

/** When the next follow-up is due: grey, amber in the last 10 minutes, red once late. */
export function DeadlineChip({ lead }: { lead: MetaLead }) {
  const d = lead.nextFollowUp;
  if (!d) return null;
  const tone = d.overdue ? 'bg-red-100 text-red-800' : d.dueSoon ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-700';
  return (
    <p className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tone}`} data-testid="deadline-chip">
      <AlarmClock className="h-3 w-3" aria-hidden />
      {d.overdue ? `Overdue by ${lateBy(d.overdueMinutes)}` : `Next follow-up ${formatDateTimeIST(d.at)}`}
    </p>
  );
}

/** Move the next follow-up: a new time and a reason, both required (moves are counted). */
export function MoveDeadline({ lead, path, onSaved, onError, onClose }: {
  lead: MetaLead; path: string; onSaved: (res: Write) => void; onError: (e: unknown) => void; onClose: () => void;
}) {
  const [nextAt, setNextAt] = useState('');
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => apiClient.post<Write>(`${path}/next-follow-up`, { nextAt, reason: reason.trim() }),
    onSuccess: (res) => { onSaved(res); onClose(); },
    onError,
  });
  const late = !!lead.nextFollowUp?.lateReasonNeeded;
  const id = `move-${lead.id}`;
  return (
    <form className="mt-3 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3"
      onSubmit={(e) => { e.preventDefault(); if (nextAt && reason.trim().length >= REASON_MIN) save.mutate(); }}>
      <NextFollowUpPicker id={`${id}-at`} value={nextAt} onChange={setNextAt} label="Move the next follow-up to" />
      <div>
        <label htmlFor={`${id}-why`} className="block text-sm font-medium text-gray-800">
          {late ? 'Why is it late, and why move it? (required)' : 'Why move it? (required)'}
        </label>
        <textarea id={`${id}-why`} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Customer asked us to call on Friday" className={`mt-1 ${box}`} />
        <p className="text-xs text-gray-500">Every move is saved and counted in the team activity.</p>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={!nextAt || reason.trim().length < REASON_MIN || save.isPending} className={primary}>
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Move
        </button>
        <button type="button" onClick={onClose} className={plain}>Cancel</button>
      </div>
    </form>
  );
}

/** "Explain this lead": the question, the answer, and the box to answer or ask. */
export function ExplanationBox({ lead, path, canAsk, onSaved, onError }: {
  lead: MetaLead; path: string; canAsk: boolean; onSaved: (res: Write) => void; onError: (e: unknown) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState('');
  const e = lead.explanation;
  const ask = useMutation({
    mutationFn: () => apiClient.post<Write>(`${path}/explanation`, { question: text.trim() }),
    onSuccess: (res) => { setText(''); setAsking(false); onSaved(res); },
    onError,
  });
  const answer = useMutation({
    mutationFn: () => apiClient.post<Write>(`${path}/explanation/answer`, { answer: text.trim() }),
    onSuccess: (res) => { setText(''); onSaved(res); },
    onError,
  });
  const mayAsk = canAsk && !!lead.followingUp && !lead.followingUp.mine && !e?.open;
  const ready = text.trim().length >= REASON_MIN;

  return (
    <div className="mt-3 space-y-2">
      {e && (
        <div className={`rounded-lg p-2.5 text-sm ${e.open ? 'bg-amber-50 text-amber-950' : 'bg-gray-50 text-gray-800'}`}>
          <p className="flex items-start gap-1.5">
            <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span><span className="font-semibold">{e.askedBy} asked</span> ({formatDateTimeIST(e.askedAt)}): {e.question}</span>
          </p>
          {e.answeredAt && <p className="mt-1 pl-5"><span className="font-semibold">Answer</span> ({formatDateTimeIST(e.answeredAt)}): {e.answer}</p>}
          {e.open && !e.canAnswer && <p className="mt-1 pl-5 text-xs">Waiting for {lead.followingUp?.name ?? 'the person following up'} to answer.</p>}
          {e.canAnswer && (
            <form className="mt-2 space-y-2 pl-5" onSubmit={(ev) => { ev.preventDefault(); if (ready) answer.mutate(); }}>
              <label htmlFor={`answer-${lead.id}`} className="block text-sm font-medium">Your explanation (required)</label>
              <textarea id={`answer-${lead.id}`} rows={2} maxLength={500} value={text} onChange={(ev) => setText(ev.target.value)} className={box} />
              <button type="submit" disabled={!ready || answer.isPending} className={primary}>
                {answer.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Send explanation
              </button>
            </form>
          )}
        </div>
      )}
      {mayAsk && !asking && (
        <button type="button" onClick={() => setAsking(true)} className={`inline-flex items-center gap-1.5 ${plain}`}>
          <HelpCircle className="h-4 w-4" aria-hidden /> Ask for explanation
        </button>
      )}
      {mayAsk && asking && (
        <form className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3" onSubmit={(ev) => { ev.preventDefault(); if (ready) ask.mutate(); }}>
          <label htmlFor={`ask-${lead.id}`} className="block text-sm font-medium text-gray-800">Your question to {lead.followingUp?.name}</label>
          <textarea id={`ask-${lead.id}`} rows={2} maxLength={500} value={text} onChange={(ev) => setText(ev.target.value)}
            placeholder="e.g. Why was this not followed up yesterday?" className={box} />
          <div className="flex gap-2">
            <button type="submit" disabled={!ready || ask.isPending} className={primary}>
              {ask.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Ask
            </button>
            <button type="button" onClick={() => { setAsking(false); setText(''); }} className={plain}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

export const MoveIcon = CalendarClock;
