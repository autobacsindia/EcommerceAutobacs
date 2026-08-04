'use client';

/**
 * Support inbox — the agent-facing list of every customer conversation,
 * whichever door it came through (email, contact form, product question,
 * review, return).
 *
 * Deliberately a list-only screen: opening a ticket navigates to
 * /admin/support/[id], which is where the thread and the customer context live.
 * Keeping the list light means the default view stays fast even once the
 * backlog is large.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import apiClient from '@/lib/api';
import {
  ADMIN_STATUS_LABELS,
  CHANNEL_ICONS,
  CHANNEL_LABELS,
  PRIORITY_LABELS,
  type TicketChannel,
  type TicketPriority,
  type TicketStatus,
} from '@/lib/supportConstants';

interface TicketRow {
  _id: string;
  reference: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  channel: TicketChannel;
  requester: { name?: string; email: string };
  assignee?: { _id: string; name: string } | null;
  lastMessageAt: string;
  messageCount: number;
  firstResponseDueAt?: string | null;
  firstRespondedAt?: string | null;
  preview?: string;
}

interface Counts {
  open: number;
  unassigned: number;
  breached: number;
  awaitingCustomer: number;
}

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'pending_customer', label: 'Awaiting customer' },
  { key: 'resolved', label: 'Resolved' },
  { key: '', label: 'All' },
] as const;

const STATUS_STYLES: Record<TicketStatus, string> = {
  new: 'bg-blue-100 text-blue-800',
  open: 'bg-amber-100 text-amber-800',
  pending_customer: 'bg-purple-100 text-purple-800',
  on_hold: 'bg-gray-200 text-gray-700',
  resolved: 'bg-green-100 text-green-800',
  closed: 'bg-gray-100 text-gray-600',
};

const PRIORITY_STYLES: Record<TicketPriority, string> = {
  low: 'text-gray-500',
  normal: 'text-gray-700',
  high: 'text-orange-600 font-semibold',
  urgent: 'text-red-600 font-bold',
};

/** Compact relative age — "3m", "2h", "4d". */
function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/** A ticket is late when its first-response deadline passed with no reply. */
function isBreached(t: TicketRow): boolean {
  if (t.firstRespondedAt || !t.firstResponseDueAt) return false;
  return new Date(t.firstResponseDueAt).getTime() < Date.now();
}

export default function AdminSupportPage() {
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [filter, setFilter] = useState<string>('open');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      // "unassigned" is an assignee filter, not a status — the backend treats
      // them as separate query dimensions.
      if (filter === 'unassigned') {
        params.set('assignee', 'unassigned');
        params.set('status', 'open');
      } else if (filter) {
        params.set('status', filter);
      }
      if (search.trim()) params.set('q', search.trim());
      params.set('page', String(page));

      const res = await apiClient.get<{
        data: TicketRow[];
        counts: Counts;
        pages: number;
      }>(`/support/admin/tickets?${params.toString()}`);

      setTickets(res.data || []);
      setCounts(res.counts || null);
      setPages(res.pages || 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [filter, search, page]);

  useEffect(() => { load(); }, [load]);

  // Reset to the first page whenever the filter or search changes, so a filter
  // applied while on page 4 does not land on an empty result set.
  useEffect(() => { setPage(1); }, [filter, search]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Support</h1>
          <p className="text-sm text-gray-500 mt-1">
            Every customer conversation, from every channel.
          </p>
        </div>
        <button
          onClick={load}
          className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {counts && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Open', value: counts.open, tone: 'text-gray-900' },
            { label: 'Unassigned', value: counts.unassigned, tone: counts.unassigned > 0 ? 'text-amber-600' : 'text-gray-900' },
            { label: 'SLA breached', value: counts.breached, tone: counts.breached > 0 ? 'text-red-600' : 'text-gray-900' },
            { label: 'Awaiting customer', value: counts.awaitingCustomer, tone: 'text-gray-900' },
          ].map((c) => (
            <div key={c.label} className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">{c.label}</p>
              <p className={`text-2xl font-bold mt-1 ${c.tone}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f.key || 'all'}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
              filter === f.key
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {f.label}
          </button>
        ))}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search subject, name or email…"
          className="ml-auto px-3 py-1.5 text-sm border border-gray-300 rounded-md w-full sm:w-72"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 mb-4 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <p className="p-8 text-center text-gray-500">Loading…</p>
        ) : tickets.length === 0 ? (
          <p className="p-8 text-center text-gray-500">
            Nothing here. {filter === 'open' ? 'The queue is clear.' : 'Try another filter.'}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {tickets.map((t) => {
              const breached = isBreached(t);
              return (
                <li key={t._id}>
                  <Link
                    href={`/admin/support/${t._id}`}
                    className="flex items-start gap-4 p-4 hover:bg-gray-50 transition-colors"
                  >
                    <span className="text-lg shrink-0" title={CHANNEL_LABELS[t.channel]}>
                      {CHANNEL_ICONS[t.channel]}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-gray-500">{t.reference}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_STYLES[t.status]}`}>
                          {ADMIN_STATUS_LABELS[t.status]}
                        </span>
                        {t.priority !== 'normal' && (
                          <span className={`text-xs ${PRIORITY_STYLES[t.priority]}`}>
                            {PRIORITY_LABELS[t.priority]}
                          </span>
                        )}
                        {breached && (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 font-semibold">
                            SLA breached
                          </span>
                        )}
                      </div>

                      <p className="font-medium text-gray-900 truncate mt-1">{t.subject}</p>
                      {t.preview && (
                        <p className="text-sm text-gray-500 truncate mt-0.5">{t.preview}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {t.requester.name || t.requester.email}
                        {t.messageCount > 1 && ` · ${t.messageCount} messages`}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-xs text-gray-400">{age(t.lastMessageAt)}</p>
                      <p className="text-xs text-gray-600 mt-1">
                        {t.assignee?.name || (
                          <span className="text-amber-600">Unassigned</span>
                        )}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-gray-600">Page {page} of {pages}</span>
          <button
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
