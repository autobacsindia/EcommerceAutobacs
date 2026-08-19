'use client';

/*
  Lives outside the route file because a Next.js `page.tsx` may only export a
  default plus the framework's own fields — a named export there fails the build.
*/

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Search, Download, Flag } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { campaignKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST, formatIsoDateTimeIST } from '@/lib/datetime';

const inr = (n: number | null | undefined) => `₹${(n ?? 0).toLocaleString('en-IN')}`;
const field = 'w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-gold focus:outline-none';
const card = 'rounded-lg border border-zinc-800 bg-zinc-900/40 p-6';

/**
 * The roster — who is actually on the list, and where each person got to.
 *
 * This exists because the funnel counters ("191 invited") answer the wrong question.
 * The questions an operator actually has are "is this customer on the list?" and
 * "who has not claimed yet?", and before this panel the only way to answer either
 * was to open the export spreadsheet — which drifts from the database the moment
 * anyone re-imports.
 *
 * Reads only. Nothing here can change a member's status; claiming and redeeming are
 * consequences of a customer logging in and paying, never of an admin clicking.
 */
type MemberStatus = 'invited' | 'claimed' | 'redeemed';

interface Member {
  _id: string;
  email: string;
  name: string | null;
  status: MemberStatus;
  claimedAt: string | null;
  redeemedAt: string | null;
  discountRupees: number;
  reviewNote: string | null;
}

interface MembersPage {
  members: Member[];
  nextCursor: string | null;
  counts: { invited: number; claimed: number; redeemed: number; total: number } | null;
}

const STATUS_CHIP: Record<MemberStatus, string> = {
  invited: 'bg-zinc-500/15 text-zinc-300 ring-zinc-500/30',
  claimed: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  redeemed: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
};

/**
 * ONE source of truth for how a status is worded, used by the table chips, the filter
 * buttons and the CSV alike.
 *
 * The table used to print the raw database word ("claimed") while the filter button for
 * the very same rows said "Signed in", with the meaning hidden in a hover tooltip. Two
 * names for one thing, and the explanation unreachable on a phone — so the honest
 * question "what does claimed mean?" was unanswerable from the screen. `claimed` is
 * schema vocabulary; it should never have reached an operator.
 */
const STATUS_LABEL: Record<MemberStatus, string> = {
  invited: 'Not signed in',
  claimed: 'Signed in',
  redeemed: 'Used it',
};

const STATUS_HELP: Record<MemberStatus, string> = {
  invited: 'On the list — has not signed in yet',
  claimed: 'Signed in and saw the offer — has not bought yet',
  redeemed: 'Used the offer on an order',
};

const membersUrl = (
  campaignId: string,
  { status, q, cursor, limit = 50 }: { status?: string; q?: string; cursor?: string | null; limit?: number },
) => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  if (cursor) params.set('cursor', cursor);
  return `${API_ENDPOINTS.CAMPAIGN_MEMBERS(campaignId)}?${params.toString()}`;
};

