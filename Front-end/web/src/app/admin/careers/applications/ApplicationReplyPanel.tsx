'use client';

/*
 * Reply to an applicant from the careers inbox, and see every reply already sent.
 *
 * The server is the record: "Sent" is shown only when the backend says the
 * email provider accepted it; a failure shows the server's reason. Each draft
 * carries one idempotency key, so a double-click or a retried request sends ONE
 * email. A fresh key is minted only after a send settles (sent or failed), so a
 * request whose outcome is unknown (network drop) is retried under the SAME key
 * and the server dedupes it instead of mailing the applicant twice.
 */

import { useEffect, useRef, useState } from 'react';
import { Send, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

export interface ApplicationReply {
  _id?: string;
  key: string;
  subject: string;
  text: string;
  to?: string;
  sentByName?: string;
  status: 'sending' | 'sent' | 'failed';
  error?: string;
  createdAt: string;
  sentAt?: string | null;
}

interface ReplyResponse {
  success: boolean;
  outcome: 'sent' | 'duplicate' | 'failed';
  message?: string;
  reply?: ApplicationReply;
  replies?: ApplicationReply[];
}

export const SUBJECT_MAX = 200;
export const MESSAGE_MAX = 5000;

export function newReplyKey(): string {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export const defaultReplySubject = (roleTitle: string) =>
  `Your application for ${roleTitle} — ROAVION Automotive`;

const fmtWhen = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';

type Notice = { kind: 'ok' | 'err'; text: string } | null;

interface Props {
  applicationId: string;
  applicantEmail: string;
  roleTitle: string;
  initialReplies?: ApplicationReply[];
}

export default function ApplicationReplyPanel({ applicationId, applicantEmail, roleTitle, initialReplies = [] }: Props) {
  const [replies, setReplies] = useState<ApplicationReply[]>(initialReplies);
  const [subject, setSubject] = useState(() => defaultReplySubject(roleTitle));
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const keyRef = useRef<string>(newReplyKey());
  // A ref, not state: two clicks in the same tick both see the state as "not
  // sending", but the ref flips synchronously on the first.
  const inFlight = useRef(false);

  // A different application opened in the same drawer: start a clean draft.
  useEffect(() => {
    setReplies(initialReplies);
    setSubject(defaultReplySubject(roleTitle));
    setMessage('');
    setNotice(null);
    keyRef.current = newReplyKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  const canSend = subject.trim().length > 0 && message.trim().length > 0 && !sending;

  async function send() {
    if (inFlight.current || !canSend) return;
    if (!window.confirm(`Send this email to ${applicantEmail}?`)) return;
    inFlight.current = true;
    setSending(true);
    setNotice(null);
    try {
      const res = await apiClient.post<ReplyResponse>(
        API_ENDPOINTS.ADMIN_CAREERS_APPLICATION_REPLY(applicationId),
        { key: keyRef.current, subject: subject.trim(), message: message.trim() },
      );
      if (res.replies) setReplies(res.replies);
      if (res.success && res.reply?.status === 'sent') {
        setNotice({ kind: 'ok', text: `Sent to ${applicantEmail} at ${fmtWhen(res.reply.sentAt)}.` });
        setMessage('');
        keyRef.current = newReplyKey();
      } else if (res.reply?.status === 'sending') {
        // Same draft already in progress from another click/tab.
        setNotice({ kind: 'ok', text: 'This reply is already being sent. Check the list below in a moment.' });
      } else {
        setNotice({ kind: 'err', text: res.message || 'The email could not be sent.' });
      }
    } catch (err: unknown) {
      const e = err as { message?: string; status?: number; rawData?: ReplyResponse };
      const data = e?.rawData;
      if (data?.replies) setReplies(data.replies);
      // The server settled it as failed → this draft key is spent; a retry is a new send.
      if (data?.outcome === 'failed') keyRef.current = newReplyKey();
      const text = data?.message || e?.message || 'Could not reach the server.';
      setNotice({
        kind: 'err',
        text: e?.status
          ? `Not sent. ${text}`
          : `We could not confirm whether it was sent (${text}). Clicking Send again is safe — it will not send twice.`,
      });
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return (
    <div>
      <span className="text-gray-400 block text-xs mb-2">Reply to applicant</span>
      <div className="space-y-2">
        <p className="text-xs text-gray-500">
          To: <a href={`mailto:${applicantEmail}`} className="text-red-600 hover:underline">{applicantEmail}</a>
        </p>
        <input
          aria-label="Reply subject"
          value={subject}
          maxLength={SUBJECT_MAX}
          onChange={(e) => setSubject(e.target.value)}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-red-300"
          placeholder="Subject"
        />
        <textarea
          aria-label="Reply message"
          value={message}
          maxLength={MESSAGE_MAX}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-red-300"
          placeholder="Write your message to the applicant…"
        />
        <div className="flex items-center justify-between gap-3">
          <div role="status" aria-live="polite" className="text-sm min-h-[1.25rem]">
            {notice && (
              <span className={`inline-flex items-start gap-1 ${notice.kind === 'ok' ? 'text-green-700' : 'text-red-700'}`}>
                {notice.kind === 'ok' ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                {notice.text}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60 shrink-0"
          >
            <Send className="h-4 w-4" />
            {sending ? 'Sending…' : 'Send reply'}
          </button>
        </div>
      </div>

      {replies.length > 0 && (
        <div className="mt-4">
          <span className="text-gray-400 block text-xs mb-2">Replies sent ({replies.length})</span>
          <ul className="space-y-2">
            {[...replies].reverse().map((r) => (
              <li key={r._id || r.key} className="border border-gray-100 rounded-lg p-3 text-sm">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-medium text-gray-900 truncate">{r.subject}</span>
                  {r.status === 'sent' ? (
                    <span className="inline-flex items-center gap-1 text-xs text-green-700 shrink-0"><CheckCircle2 className="h-3.5 w-3.5" />Sent</span>
                  ) : r.status === 'failed' ? (
                    <span className="inline-flex items-center gap-1 text-xs text-red-700 shrink-0"><AlertCircle className="h-3.5 w-3.5" />Not sent</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-700 shrink-0"><Clock className="h-3.5 w-3.5" />Sending</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mb-1">
                  {r.sentByName || 'Admin'} · {fmtWhen(r.sentAt || r.createdAt)}
                </p>
                <p className="text-gray-700 whitespace-pre-wrap">{r.text}</p>
                {r.status === 'failed' && r.error && <p className="text-xs text-red-700 mt-1">{r.error}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
