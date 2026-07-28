'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { toast } from 'react-hot-toast';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { ChevronDown, ChevronRight, Bell, PackageX, ClipboardList } from 'lucide-react';
import Link from 'next/link';
import { LeadStatus, LEAD_STATUS_LABELS, LEAD_STATUS_COLORS } from '@/lib/leads';

type Status = 'pending' | 'notified' | 'cancelled';
// Which demand list: out-of-stock "Notify me" (restock) vs on-backorder waiting
// list (backorder). Mirrors StockNotificationRequest.kind on the backend.
type Kind = 'restock' | 'backorder';

interface RequestRow {
  product: { _id: string; name: string; slug: string | null; stock: string | null; image: string };
  variantId: string | null;
  variantLabel: string | null;
  variantStock: string | null;
  count: number;
  firstRequestedAt: string;
  lastRequestedAt: string;
}

interface ListResponse {
  success: boolean;
  items: RequestRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

interface Requester {
  _id: string;
  user?: { name?: string; email?: string } | null;
  email?: string;
  status: Status;
  createdAt: string;
  notifiedAt?: string | null;
  // Backorder waitlist only — the linked CRM lead, so the row can show/drive the
  // shared "contacted" status (null when no lead could be seeded).
  leadId?: string | null;
  leadStatus?: LeadStatus | null;
}

const STOCK_LABEL: Record<string, string> = { in: 'In stock', low: 'Low', out: 'Out of stock', backorder: 'Backorder' };
const rowKey = (r: RequestRow) => `${r.product._id}:${r.variantId ?? 'null'}`;

export default function AdminStockRequestsPage() {
  const [items, setItems] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<Kind>('restock');
  const [status, setStatus] = useState<Status>('pending');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Drill-down: which grouped row is expanded, and its (cached) requester list.
  const [expanded, setExpanded] = useState<string | null>(null);
  const [requesters, setRequesters] = useState<Record<string, Requester[]>>({});
  const [markingLead, setMarkingLead] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ kind, status, page: String(page), limit: '25' });
      const res = await apiClient.get<ListResponse>(`${API_ENDPOINTS.ADMIN_STOCK_REQUESTS}?${params.toString()}`);
      setItems(res.items || []);
      setPages(res.pagination?.pages || 1);
      setTotal(res.pagination?.total || 0);
    } catch (err) {
      console.error('Failed to fetch stock requests:', err);
    } finally {
      setLoading(false);
    }
  }, [kind, status, page]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // Switch list (restock ↔ backorder): reset to the pending tab, page 1, and drop
  // the drill-down cache in one batched update so the fetch fires exactly once.
  const selectKind = (k: Kind) => {
    if (k === kind) return;
    setKind(k);
    setStatus('pending');
    setPage(1);
    setExpanded(null);
    setRequesters({});
  };

  // Switch status tab: reset page + collapse drill-downs in one batched update so
  // the [status, page] fetch fires exactly once (not twice — stale page then page 1).
  // Also drop the requester cache: it's keyed by product only, so a product that
  // appears under more than one status would otherwise show the previous tab's
  // requesters when re-expanded here.
  const selectStatus = (s: Status) => {
    setStatus(s);
    setPage(1);
    setExpanded(null);
    setRequesters({});
  };

  const toggleRow = async (r: RequestRow) => {
    const key = rowKey(r);
    if (expanded === key) { setExpanded(null); return; }
    setExpanded(key);
    if (!requesters[key]) {
      try {
        const params = new URLSearchParams({ productId: r.product._id, kind, status });
        if (r.variantId) params.append('variantId', r.variantId);
        const res = await apiClient.get<{ success: boolean; requesters: Requester[] }>(
          `${API_ENDPOINTS.ADMIN_STOCK_REQUESTERS}?${params.toString()}`
        );
        setRequesters((prev) => ({ ...prev, [key]: res.requesters || [] }));
      } catch (err) {
        console.error('Failed to fetch requesters:', err);
        setRequesters((prev) => ({ ...prev, [key]: [] }));
      }
    }
  };

  // Mark a waitlist requester's linked lead as contacted. Writes through the CRM
  // (single source of truth) via the existing bulk-status endpoint, then reflects
  // the new status locally so the badge updates without a refetch. One-way: only
  // enabled while the lead is still 'new', mirroring the Leads screen action.
  //
  // Lead status is PER-PERSON, so the same lead can back several requester rows
  // (the person waiting on multiple products, across expanded groups). Patch every
  // cached row that shares this leadId so they don't disagree.
  const markContacted = async (requester: Requester) => {
    const leadId = requester.leadId;
    if (!leadId) return;
    setMarkingLead(requester._id);
    try {
      await apiClient.post('/leads/bulk/status', { leadIds: [leadId], status: 'contacted' });
      setRequesters((prev) => {
        const next: Record<string, Requester[]> = {};
        for (const [k, rows] of Object.entries(prev)) {
          next[k] = rows.map((r) => (r.leadId === leadId ? { ...r, leadStatus: 'contacted' } : r));
        }
        return next;
      });
      toast.success('Marked as contacted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the lead');
    } finally {
      setMarkingLead(null);
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-2">
        <Bell className="h-7 w-7 text-blue-600" />
        <h1 className="text-3xl font-bold">Stock Requests</h1>
      </div>
      <p className="text-gray-500 mb-6">
        {kind === 'restock'
          ? 'Customers waiting on out-of-stock items. The busiest items sit at the top — a live demand signal for restocking. Everyone here is emailed automatically the moment the item comes back.'
          : 'Customers who joined the waiting list for on-backorder items. A live demand signal — and each one is a warm lead in the CRM. Sales follows up manually (no automatic email); mark who you’ve reached below.'}
      </p>

      {/* Kind toggle: which demand list are we looking at */}
      <div className="mb-6 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
        {([
          ['restock', 'Out of stock', PackageX] as const,
          ['backorder', 'On backorder', ClipboardList] as const,
        ]).map(([k, label, Icon]) => (
          <button
            key={k}
            onClick={() => selectKind(k)}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              kind === k ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Status tabs */}
      <div className="flex gap-2 mb-6">
        {(['pending', 'notified', 'cancelled'] as Status[]).map((s) => (
          <button
            key={s}
            onClick={() => selectStatus(s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
              status === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s}
          </button>
        ))}
        {!loading && <span className="ml-auto self-center text-sm text-gray-500">{total} item{total === 1 ? '' : 's'}</span>}
      </div>

      {loading && items.length === 0 ? (
        <div className="py-12 text-center text-gray-500">Loading…</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 w-8"></th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Model / Variant</th>
                <th className="px-4 py-3">Current stock</th>
                <th className="px-4 py-3 text-right">Waiting</th>
                <th className="px-4 py-3">Last requested</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const key = rowKey(r);
                const isOpen = expanded === key;
                return (
                  <Fragment key={key}>
                    <tr className="border-t hover:bg-gray-50 cursor-pointer" onClick={() => toggleRow(r)}>
                      <td className="px-4 py-3 text-gray-400">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {r.product.image
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={r.product.image} alt="" className="h-10 w-10 rounded object-cover bg-gray-100" />
                            : <div className="h-10 w-10 rounded bg-gray-100" />}
                          <div>
                            <div className="font-medium">{r.product.name}</div>
                            {r.product.slug && (
                              <Link
                                href={`/products/${r.product.slug}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs text-blue-600 hover:underline"
                              >
                                View product ↗
                              </Link>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">{r.variantLabel || <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-3">
                        {(() => {
                          const s = r.variantStock ?? r.product.stock;
                          const isOut = s === 'out';
                          return (
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                              isOut ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                            }`}>
                              {s ? (STOCK_LABEL[s] ?? s) : '—'}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-block min-w-8 rounded-full bg-blue-50 px-2.5 py-0.5 font-semibold text-blue-700">
                          {r.count}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{new Date(r.lastRequestedAt).toLocaleDateString()}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50/60">
                        <td colSpan={6} className="px-4 py-3">
                          {!requesters[key] ? (
                            <div className="text-gray-500 text-xs py-2">Loading requesters…</div>
                          ) : requesters[key].length === 0 ? (
                            <div className="text-gray-500 text-xs py-2">No requesters.</div>
                          ) : (
                            <table className="w-full text-xs">
                              <thead className="text-gray-500">
                                <tr>
                                  <th className="text-left py-1 pr-4">Customer</th>
                                  <th className="text-left py-1 pr-4">Email</th>
                                  <th className="text-left py-1 pr-4">Requested</th>
                                  {status === 'notified' && <th className="text-left py-1 pr-4">Notified</th>}
                                  {kind === 'backorder' && <th className="text-left py-1">Lead status</th>}
                                </tr>
                              </thead>
                              <tbody>
                                {requesters[key].map((req) => (
                                  <tr key={req._id} className="border-t border-gray-200">
                                    <td className="py-1.5 pr-4">{req.user?.name || <span className="text-gray-400">Guest</span>}</td>
                                    <td className="py-1.5 pr-4">{req.user?.email || req.email || '—'}</td>
                                    <td className="py-1.5 pr-4 text-gray-600">{new Date(req.createdAt).toLocaleString()}</td>
                                    {status === 'notified' && (
                                      <td className="py-1.5 pr-4 text-gray-600">
                                        {req.notifiedAt ? new Date(req.notifiedAt).toLocaleString() : '—'}
                                      </td>
                                    )}
                                    {kind === 'backorder' && (
                                      <td className="py-1.5">
                                        {req.leadStatus ? (
                                          <div className="flex items-center gap-2">
                                            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${LEAD_STATUS_COLORS[req.leadStatus]}`}>
                                              {LEAD_STATUS_LABELS[req.leadStatus]}
                                            </span>
                                            {req.leadStatus === 'new' && (
                                              <button
                                                onClick={() => markContacted(req)}
                                                disabled={markingLead === req._id}
                                                className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                                title="Mark this person contacted (updates the CRM lead)"
                                              >
                                                {markingLead === req._id ? 'Saving…' : 'Mark contacted'}
                                              </button>
                                            )}
                                            {req.leadId && (
                                              <Link
                                                href={`/admin/leads/${req.leadId}`}
                                                className="text-blue-600 hover:underline"
                                              >
                                                View lead ↗
                                              </Link>
                                            )}
                                          </div>
                                        ) : (
                                          <span className="text-gray-400">No lead</span>
                                        )}
                                      </td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {items.length === 0 && !loading && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500">No {status} requests.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1 border rounded disabled:opacity-50">Prev</button>
          <span className="px-3 py-1">{page} / {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-3 py-1 border rounded disabled:opacity-50">Next</button>
        </div>
      )}
    </div>
  );
}
