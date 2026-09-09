'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Search } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatDateIST } from '@/lib/datetime';

/**
 * Admin affiliate list.
 *
 * Cursor-paginated (never skip/offset — the house rule), so "next" carries the last
 * row's createdAt rather than a page number. Going back is handled by keeping the
 * stack of cursors we have seen, because a keyset cursor only walks forwards.
 */

interface Affiliate {
  _id: string;
  code?: string;
  name: string;
  email: string;
  status: 'pending' | 'active' | 'suspended' | 'rejected';
  commissionPercent: number;
  discountPercent: number | null;
  createdAt: string;
}

interface ListResponse {
  success: boolean;
  affiliates: Affiliate[];
  nextCursor: string | null;
}

const STATUS_STYLES: Record<Affiliate['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  active: 'bg-green-100 text-green-800',
  suspended: 'bg-red-100 text-red-800',
  rejected: 'bg-gray-100 text-gray-600',
};

const FILTERS = ['', 'pending', 'active', 'suspended', 'rejected'] as const;

export default function AdminAffiliatesPage() {
  const [rows, setRows] = useState<Affiliate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // Keyset cursors only walk forwards, so "previous" means replaying the trail.
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [staleCount, setStaleCount] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '25' });
      if (status) params.set('status', status);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (cursor) params.set('before', cursor);

      const res = await apiClient.get<ListResponse>(`${API_ENDPOINTS.AFFILIATES_ADMIN}?${params}`);
      setRows(res.affiliates || []);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load affiliates');
    } finally {
      setLoading(false);
    }
  }, [status, debouncedSearch, cursor]);

  useEffect(() => { load(); }, [load]);

  // A filter or search change invalidates the cursor trail — otherwise "previous"
  // would replay cursors from a different result set.
  useEffect(() => { setCursor(null); setCursorStack([]); }, [status, debouncedSearch]);

  /*
    Commissions that will never mature: the order was paid but never marked delivered.
    They stay pending forever, which is the correct fail-closed behaviour — we never pay
    for an undelivered order — but it is silent, so it needs somewhere to be seen.
  */
  useEffect(() => {
    apiClient
      .get<{ commissions: unknown[] }>(API_ENDPOINTS.AFFILIATE_ADMIN_STALE)
      .then((res) => setStaleCount(res.commissions?.length || 0))
      .catch(() => setStaleCount(0));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code, email or name"
            className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2"
            aria-label="Search affiliates"
          />
        </div>

        <div className="flex gap-1" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f || 'all'}
              onClick={() => setStatus(f)}
              className={`px-3 py-2 rounded-lg text-sm capitalize ${
                status === f ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {f || 'All'}
            </button>
          ))}
        </div>
      </div>

      {staleCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
          <span>
            <strong>{staleCount}</strong> commission{staleCount === 1 ? '' : 's'} paid but never
            marked delivered, so {staleCount === 1 ? 'it' : 'they'} will never become payable.
            That is an order-fulfilment gap, not an affiliate one — check those orders.
          </span>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Commission</th>
              <th className="px-4 py-3 font-medium text-right">Buyer discount</th>
              <th className="px-4 py-3 font-medium">Applied</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No affiliates yet.</td></tr>
            )}
            {!loading && rows.map((a) => (
              /*
                The NAME is the link, not the code.

                It used to be the code — which a pending application does not have yet, so
                the only way into an application was a two-pixel em-dash that reads as
                empty data. The rows you most need to open (the ones awaiting review) were
                effectively unclickable.
              */
              <tr key={a._id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-gray-600">{a.code || '—'}</td>
                <td className="px-4 py-3">
                  <Link href={`/admin/affiliates/${a._id}`} className="text-blue-600 hover:underline font-medium">
                    {a.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-gray-600">{a.email}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[a.status]}`}>
                    {a.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">{a.commissionPercent}%</td>
                <td className="px-4 py-3 text-right">{a.discountPercent == null ? '—' : `${a.discountPercent}%`}</td>
                <td className="px-4 py-3 text-gray-600">{formatDateIST(a.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between">
        <button
          onClick={() => {
            const stack = [...cursorStack];
            const previous = stack.pop() ?? null;
            setCursorStack(stack);
            setCursor(previous);
          }}
          disabled={cursorStack.length === 0}
          className="px-4 py-2 border border-gray-300 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Previous
        </button>
        <button
          onClick={() => {
            if (!nextCursor) return;
            setCursorStack((s) => [...s, cursor ?? '']);
            setCursor(nextCursor);
          }}
          disabled={!nextCursor}
          className="px-4 py-2 border border-gray-300 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
}
