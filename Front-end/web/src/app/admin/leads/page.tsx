'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Search, Eye, UserPlus, Users, RefreshCw, CheckCircle2, Phone, Mail, ShoppingBag,
} from 'lucide-react';
import apiClient from '@/lib/api';
import {
  Lead, LeadStatus, LeadSourceType, LEAD_STATUSES, LEAD_STATUS_LABELS, LEAD_STATUS_COLORS,
  LEAD_SOURCE_LABELS, LEAD_SOURCE_COLORS,
} from '@/lib/leads';

type Assignment = 'all' | 'mine' | 'unassigned';

interface LeadsResponse {
  success: boolean;
  leads: Lead[];
  pagination: { page: number; pages: number; total: number; hasNext: boolean; hasPrev: boolean };
}
interface StatsResponse {
  success: boolean;
  stats: { byStatus: Record<string, number>; unassigned: number; mine: number; total: number };
}

const SOURCE_OPTIONS: LeadSourceType[] = [
  'consultation', 'payment_pending', 'payment_failed', 'cart_abandoned', 'dormant_user',
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
  const [sort, setSort] = useState<'newest' | 'oldest' | 'recent_contact' | 'follow_up'>('newest');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  function clearFilters() {
    setStatus(''); setSource(''); setHasPurchased('');
    setCreatedFrom(''); setCreatedTo(''); setFollowUpDue(false);
    setSort('newest'); setSearch('');
  }

  const [selected, setSelected] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

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
  }, [assignment, status, source, hasPurchased, createdFrom, createdTo, followUpDue, sort, search, page]);

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

  // Reset to page 1 whenever a filter changes.
  useEffect(() => { setPage(1); }, [assignment, status, source, hasPurchased, createdFrom, createdTo, followUpDue, sort]);

  async function claim(id: string) {
    setBusyId(id);
    try {
      const res = await apiClient.post<{ success: boolean }>(`/leads/${id}/claim`, {});
      if (res.success) { await load(); await loadStats(); }
    } catch {
      alert('Could not claim — it may have just been claimed by someone else.');
      await load();
    } finally {
      setBusyId(null);
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
              ? `${stats.unassigned} in pool · ${stats.mine} assigned to you · ${stats.total} total`
              : 'Loading pipeline…'}
          </p>
        </div>
        <button
          onClick={() => { load(); loadStats(); }}
          className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {/* Assignment tabs */}
      <div className="flex gap-2">
        {(['unassigned', 'mine', 'all'] as Assignment[]).map((a) => (
          <button
            key={a}
            onClick={() => setAssignment(a)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
              assignment === a ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            {a === 'unassigned' && <Users className="h-4 w-4" />}
            {a === 'mine' ? 'My queue' : a === 'unassigned' ? 'Pool' : 'All'}
            {a === 'unassigned' && stats ? ` (${stats.unassigned})` : ''}
            {a === 'mine' && stats ? ` (${stats.mine})` : ''}
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
          </label>
          <button onClick={clearFilters} className="ml-auto rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            Clear filters
          </button>
        </div>
      </div>

      {/* Bulk bar */}
      {selected.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
          <span className="font-medium text-blue-900">{selected.length} selected</span>
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
                    {lead.hasPurchased && (
                      <span className="mt-1 inline-flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-800">
                        <ShoppingBag className="h-3 w-3" /> Customer
                      </span>
                    )}
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
                  <td className="px-4 py-3 text-gray-600">
                    {lead.assignedTo ? (lead.assignedTo.name || lead.assignedTo.email) : <span className="text-gray-400">— pool —</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{new Date(lead.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {!lead.assignedTo && (
                        <button
                          onClick={() => claim(lead._id)}
                          disabled={busyId === lead._id}
                          className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          <UserPlus className="h-3 w-3" /> Claim
                        </button>
                      )}
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
        <CheckCircle2 className="h-3 w-3" /> Claiming is first-come; a lead you claim moves to your queue.
      </p>
    </div>
  );
}
