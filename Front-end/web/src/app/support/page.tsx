'use client';

/**
 * Customer-facing ticket list — "my support requests".
 *
 * Linked from the acknowledgement email, so the customer always has a way back
 * into a conversation without digging through their inbox. Read + reply only:
 * new tickets start at /contact.
 *
 * Only public messages are returned by the API (internal notes are filtered in
 * the query, not the serializer), so there is nothing here that could leak
 * agent-only context.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import apiClient from '@/lib/api';
import { formatDateTimeIST } from '@/lib/datetime';
import {
  STATUS_LABELS,
  SUPPORT_HOURS_LABEL,
  type TicketStatus,
} from '@/lib/supportConstants';

interface TicketSummary {
  reference: string;
  subject: string;
  status: TicketStatus;
  createdAt: string;
  lastMessageAt: string;
  messageCount: number;
}

interface ThreadMessage {
  direction: 'inbound' | 'outbound';
  author: { name?: string; isAgent?: boolean };
  bodyText: string;
  createdAt: string;
  attachmentCount: number;
}

const STATUS_STYLE: Record<TicketStatus, string> = {
  new: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  open: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  pending_customer: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
  on_hold: 'bg-gray-500/10 text-gray-300 border-gray-500/30',
  resolved: 'bg-green-500/10 text-green-300 border-green-500/30',
  closed: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
};

export default function SupportPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadTickets = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try {
      const res = await apiClient.get<{ data: TicketSummary[] }>('/support/tickets/mine');
      setTickets(res.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your requests');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  const openTicket = async (reference: string) => {
    if (openRef === reference) { setOpenRef(null); return; }
    setOpenRef(reference);
    setThread([]);
    setReply('');
    try {
      const res = await apiClient.get<{ data: { messages: ThreadMessage[] } }>(
        `/support/tickets/mine/${reference}`
      );
      setThread(res.data.messages || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load that request');
    }
  };

  const sendReply = async () => {
    if (!reply.trim() || !openRef || busy) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.post(`/support/tickets/mine/${openRef}/reply`, {
        message: reply.trim(),
      });
      setReply('');
      const res = await apiClient.get<{ data: { messages: ThreadMessage[] } }>(
        `/support/tickets/mine/${openRef}`
      );
      setThread(res.data.messages || []);
      await loadTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your reply');
    } finally {
      setBusy(false);
    }
  };

  if (authLoading || loading) {
    return <div className="min-h-screen bg-obsidian-deep" />;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-obsidian-deep flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-display font-light text-ink mb-3">Your support requests</h1>
          <p className="text-ink/70 font-display text-sm mb-6">
            Sign in to see your requests and replies.
          </p>
          <Link
            href="/login?redirect=/support"
            className="inline-block bg-gold hover:opacity-90 text-obsidian font-display font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-opacity"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-obsidian-deep">
      <section className="bg-obsidian border-b border-hairline">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center">
          <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Support</p>
          <h1 className="text-3xl font-display font-light text-ink tracking-[-0.01em] mb-3">
            Your requests
          </h1>
          <p className="text-ink/70 font-display text-sm">{SUPPORT_HOURS_LABEL}</p>
        </div>
      </section>

      <section className="py-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {error && (
            <p role="alert" className="text-red-400 font-display text-sm mb-4">{error}</p>
          )}

          {tickets.length === 0 ? (
            <div className="bg-obsidian border border-hairline rounded-sm p-8 text-center">
              <p className="text-ink/70 font-display mb-5">You haven&apos;t contacted us yet.</p>
              <Link
                href="/contact"
                className="inline-block bg-gold hover:opacity-90 text-obsidian font-display font-bold uppercase tracking-widest px-6 py-3 rounded-sm transition-opacity"
              >
                Contact support
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {tickets.map((t) => (
                <li key={t.reference} className="bg-obsidian border border-hairline rounded-sm overflow-hidden">
                  <button
                    onClick={() => openTicket(t.reference)}
                    className="w-full text-left p-5 hover:bg-obsidian-raised transition-colors"
                    aria-expanded={openRef === t.reference}
                  >
                    <div className="flex items-center gap-3 flex-wrap mb-1">
                      <span className="font-mono text-xs text-gold">{t.reference}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLE[t.status]}`}>
                        {STATUS_LABELS[t.status]}
                      </span>
                    </div>
                    <p className="text-ink font-display">{t.subject}</p>
                    <p className="text-ink-muted font-display text-xs mt-1">
                      Last update {formatDateTimeIST(t.lastMessageAt)}
                    </p>
                  </button>

                  {openRef === t.reference && (
                    <div className="border-t border-hairline p-5 space-y-4">
                      {thread.map((m, i) => (
                        <div
                          key={i}
                          className={`rounded-sm p-4 ${
                            m.author.isAgent
                              ? 'bg-obsidian-raised border border-hairline'
                              : 'bg-gold/5 border border-gold/20'
                          }`}
                        >
                          <p className="text-[10px] font-display uppercase tracking-widest text-ink-muted mb-2">
                            {m.author.isAgent ? (m.author.name || 'Autobacs Support') : 'You'}
                            {' · '}
                            {formatDateTimeIST(m.createdAt)}
                          </p>
                          <p className="text-ink/85 font-display text-sm whitespace-pre-wrap">
                            {m.bodyText}
                          </p>
                          {m.attachmentCount > 0 && (
                            <p className="text-ink-muted font-display text-xs mt-2">
                              📎 {m.attachmentCount} attachment{m.attachmentCount === 1 ? '' : 's'}
                            </p>
                          )}
                        </div>
                      ))}

                      {t.status !== 'closed' && (
                        <div>
                          <textarea
                            value={reply}
                            onChange={(e) => setReply(e.target.value)}
                            rows={4}
                            placeholder="Add a reply…"
                            className="w-full bg-obsidian-raised border border-hairline focus:border-gold rounded-sm px-4 py-3 text-ink font-display text-sm outline-none transition-colors"
                          />
                          <div className="flex justify-end mt-2">
                            <button
                              onClick={sendReply}
                              disabled={busy || !reply.trim()}
                              className="bg-gold hover:opacity-90 disabled:opacity-40 text-obsidian font-display font-bold uppercase tracking-widest text-xs px-5 py-2.5 rounded-sm transition-opacity"
                            >
                              {busy ? 'Sending…' : 'Send reply'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
