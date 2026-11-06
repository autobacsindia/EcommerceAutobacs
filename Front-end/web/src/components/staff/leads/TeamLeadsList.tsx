'use client';

import { useState } from 'react';
import type { InfiniteData } from '@tanstack/react-query';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Hand, Loader2, Mail, Phone, UserRoundX, Clock } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage, rupees } from '@/components/staff/sales/types';
import { useListParams } from '@/lib/hooks/useListParams';
import { ListClear, ListSearch, ListSelect, listField } from '@/components/panel/ListControls';
import {
  LEAD_SOURCE_COLORS, LEAD_SOURCE_LABELS, LEAD_STATUS_COLORS, LEAD_STATUS_LABELS, scoreBadge,
  type LeadSourceType, type LeadStatus,
} from '@/lib/leads';

/** One row of the GTM leads sheet, as /staff/leads sends it (services/teamLeadService.js rowOf). */
export type TeamLead = {
  id: string;
  name: string;
  status: LeadStatus;
  score: number;
  source: LeadSourceType | null;
  detail: {
    total: number | null; itemCount: number | null; productName: string | null;
    makeModel: string | null; city: string | null; orderNumber: string | null;
  };
  hasPurchased: boolean;
  returning: boolean;
  createdAt: string;
  lastUpdateAt: string | null;
  followingUp: { repId: string; name: string; at: string | null; mine: boolean } | null;
  /** Followed up on, nothing logged for this many days (0 = fine). */
  quietDays: number;
  /** Only for the person following up, the GTM head and admin. */
  contact: { phone: string | null; email: string | null } | null;
};
type HistoryLine = { id: string; type: string; label: string; at: string; who: string | null; notes: string };
type You = { canFollowUp: boolean; canReassign: boolean; repId: string | null };
type Page = { leads: TeamLead[]; nextCursor: string | null; you: You };
type People = { people: { repId: string; name: string }[]; sellers?: { userId: string; name: string }[] };
type WriteResult = { success: boolean; outcome: string; message?: string; lead: TeamLead };

const VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'free', label: 'Free' },
  { value: 'mine', label: 'Mine' },
] as const;
const STATUSES = [
  { value: 'open', label: 'Open leads' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
  { value: 'all', label: 'Every status' },
];
const SORTS = [
  { value: 'score', label: 'Hottest first' },
  { value: 'newest', label: 'Newest first' },
  { value: 'updated', label: 'Recently active' },
];

/** "Payment failed · ₹18,400 · 2 items" — what the customer did, in one line. */
function whatTheyDid(l: TeamLead): string {
  const d = l.detail;
  const parts = [
    d.productName,
    d.makeModel,
    d.total != null ? rupees(d.total) : null,
    d.itemCount ? `${d.itemCount} item${d.itemCount === 1 ? '' : 's'}` : null,
    d.orderNumber,
    d.city,
  ].filter(Boolean);
  return parts.join(' · ');
}

/** Put the server's answer for one lead into every cached page that shows it. */
function patchRow(queryClient: ReturnType<typeof useQueryClient>, lead: TeamLead) {
  queryClient.setQueriesData<InfiniteData<Page>>({ queryKey: [...staffKeys.leads(), 'list'] }, (data) => data && ({
    ...data,
    pages: data.pages.map((p) => ({ ...p, leads: p.leads.map((r) => (r.id === lead.id ? lead : r)) })),
  }));
}

function LeadCard({ lead, you, sellers }: { lead: TeamLead; you: You; sellers: People['sellers'] }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [moveTo, setMoveTo] = useState('');

  const detail = useQuery({
    queryKey: staffKeys.leadOne(lead.id),
    queryFn: () => apiClient.get<{ lead: TeamLead & { history: HistoryLine[] } }>(`/staff/leads/${encodeURIComponent(lead.id)}`),
    enabled: open,
  });

  /*
    Never optimistic: the row changes only to what the server says. Losing a race
    (someone else clicked first) is a 409 that still carries the lead, so the card
    simply shows who has it — no error page.
  */
  const settle = (fallback: string) => (e: unknown) => {
    const body = (e as { rawData?: WriteResult })?.rawData;
    if (body?.lead) {
      patchRow(queryClient, body.lead);
      setNotice(body.message || '');
      setError('');
    } else setError(errorMessage(e, fallback));
    queryClient.invalidateQueries({ queryKey: staffKeys.leads() });
  };
  const done = (res: WriteResult) => {
    patchRow(queryClient, res.lead);
    setNotice('');
    setError('');
    queryClient.invalidateQueries({ queryKey: staffKeys.leads() });
  };

  const path = `/staff/leads/${encodeURIComponent(lead.id)}`;
  const follow = useMutation({
    mutationFn: () => apiClient.post<WriteResult>(`${path}/follow-up`, {}),
    onSuccess: done,
    onError: settle('Could not take this lead. Please try again.'),
  });
  const release = useMutation({
    mutationFn: () => apiClient.post<WriteResult>(`${path}/release`, {}),
    onSuccess: done,
    onError: settle('Could not give this lead back.'),
  });
  const reassign = useMutation({
    mutationFn: (userId: string) => apiClient.post<WriteResult>(`${path}/reassign`, { userId }),
    onSuccess: (res) => { setMoveTo(''); done(res); },
    onError: settle('Could not move this lead.'),
  });
  const busy = follow.isPending || release.isPending || reassign.isPending;

  const f = lead.followingUp;
  const closed = lead.status === 'won' || lead.status === 'lost';
  const badge = scoreBadge(lead.score);
  const contact = detail.data?.lead.contact ?? lead.contact;

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4" data-testid="lead-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold text-gray-900">{lead.name}</p>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.className}`} title="Lead score (higher = hotter)">{badge.label}</span>
            {lead.source && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEAD_SOURCE_COLORS[lead.source]}`}>{LEAD_SOURCE_LABELS[lead.source]}</span>}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEAD_STATUS_COLORS[lead.status]}`}>{LEAD_STATUS_LABELS[lead.status]}</span>
            {lead.hasPurchased && <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-800">Bought before</span>}
            {lead.returning && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-800">Came back</span>}
          </div>
          {whatTheyDid(lead) && <p className="mt-1 text-sm text-gray-600">{whatTheyDid(lead)}</p>}
          <p className="mt-0.5 text-xs text-gray-400">Lead since {formatDateTimeIST(lead.createdAt)}</p>
        </div>

        <div className="shrink-0 sm:text-right">
          {f ? (
            <div>
              <p className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium ${f.mine ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-800'}`}>
                <Hand className="h-4 w-4" aria-hidden />
                Following up: {f.mine ? 'You' : f.name}
              </p>
              {f.at && <p className="mt-0.5 text-xs text-gray-500">since {formatDateTimeIST(f.at)}</p>}
              {lead.quietDays > 0 && (
                <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  <Clock className="h-3 w-3" aria-hidden /> No update for {lead.quietDays} days
                </p>
              )}
            </div>
          ) : you.canFollowUp && !closed ? (
            <button type="button" disabled={busy} onClick={() => follow.mutate()}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 sm:w-auto">
              {follow.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hand className="h-4 w-4" />} Follow up
            </button>
          ) : (
            <p className="text-sm text-gray-500">{closed ? 'Closed' : 'Free — nobody yet'}</p>
          )}
        </div>
      </div>

      {notice && <p role="status" className="mt-3 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900">{notice}</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{error}</p>}

      {contact && (contact.phone || contact.email) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {contact.phone && (
            <a href={`tel:${contact.phone}`} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
              <Phone className="h-4 w-4 text-emerald-700" /> {contact.phone}
            </a>
          )}
          {contact.email && (
            <a href={`mailto:${contact.email}`} className="inline-flex min-w-0 items-center gap-1.5 break-all rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
              <Mail className="h-4 w-4 shrink-0 text-blue-700" /> {contact.email}
            </a>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-blue-700 hover:bg-blue-50">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />} History
        </button>
        {f && (f.mine || you.canReassign) && (
          <button type="button" disabled={busy}
            onClick={() => { if (window.confirm(f.mine ? 'Stop following up? The lead goes back to Free for anyone to take.' : `Take this lead off ${f.name}? It goes back to Free.`)) release.mutate(); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            <UserRoundX className="h-4 w-4" /> {f.mine ? 'Stop following up' : 'Make free'}
          </button>
        )}
        {you.canReassign && !closed && sellers && sellers.length > 0 && (
          <span className="inline-flex flex-wrap items-center gap-2">
            <select aria-label="Move this lead to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={listField}>
              <option value="">Move to…</option>
              {sellers.map((s) => <option key={s.userId} value={s.userId}>{s.name}</option>)}
            </select>
            <button type="button" disabled={busy || !moveTo} onClick={() => reassign.mutate(moveTo)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {reassign.isPending ? 'Moving…' : 'Move'}
            </button>
          </span>
        )}
      </div>

      {open && (
        <div className="mt-3 rounded-lg bg-gray-50 p-3">
          {detail.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
          {detail.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(detail.error, 'Could not load the history.')}</p>}
          {detail.data && (detail.data.lead.history.length === 0
            ? <p className="text-sm text-gray-500">Nothing logged yet.</p>
            : (
              <ol className="space-y-2">
                {detail.data.lead.history.map((h) => (
                  <li key={h.id} className="text-sm">
                    <span className="font-medium text-gray-900">{h.label}</span>
                    {h.who && <span className="text-gray-700"> · {h.who}</span>}
                    <span className="text-gray-500"> · {formatDateTimeIST(h.at)}</span>
                    {h.notes && <p className="text-gray-600">{h.notes}</p>}
                  </li>
                ))}
              </ol>
            ))}
        </div>
      )}
    </li>
  );
}

/**
 * The GTM leads sheet: every lead, who is following up on each, and a Follow up
 * button. The server decides who may take, give back or move a lead, and who sees
 * phone numbers; the view, search and filters live in the address. The page must
 * wrap this in <Suspense>.
 */
export default function TeamLeadsList() {
  const { values: v, set, clear } = useListParams({ view: 'all', rep: '', status: 'open', sort: 'score', q: '' });
  const view = v.rep ? 'person' : (VIEWS.some((x) => x.value === v.view) ? v.view : 'all');
  const params: Record<string, string> = {
    view,
    ...(v.rep ? { rep: v.rep } : {}),
    ...(v.status && v.status !== 'open' ? { status: v.status } : {}),
    ...(v.sort && v.sort !== 'score' ? { sort: v.sort } : {}),
    ...(v.q ? { q: v.q } : {}),
  };
  const filtered = !!(v.q || v.rep || (v.status && v.status !== 'open'));

  const q = useInfiniteQuery({
    queryKey: staffKeys.leadList(params),
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ ...params, ...(pageParam ? { cursor: pageParam } : {}) });
      return apiClient.get<Page>(`/staff/leads?${qs}`);
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    placeholderData: keepPreviousData,
    // Someone else may take a lead any minute — keep the sheet fresh.
    refetchInterval: 60_000,
  });
  const people = useQuery({
    queryKey: staffKeys.leadPeople(),
    queryFn: () => apiClient.get<People>('/staff/leads/people'),
    staleTime: 5 * 60_000,
  });
  const rows = q.data?.pages.flatMap((p) => p.leads) ?? [];
  const you = q.data?.pages[0]?.you ?? { canFollowUp: false, canReassign: false, repId: null };

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Which leads" className="flex flex-wrap gap-2">
        {VIEWS.map((tab) => (
          <button key={tab.value} type="button" role="tab" aria-selected={view === tab.value} onClick={() => set({ view: tab.value, rep: '' })}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${view === tab.value ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      <div role="search" aria-label="Search and filter leads" className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ListSearch value={v.q} onChange={(text) => set({ q: text.trim() })} label="Search leads" placeholder="Search name, phone or e-mail" />
          <ListSelect label="Person" value={v.rep} onChange={(x) => set({ rep: x, view: x ? 'person' : 'all' })} allLabel="Anyone"
            options={(people.data?.people ?? []).map((p) => ({ value: p.repId, label: p.name }))} />
          <ListSelect label="Status" value={v.status || 'open'} onChange={(x) => set({ status: x })} options={STATUSES} />
          <ListSelect label="Sort" value={v.sort || 'score'} onChange={(x) => set({ sort: x })} options={SORTS} />
        </div>
        {filtered && <div className="flex justify-end"><ListClear onClear={() => clear(['view', 'sort'])} /></div>}
      </div>

      {!you.canFollowUp && q.isSuccess && (
        <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">You can see every lead and who is following up. The GTM head and GTM leads take leads.</p>
      )}
      {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {q.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load leads.')}</p>}
      {q.isSuccess && rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          {filtered ? 'No leads match — try fewer words or clear the filters.'
            : view === 'mine' ? 'You are not following up on any lead yet. Pick one from All or Free.'
              : view === 'free' ? 'Every open lead has someone following up.' : 'No leads yet.'}
        </p>
      )}

      <ul className={`space-y-3 ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
        {rows.map((l) => <LeadCard key={l.id} lead={l} you={you} sellers={people.data?.sellers} />)}
      </ul>

      {q.hasNextPage && (
        <button type="button" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {q.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}
