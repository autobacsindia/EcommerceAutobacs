'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Search, Eye, Users, RefreshCw, CheckCircle2, Phone, Mail, ShoppingBag, Plus, X,
} from 'lucide-react';
import apiClient from '@/lib/api';
import OfflineOrderForm from '@/components/admin/OfflineOrderForm';
import {
  Lead, LeadStatus, LeadSourceType, LEAD_STATUSES, LEAD_STATUS_LABELS, LEAD_STATUS_COLORS,
  LEAD_SOURCE_LABELS, LEAD_SOURCE_COLORS, customerBadge, SalesRep,
} from '@/lib/leads';

type Assignment = 'all' | 'unassigned';

interface LeadsResponse {
  success: boolean;
  leads: Lead[];
  pagination: { page: number; pages: number; total: number; hasNext: boolean; hasPrev: boolean };
}
interface StatsResponse {
  success: boolean;
  stats: {
    byStatus: Record<string, number>;
    unassigned: number;
    total: number;
    followUpDue: number;
  };
}

const SOURCE_OPTIONS: LeadSourceType[] = [
  'consultation', 'payment_pending', 'payment_failed', 'payment_cancelled', 'order_cancelled', 'cart_abandoned', 'dormant_user',
];

export default function AdminLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, hasNext: false, hasPrev: false });
  const [stats, setStats] = useState<StatsResponse['stats'] | null>(null);

  // filters
  const [assignment, setAssignment] = useState<Assignment>('unassigned');
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [source, setSource] = useState<LeadSourceType | ''>('');
  const [hasPurchased, setHasPurchased] = useState<'' | 'true' | 'false'>('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [followUpDue, setFollowUpDue] = useState(false);
  const [rep, setRep] = useState('');
  const [reopened, setReopened] = useState(false);
  const [neverContacted, setNeverContacted] = useState(false);
  const [sort, setSort] = useState<'newest' | 'oldest' | 'recent_contact' | 'follow_up'>('newest');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [reps, setReps] = useState<SalesRep[]>([]);

  function clearFilters() {
    setStatus(''); setSource(''); setHasPurchased('');
    setCreatedFrom(''); setCreatedTo(''); setFollowUpDue(false);
    setRep(''); setReopened(false); setNeverContacted(false);
    setSort('newest'); setSearch('');
  }

  // One-click "Returning customers" preset = existing customer + reopened cycle.
  const returningActive = hasPurchased === 'true' && reopened;
  function toggleReturning() {
    if (returningActive) { setHasPurchased(''); setReopened(false); }
    else { setHasPurchased('true'); setReopened(true); }
  }

  const [selected, setSelected] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkRep, setBulkRep] = useState('');
  // Standalone offline order (for a customer not in the pipeline — e.g. a Meta lead).
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [offlineDone, setOfflineDone] = useState<{ ref: string; link?: string | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('assignment', assignment);
      if (status) params.set('status', status);
      if (source) params.set('source', source);
      if (hasPurchased) params.set('hasPurchased', hasPurchased);
      if (createdFrom) params.set('createdFrom', createdFrom);
      if (createdTo) params.set('createdTo', createdTo);
      if (followUpDue) params.set('followUpDue', 'true');
      if (rep) params.set('rep', rep);
      if (reopened) params.set('reopened', 'true');
      if (neverContacted) params.set('neverContacted', 'true');
      params.set('sort', sort);
      if (search.trim()) params.set('search', search.trim());
      params.set('page', String(page));

      const res = await apiClient.get<LeadsResponse>(`/leads?${params.toString()}`);
      if (res.success) {
        setLeads(res.leads);
        setPagination(res.pagination);
        setSelected([]);
      }
    } catch (e) {
      console.error('[Leads] load failed', e);
    } finally {
      setLoading(false);
    }
  }, [assignment, status, source, hasPurchased, createdFrom, createdTo, followUpDue, rep, reopened, neverContacted, sort, search, page]);

  const loadStats = useCallback(async () => {
    try {
      const res = await apiClient.get<StatsResponse>('/leads/stats');
      if (res.success) setStats(res.stats);
    } catch (e) {
      console.error('[Leads] stats failed', e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadStats(); }, [loadStats]);

  useEffect(() => {
    apiClient.get<{ success: boolean; reps: SalesRep[] }>('/leads/reps')
      .then((r) => { if (r.success) setReps(r.reps); })
      .catch((e) => console.error('[Leads] reps failed', e));
  }, []);

  // Reset to page 1 whenever a filter changes.
  useEffect(() => { setPage(1); }, [assignment, status, source, hasPurchased, createdFrom, createdTo, followUpDue, rep, reopened, neverContacted, sort]);

  // Owner cell handler: set/clear the named rep on a lead.
  //  - unassigned → repId : atomic /claim (race-safe against a second grab)
  //  - reassign to a different rep : /assign
  //  - repId '' : /release back to the pool
  async function setOwner(lead: Lead, repId: string) {
    setBusyId(lead._id);
    try {
      if (!repId) {
        await apiClient.post(`/leads/${lead._id}/release`, {});
      } else if (!lead.assignedRep) {
        await apiClient.post(`/leads/${lead._id}/claim`, { repId });
      } else {
        await apiClient.post(`/leads/${lead._id}/assign`, { repId });
      }
      await load(); await loadStats();
    } catch {
      alert('Could not update owner — it may have just been claimed by another rep.');
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function bulkAssign() {
    if (selected.length === 0 || !bulkRep) return;
    try {
      await apiClient.post('/leads/bulk/claim', { leadIds: selected, repId: bulkRep });
      setBulkRep('');
      await load(); await loadStats();
    } catch (e) {
      console.error('[Leads] bulk assign failed', e);
    }
  }

  async function bulkStatus(next: LeadStatus) {
    if (selected.length === 0) return;
    if (!confirm(`Set ${selected.length} lead(s) to "${LEAD_STATUS_LABELS[next]}"?`)) return;
    try {
      await apiClient.post('/leads/bulk/status', { leadIds: selected, status: next });
      await load(); await loadStats();
    } catch (e) {
      console.error('[Leads] bulk status failed', e);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div className="space-y-6">
      {/* Header + counts */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sales Leads</h1>
          <p className="text-sm text-gray-500">
            {stats
              ? `${stats.unassigned} in pool · ${stats.total} total`
              : 'Loading pipeline…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setOfflineDone(null); setOfflineOpen(true); }}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            <Plus className="h-4 w-4" /> New offline order
          </button>
          <Link
            href="/admin/sales-reps"
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <Users className="h-4 w-4" /> Manage reps
          </Link>
          <button
            onClick={() => { load(); loadStats(); }}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {/* Standalone offline-order modal — for a customer not in the pipeline. */}
      {offlineOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="mt-8 mb-8 w-full max-w-2xl rounded-lg border border-gray-200 bg-white p-6 shadow-xl">
            <div className="mb-1 flex items-start justify-between">
              <h2 className="text-lg font-bold text-gray-900">New offline order</h2>
              <button onClick={() => setOfflineOpen(false)} className="text-gray-400 hover:text-gray-700" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <p className="mb-4 text-sm text-gray-500">
              For a customer who isn&apos;t in the leads pipeline (e.g. a Meta lead or walk-in). Creates their account and a paid order, and emails an invoice + a link to set their first password so they can log in and track it.
            </p>
            {offlineDone ? (
              <div className="rounded-lg bg-green-50 p-4 text-sm text-green-700">
                {offlineDone.link ? (
                  <p>Payment link sent for order <b>{offlineDone.ref}</b>. It becomes a confirmed order once the customer pays. <a href={offlineDone.link} target="_blank" rel="noreferrer" className="underline">Open link</a></p>
                ) : (
                  <p>Offline order <b>{offlineDone.ref}</b> created. The customer will get an invoice and a set-password link by email.</p>
                )}
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setOfflineDone(null)} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700">Create another</button>
                  <button onClick={() => { setOfflineOpen(false); setOfflineDone(null); }} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">Done</button>
                </div>
              </div>
            ) : (
              <OfflineOrderForm
                reps={reps}
                requireRep
                submitLabel="Create order"
                onCreated={(ref, paymentLink) => setOfflineDone({ ref, link: paymentLink?.shortUrl })}
                onCancel={() => setOfflineOpen(false)}
              />
            )}
          </div>
        </div>
      )}

      {/* Assignment tabs */}
      <div className="flex gap-2">
        {(['unassigned', 'all'] as Assignment[]).map((a) => (
          <button
            key={a}
            onClick={() => setAssignment(a)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
              assignment === a ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            {a === 'unassigned' && <Users className="h-4 w-4" />}
            {a === 'unassigned' ? 'Pool' : 'All'}
            {a === 'unassigned' && stats ? ` (${stats.unassigned})` : ''}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
            placeholder="Search name, email, phone…"
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <select value={source} onChange={(e) => setSource(e.target.value as LeadSourceType | '')} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">All sources</option>
          {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as LeadStatus | '')} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>)}
        </select>
        <select value={hasPurchased} onChange={(e) => setHasPurchased(e.target.value as '' | 'true' | 'false')} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Anyone</option>
          <option value="true">Existing customers</option>
          <option value="false">Never bought</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="recent_contact">Recently contacted</option>
          <option value="follow_up">Follow-up date</option>
        </select>
        {/* Manager slice by rep — forces the "All" tab so it isn't overridden. */}
        <select
          value={rep}
          onChange={(e) => { setRep(e.target.value); if (e.target.value) setAssignment('all'); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All reps</option>
          {reps.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
        </select>

        {/* Second row: date range + follow-up-due + clear */}
        <div className="flex w-full flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Created
            <input type="date" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
            <span className="text-gray-400">to</span>
            <input type="date" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={followUpDue} onChange={(e) => setFollowUpDue(e.target.checked)} />
            Follow-up due
            {stats && stats.followUpDue > 0 ? (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">{stats.followUpDue}</span>
            ) : null}
          </label>
          {/* Segment presets */}
          <div className="flex items-center gap-2">
            {([
              ['Returning', returningActive, toggleReturning] as const,
              ['Reopened', reopened, () => setReopened((v) => !v)] as const,
              ['Never contacted', neverContacted, () => setNeverContacted((v) => !v)] as const,
            ]).map(([label, active, onClick]) => (
              <button
                key={label}
                onClick={onClick}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button onClick={clearFilters} className="ml-auto rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            Clear filters
          </button>
        </div>
      </div>

      {/* Bulk bar */}
      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
          <span className="font-medium text-blue-900">{selected.length} selected</span>
          {/* Assign the selection to a rep (skips any already-claimed). */}
          <div className="flex items-center gap-1">
            <select value={bulkRep} onChange={(e) => setBulkRep(e.target.value)} className="rounded border border-gray-300 px-2 py-1 text-gray-700">
              <option value="">Assign to rep…</option>
              {reps.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
            </select>
            <button onClick={bulkAssign} disabled={!bulkRep} className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700 disabled:opacity-50">Assign</button>
          </div>
          <span className="text-blue-200">|</span>
          <button onClick={() => bulkStatus('contacted')} className="rounded bg-white px-3 py-1 text-gray-700 border border-gray-300 hover:bg-gray-50">Mark contacted</button>
          <button onClick={() => bulkStatus('qualified')} className="rounded bg-white px-3 py-1 text-gray-700 border border-gray-300 hover:bg-gray-50">Mark qualified</button>
          <button onClick={() => bulkStatus('lost')} className="rounded bg-white px-3 py-1 text-gray-700 border border-gray-300 hover:bg-gray-50">Mark lost</button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-4 py-3 w-8"></th>
              <th className="px-4 py-3">Lead</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
            ) : leads.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No leads match these filters.</td></tr>
            ) : (
              leads.map((lead) => (
                <tr key={lead._id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.includes(lead._id)} onChange={() => toggle(lead._id)} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{lead.name || 'Unknown'}</div>
                    <div className="flex flex-col gap-0.5 text-xs text-gray-500">
                      {lead.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{lead.email}</span>}
                      {lead.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{lead.phone}</span>}
                    </div>
                    {(() => {
                      const badge = customerBadge(lead);
                      return badge ? (
                        <span className={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${badge.className}`}>
                          <ShoppingBag className="h-3 w-3" /> {badge.label}
                        </span>
                      ) : null;
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    {lead.primarySource && (
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${LEAD_SOURCE_COLORS[lead.primarySource]}`}>
                        {LEAD_SOURCE_LABELS[lead.primarySource]}
                      </span>
                    )}
                    {lead.sources.length > 1 && <span className="ml-1 text-xs text-gray-400">+{lead.sources.length - 1}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${LEAD_STATUS_COLORS[lead.status]}`}>
                      {LEAD_STATUS_LABELS[lead.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {/* Owner = named rep. Pick to claim/reassign; blank to release. */}
                    <select
                      value={lead.assignedRep?._id || ''}
                      onChange={(e) => setOwner(lead, e.target.value)}
                      disabled={busyId === lead._id}
                      className={`rounded border px-2 py-1 text-xs disabled:opacity-50 ${
                        lead.assignedRep ? 'border-gray-300 text-gray-700' : 'border-dashed border-gray-300 text-gray-400'
                      }`}
                      title="Assign to a sales rep"
                    >
                      <option value="">— pool —</option>
                      {/* Keep a since-deactivated owner visible so it doesn't blank out. */}
                      {lead.assignedRep && !reps.some((r) => r._id === lead.assignedRep!._id) && (
                        <option value={lead.assignedRep._id}>{lead.assignedRep.name} (inactive)</option>
                      )}
                      {reps.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{new Date(lead.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link href={`/admin/leads/${lead._id}`} className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">
                        <Eye className="h-3 w-3" /> Open
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>{pagination.total} lead(s)</span>
        <div className="flex items-center gap-2">
          <button disabled={!pagination.hasPrev} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40">Previous</button>
          <span>Page {pagination.page} of {pagination.pages}</span>
          <button disabled={!pagination.hasNext} onClick={() => setPage((p) => p + 1)} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40">Next</button>
        </div>
      </div>

      <p className="flex items-center gap-1 text-xs text-gray-400">
        <CheckCircle2 className="h-3 w-3" /> Set a lead&apos;s owner from the dropdown. Names come from{' '}
        <Link href="/admin/sales-reps" className="underline">Sales Reps</Link>.
      </p>
    </div>
  );
}