export default function MemberRosterPanel({ campaignId }: { campaignId: string }) {
  /*
    `search` is the debounced value that drives the query; `searchInput` is what the
    operator is typing. Kept separate so a slow response can never overwrite an
    in-flight keystroke — the failure mode that made the admin orders box unusable.
  */
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | MemberStatus>('');
  // Accumulated cursors: index N is the cursor that opens page N. Page 0 has none.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [exporting, setExporting] = useState(false);

  /*
    Resetting the cursors in the SAME update that changes the filter, not in an effect
    that reacts to it. An effect runs after the render that already changed the filter,
    so for one render the new filter is paired with the old page's cursor — which fires
    a wasted request and briefly shows the middle of a list the operator just narrowed.
  */
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setCursors([null]);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const applyStatus = (next: '' | MemberStatus) => {
    setStatus(next);
    setCursors([null]);
  };

  const pages = useQuery({
    queryKey: campaignKeys.members(campaignId, { status, q: search, cursor: cursors[cursors.length - 1] }),
    queryFn: () => apiClient.get<MembersPage>(membersUrl(campaignId, { status, q: search, cursor: cursors[cursors.length - 1] })),
    placeholderData: (prev) => prev,   // keep the table on screen while the next page loads
  });

  // Every page fetched so far, in order. Held as separate queries (one per cursor) so
  // each stays individually cacheable rather than being refetched as one growing blob.
  const queryClient = useQueryClient();
  const rows: Member[] = cursors.flatMap((c) => {
    const cached = queryClient.getQueryData<MembersPage>(
      campaignKeys.members(campaignId, { status, q: search, cursor: c }),
    );
    return cached?.members ?? [];
  });

  const counts = queryClient.getQueryData<MembersPage>(
    campaignKeys.members(campaignId, { status, q: search, cursor: null }),
  )?.counts;

  const nextCursor = pages.data?.nextCursor ?? null;

  /**
   * Walk every page and hand back a CSV. Deliberately paginated rather than one
   * unbounded "give me everything" endpoint — the same bounded read the screen uses,
   * so a list that grows can never turn a download into a full-collection scan.
   */
  const downloadCsv = async () => {
    setExporting(true);
    try {
      const all: Member[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 500; guard += 1) {
        const page: MembersPage = await apiClient.get<MembersPage>(
          membersUrl(campaignId, { status, q: search, cursor, limit: 100 }),
        );
        all.push(...page.members);
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      const esc = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [
        ['Name', 'Email', 'Status', 'Signed in at', 'Used it at', 'Saved (₹)', 'Note'].join(','),
        ...all.map((m) => [
          esc(m.name), esc(m.email), esc(STATUS_LABEL[m.status]),
          esc(m.claimedAt ? formatIsoDateTimeIST(m.claimedAt) : ''),
          esc(m.redeemedAt ? formatIsoDateTimeIST(m.redeemedAt) : ''),
          esc(m.discountRupees || 0), esc(m.reviewNote),
        ].join(',')),
      ].join('\n');

      // ﻿ so Excel opens UTF-8 names correctly instead of mangling them.
      const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `campaign-members-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={`${card} mb-6`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          <Users size={14} /> The list
          {counts && <span className="text-zinc-500">· {counts.total} people</span>}
        </h2>
        <button
          onClick={downloadCsv}
          disabled={exporting}
          className="flex items-center gap-1.5 rounded bg-zinc-800 px-3 py-1.5 text-xs text-white hover:bg-zinc-700 disabled:opacity-40"
        >
          <Download size={13} /> {exporting ? 'Preparing…' : 'Download CSV'}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            className={`${field} pl-9`}
            placeholder="Search by name or email…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        {([['', 'All'], ...(Object.keys(STATUS_LABEL) as MemberStatus[]).map((k) => [k, STATUS_LABEL[k]])] as [
          '' | MemberStatus, string,
        ][]).map(
          ([v, label]) => (
            <button
              key={v}
              onClick={() => applyStatus(v as '' | MemberStatus)}
              className={`rounded px-3 py-1.5 text-xs font-medium transition ${
                status === v ? 'bg-gold text-black' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              {label}
              {counts && v !== '' && <span className="ml-1.5 opacity-60">{counts[v as MemberStatus]}</span>}
            </button>
          ),
        )}
      </div>

      {pages.isError && (
        <p className="text-sm text-red-400">Could not load the list: {(pages.error as Error).message}</p>
      )}

      {pages.isLoading && rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded border border-zinc-800 bg-zinc-900/40 py-8 text-center text-sm text-zinc-400">
          {search || status ? 'Nobody matches that.' : 'Nobody has been imported yet — use the box below.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Email</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 pr-4 font-medium">Signed in on</th>
                <th className="pb-2 font-medium text-right">Saved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {rows.map((m) => (
                <tr key={m._id} className="text-zinc-300">
                  <td className="py-2 pr-4">
                    {m.name || <span className="text-zinc-600">—</span>}
                    {/*
                      The note is printed, not hidden behind a hover tooltip. It was a
                      bare ⚑ with a `title`, which meant the one thing an operator has
                      to act on before posting a card was invisible on a phone, absent
                      from the keyboard path, and unreadable without knowing to hover.
                      42 of the 191 rows carry one; if you have to ask what the icon
                      means, the icon is the wrong control.
                    */}
                    {m.reviewNote && (
                      <span className="mt-0.5 flex items-start gap-1 text-xs text-amber-400/90">
                        <Flag size={11} className="mt-0.5 shrink-0" />
                        <span>{m.reviewNote}</span>
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-zinc-400">{m.email}</td>
                  <td className="py-2 pr-4">
                    <span
                      title={STATUS_HELP[m.status]}
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STATUS_CHIP[m.status]}`}
                    >
                      {STATUS_LABEL[m.status]}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-xs text-zinc-500">
                    {m.claimedAt ? formatDateTimeIST(m.claimedAt) : '—'}
                  </td>
                  <td className="py-2 text-right text-xs">
                    {m.discountRupees > 0
                      ? <span className="text-emerald-400">{inr(m.discountRupees)}</span>
                      : <span className="text-zinc-600">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor && (
        <button
          onClick={() => setCursors((c) => [...c, nextCursor])}
          disabled={pages.isFetching}
          className="mt-4 w-full rounded border border-zinc-800 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
        >
          {pages.isFetching ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}
