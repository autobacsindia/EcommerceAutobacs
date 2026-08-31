'use client';

import { useState, useEffect, useCallback } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { Search, Eye, Package, Video, FileText, ExternalLink, X, Truck, ClipboardCheck, Store, Plus } from 'lucide-react';
import Link from 'next/link';
import { ReturnRequest, PaginatedReturnRequests, ReturnRefundPreview, Order, OrderItem, OfflineRefundMethod } from '@/lib/types';
import { formatDateIST, formatDateTimeIST } from '@/lib/datetime';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  courier_booked: 'bg-indigo-100 text-indigo-800',
  received: 'bg-purple-100 text-purple-800',
  refunded: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-800',
};

const label = (s: string) => s.replace(/_/g, ' ').toUpperCase();
const inr = (n?: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const userName = (u: ReturnRequest['user']) => (typeof u === 'object' ? u?.name || u?.email || '—' : '—');

// The three reasons the policy accepts. Mirrors config/returnPolicy.js RETURN_REASONS —
// the schema enum, which the offline path does NOT bypass.
const RETURN_REASONS: { value: string; label: string }[] = [
  { value: 'wrong_item', label: 'Wrong item shipped' },
  { value: 'transit_damage', label: 'Damaged in transit' },
  { value: 'manufacturing_defect', label: 'Manufacturing defect' },
];

const OFFLINE_METHODS: { value: OfflineRefundMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank transfer / NEFT' },
  { value: 'upi', label: 'UPI' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

export default function AdminReturnsPage() {
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [detail, setDetail] = useState<ReturnRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pagination, setPagination] = useState({ currentPage: 1, totalPages: 1, total: 0 });
  const [recording, setRecording] = useState(false);

  const fetchReturns = useCallback(async (page: number) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.append('status', statusFilter);
      params.append('page', String(page));
      params.append('limit', '20');
      const res = await apiClient.get<PaginatedReturnRequests>(`${API_ENDPOINTS.ADMIN_RETURNS}?${params}`);
      setReturns(res.requests || []);
      setPagination({ currentPage: res.pagination.currentPage || 1, totalPages: res.pagination.totalPages || 1, total: res.count || 0 });
    } catch (err) {
      console.error('Failed to fetch returns:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchReturns(1); }, [fetchReturns]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await apiClient.get<{ request: ReturnRequest }>(API_ENDPOINTS.ADMIN_RETURN_DETAIL(id));
      setDetail(res.request);
    } catch (err) {
      alert((err as Error).message || 'Failed to load request');
    } finally {
      setDetailLoading(false);
    }
  };

  const afterAction = async (id: string) => {
    await fetchReturns(pagination.currentPage);
    await openDetail(id);
  };

  const filtered = returns.filter((r) => {
    const q = searchTerm.toLowerCase();
    return !q || r.order._id.toLowerCase().includes(q) || (r.order.orderNumber || '').toLowerCase().includes(q) || userName(r.user).toLowerCase().includes(q);
  });

  return (
    <div className="p-8">
      <div className="flex justify-between items-start mb-8">
        <h1 className="text-3xl font-bold">Returns &amp; Refunds</h1>
        <button
          onClick={() => setRecording(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800"
        >
          <Plus className="h-4 w-4" /> Record offline return
        </button>
      </div>

      <div className="mb-6 flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input type="text" placeholder="Search order # or customer…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-lg" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border rounded-lg px-4 py-2">
          {['all', 'pending', 'approved', 'courier_booked', 'received', 'refunded', 'rejected', 'cancelled'].map((s) => (
            <option key={s} value={s}>{s === 'all' ? 'All Status' : label(s)}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              {['Order', 'Customer', 'Items', 'Value', 'Status', ''].map((h) => (
                <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={6} className="px-6 py-10 text-center text-gray-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-10 text-center text-gray-400">No return requests.</td></tr>
            ) : filtered.map((req) => (
              <tr key={req._id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <Link href={`/admin/orders/${req.order._id}`} className="text-sm text-blue-600 hover:underline flex items-center">
                    #{req.order.orderNumber || req.order._id.slice(-8).toUpperCase()}<ExternalLink className="h-3 w-3 ml-1" />
                  </Link>
                  <div className="text-xs text-gray-500 mt-1">{formatDateIST(req.createdAt)}</div>
                </td>
                <td className="px-6 py-4 text-sm text-gray-900">{userName(req.user)}</td>
                <td className="px-6 py-4 text-sm text-gray-500">{req.items.length} item(s)</td>
                <td className="px-6 py-4 text-sm font-medium text-gray-900">{inr(req.refund?.productValue)}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[req.status]}`}>{label(req.status)}</span>
                  {req.origin === 'admin_offline' && (
                    <span className="ml-2 inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700" title="Handled off-platform and recorded by an admin">
                      <Store className="h-3 w-3" /> OFFLINE
                    </span>
                  )}
                </td>
                <td className="px-6 py-4">
                  <button onClick={() => openDetail(req._id)} className="text-gray-600 hover:text-gray-900" title="View"><Eye className="h-5 w-5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination.totalPages > 1 && (
        <div className="mt-6 flex justify-between items-center">
          <div className="text-sm text-gray-700">Page {pagination.currentPage} of {pagination.totalPages}</div>
          <div className="flex gap-2">
            <button disabled={pagination.currentPage === 1} onClick={() => fetchReturns(pagination.currentPage - 1)} className="px-4 py-2 border rounded disabled:opacity-50">Previous</button>
            <button disabled={pagination.currentPage === pagination.totalPages} onClick={() => fetchReturns(pagination.currentPage + 1)} className="px-4 py-2 border rounded disabled:opacity-50">Next</button>
          </div>
        </div>
      )}

      {(detail || detailLoading) && (
        <DetailModal request={detail} loading={detailLoading} onClose={() => setDetail(null)} onActioned={afterAction} />
      )}

      {recording && (
        <OfflineReturnModal
          onClose={() => setRecording(false)}
          onCreated={async (id) => { setRecording(false); await fetchReturns(1); await openDetail(id); }}
        />
      )}
    </div>
  );
}

// ── Record a return handled off-platform ────────────────────────────────────
//
// Nothing here mirrors the customer flow's policy gates: there is no window check, no
// video upload, and no non-returnable warning, because a return that already happened
// at the counter cannot satisfy any of them. The server skips them too — what it still
// enforces is the money: the refund base is recomputed from the order, and one active
// return per (order, product) is a unique index.
function OfflineReturnModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Order[]>([]);
  const [searching, setSearching] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  // Keyed by the ORDER LINE, never by product id: two variants of one product are two
  // lines sharing a product id, and imported WooCommerce lines have no product id at all.
  const [picked, setPicked] = useState<Record<string, { quantity: number; reason: string }>>({});
  const [note, setNote] = useState('');
  const [markReturned, setMarkReturned] = useState(true);
  const [notifyCustomer, setNotifyCustomer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError('');
    try {
      const params = new URLSearchParams({ search: query.trim(), limit: '10' });
      const res = await apiClient.get<{ orders: Order[] }>(`${API_ENDPOINTS.ADMIN_ORDERS}?${params}`);
      setResults(res.orders || []);
      if (!res.orders?.length) setError('No orders matched that search.');
    } catch (e) {
      setError((e as Error).message || 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const chooseOrder = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      // The list projection omits line items, so load the full order for its lines.
      const res = await apiClient.get<{ order: Order }>(API_ENDPOINTS.ORDER_DETAIL(id));
      setOrder(res.order);
      setPicked({});
    } catch (e) {
      setError((e as Error).message || 'Could not load that order');
    } finally {
      setBusy(false);
    }
  };

  const toggleLine = (lineKey: string, maxQty: number) => {
    setPicked((prev) => {
      const next = { ...prev };
      if (next[lineKey]) delete next[lineKey];
      else next[lineKey] = { quantity: maxQty, reason: 'manufacturing_defect' };
      return next;
    });
  };

  /** Stable per-line key; falls back to position so a line without an _id still works. */
  const lineKeyOf = (item: OrderItem, idx: number) => item._id || `idx-${idx}`;

  const chosen = Object.entries(picked);
  const canSubmit = !busy && !!order && chosen.length > 0 && note.trim().length > 0;

  const submit = async () => {
    if (!order) return;
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.post<{ request: ReturnRequest }>(API_ENDPOINTS.RETURN_OFFLINE_CREATE, {
        orderId: order._id,
        // Send the line's own id (and variant) — product id alone cannot tell two
        // variants of the same product apart, and the server prices what it matches.
        items: chosen.map(([key, v]) => {
          const line = order.items.find((it, i) => lineKeyOf(it, i) === key);
          return {
            itemId: line?._id,
            productId: line?.product?._id,
            variantId: line?.variantId ?? undefined,
            quantity: v.quantity,
            reason: v.reason,
          };
        }),
        note: note.trim(),
        markReturned,
        notifyCustomer,
      });
      onCreated(res.request._id);
    } catch (e) {
      setError((e as Error).message || 'Could not record the return');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-2xl font-bold flex items-center gap-2"><Store className="h-6 w-6" /> Record an offline return</h2>
              <p className="text-sm text-gray-500 mt-1">
                For a return handled at the counter, over the phone, or by a sales rep. The 4-day window, unboxing
                video and inspection steps do not apply — your note is the record.
              </p>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700"><X className="h-6 w-6" /></button>
          </div>

          {!order ? (
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
                  placeholder="Order number, customer name, email or phone…"
                  className="flex-1 border rounded px-3 py-2 text-sm"
                />
                <button onClick={search} disabled={searching || !query.trim()} className="px-4 py-2 bg-gray-900 text-white rounded disabled:opacity-50">
                  {searching ? 'Searching…' : 'Search'}
                </button>
              </div>

              {results.length > 0 && (
                <div className="border rounded divide-y">
                  {results.map((o) => (
                    <button key={o._id} onClick={() => chooseOrder(o._id)} className="w-full text-left px-4 py-3 hover:bg-gray-50 flex justify-between items-center">
                      <span className="text-sm">
                        <span className="font-medium">#{o.orderNumber || o._id.slice(-8).toUpperCase()}</span>
                        <span className="text-gray-500"> · {formatDateIST(o.createdAt)} · {label(o.status)}</span>
                      </span>
                      <span className="text-sm font-medium">{inr(o.totalAmount)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex justify-between items-center text-sm">
                <span>
                  Order <span className="font-medium">#{order.orderNumber || order._id.slice(-8).toUpperCase()}</span>
                  <span className="text-gray-500"> · {label(order.status)} · paid {order.paymentStatus || '—'}</span>
                </span>
                <button onClick={() => { setOrder(null); setPicked({}); }} className="text-blue-600 hover:underline">Choose another order</button>
              </div>

              <div>
                <p className="font-semibold mb-2 text-sm">Items being returned</p>
                <div className="space-y-2">
                  {order.items.map((item, idx) => {
                    const key = lineKeyOf(item, idx);
                    const sel = picked[key];
                    // An imported WooCommerce line has no catalogue product, and
                    // ReturnRequest.items.product is required — so it cannot be recorded
                    // as a return at all. Disable it here rather than let the operator
                    // fill the form and collect a 422 on submit.
                    const returnable = !!item.product?._id;
                    return (
                      <div key={key} className={`border rounded p-3 ${sel ? 'border-gray-900' : ''} ${returnable ? '' : 'opacity-60'}`}>
                        <label className={`flex items-center gap-3 text-sm ${returnable ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                          <input type="checkbox" disabled={!returnable} checked={!!sel} onChange={() => toggleLine(key, item.quantity)} />
                          <span className="flex-1">
                            <span className="font-medium">{item.product?.name || item.name}</span>
                            <span className="text-gray-500"> · {item.quantity} × {inr(item.price)}</span>
                            {!returnable && (
                              <span className="block text-xs text-amber-700">
                                Imported line with no catalogue product — refund this from the order instead.
                              </span>
                            )}
                          </span>
                        </label>
                        {sel && (
                          <div className="flex gap-3 mt-3 pl-7 flex-wrap">
                            <label className="text-xs text-gray-600">Qty
                              <input
                                type="number" min={1} max={item.quantity} value={sel.quantity}
                                onChange={(e) => setPicked({ ...picked, [key]: { ...sel, quantity: Math.min(item.quantity, Math.max(1, Number(e.target.value) || 1)) } })}
                                className="block border rounded px-2 py-1 text-sm mt-1 w-24"
                              />
                            </label>
                            <label className="text-xs text-gray-600">Reason
                              <select
                                value={sel.reason}
                                onChange={(e) => setPicked({ ...picked, [key]: { ...sel, reason: e.target.value } })}
                                className="block border rounded px-2 py-1 text-sm mt-1"
                              >
                                {RETURN_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                              </select>
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <label className="block text-sm">
                What happened <span className="text-red-600">*</span>
                <textarea
                  value={note} onChange={(e) => setNote(e.target.value)} rows={3}
                  placeholder="e.g. Customer brought the wiper to the Vyttila counter on 28 Aug; visible defect confirmed by Rahul."
                  className="mt-1 w-full border rounded px-3 py-2 text-sm"
                />
              </label>

              <div className="space-y-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={markReturned} onChange={(e) => setMarkReturned(e.target.checked)} />
                  Goods are already back with us — mark returned and ready to refund
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={notifyCustomer} onChange={(e) => setNotifyCustomer(e.target.checked)} />
                  Email the customer an acknowledgement (off by default — they were served in person)
                </label>
              </div>

              <div className="flex gap-3 justify-end pt-2 border-t">
                <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
                <button onClick={submit} disabled={!canSubmit} className="px-4 py-2 bg-gray-900 text-white rounded disabled:opacity-50">
                  {busy ? 'Recording…' : 'Record return'}
                </button>
              </div>
            </div>
          )}

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Detail + actions modal ──────────────────────────────────────────────────
function DetailModal({ request, loading, onClose, onActioned }: {
  request: ReturnRequest | null; loading: boolean; onClose: () => void; onActioned: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [courier, setCourier] = useState({ provider: '', trackingNumber: '' });
  const [inspectionNotes, setInspectionNotes] = useState('');
  const [refund, setRefund] = useState({ shippingDeduction: '', restockingDeduction: '' });
  const [preview, setPreview] = useState<ReturnRefundPreview | null>(null);
  const [refundMethod, setRefundMethod] = useState<'original_payment' | 'offline'>('original_payment');
  const [offlinePay, setOfflinePay] = useState<{ method: OfflineRefundMethod; reference: string }>({ method: 'cash', reference: '' });
  const [offlineNote, setOfflineNote] = useState('');

  const call = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); if (request) onActioned(request._id); }
    catch (e) { alert((e as Error).message || 'Action failed'); }
    finally { setBusy(false); }
  };

  const loadPreview = useCallback(async (id: string) => {
    try {
      const res = await apiClient.get<{ preview: ReturnRefundPreview }>(API_ENDPOINTS.RETURN_REFUND_PREVIEW(id));
      setPreview(res.preview);
      // On a full-refund-only order (debit-card EMI) ANY deduction turns this into a
      // partial refund, which the issuer rejects — so the suggested restocking must not
      // be pre-filled. Left in, it would pre-block the screen with a figure the operator
      // never typed, on exactly the high-value orders where the 10% suggestion applies.
      setRefund((r) => ({
        ...r,
        shippingDeduction: res.preview.fullRefundOnly ? '' : r.shippingDeduction,
        restockingDeduction:
          !res.preview.fullRefundOnly && res.preview.suggestedRestocking
            ? String(res.preview.suggestedRestocking)
            : '',
      }));
    } catch { /* preview is best-effort */ }
  }, []);

  useEffect(() => {
    if (request && request.status === 'received' && request.inspection?.passed === true) loadPreview(request._id);
  }, [request, loadPreview]);

  // Seed the courier inputs from what was actually booked, so the correction form opens
  // showing the current values instead of making the operator retype an AWB from memory.
  useEffect(() => {
    setCourier({
      provider: request?.courier?.provider || '',
      trackingNumber: request?.courier?.trackingNumber || '',
    });
  }, [request?._id, request?.courier?.provider, request?.courier?.trackingNumber]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {loading || !request ? (
          <div className="p-10 text-center text-gray-400">Loading…</div>
        ) : (
          <div className="p-6">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold">Return #{request._id.slice(-8).toUpperCase()}</h2>
                <span className={`inline-block mt-2 px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[request.status]}`}>{label(request.status)}</span>
              </div>
              <button onClick={onClose} className="text-gray-500 hover:text-gray-700"><X className="h-6 w-6" /></button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Left: request info */}
              <div>
                <h3 className="font-semibold mb-3">Details</h3>
                <div className="space-y-2 text-sm">
                  <p><span className="text-gray-500">Customer:</span> {userName(request.user)}</p>
                  <p><span className="text-gray-500">Shipping borne by:</span> {request.shippingBorneBy || 'roavion'}</p>
                  <p><span className="text-gray-500">Problem:</span> {request.problemDescription || '—'}</p>
                  {/* Read the booked pickup back — this was captured and then never
                      displayed anywhere, which is how the step became a dead form. */}
                  {request.courier?.trackingNumber && (
                    <p className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-gray-400" />
                      <span>
                        <span className="text-gray-500">Pickup:</span> {request.courier.provider || 'Courier'}
                        {' · '}
                        <span className="font-mono">{request.courier.trackingNumber}</span>
                        {request.courier.bookedAt && <span className="text-gray-400"> · booked {formatDateIST(request.courier.bookedAt)}</span>}
                      </span>
                    </p>
                  )}
                  {request.rejectionReason && <p className="text-red-600">Rejected: {request.rejectionReason}</p>}
                </div>

                <h3 className="font-semibold mt-6 mb-3">Items</h3>
                <div className="space-y-3">
                  {request.items.map((item, idx) => (
                    <div key={idx} className="flex gap-3 border p-3 rounded">
                      <div className="w-14 h-14 bg-gray-100 rounded overflow-hidden flex-shrink-0 flex items-center justify-center">
                        {item.product.images?.[0]
                          ? <img src={item.product.images[0].url} alt={item.product.name} className="w-full h-full object-cover" />
                          : <Package className="h-6 w-6 text-gray-400" />}
                      </div>
                      <div className="text-sm">
                        <p className="font-medium">{item.product.name}</p>
                        <p className="text-gray-500">Qty: {item.quantity} · {inr(item.unitPrice)}</p>
                        <p className="text-red-600">{label(item.reason)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: evidence + refund breakdown */}
              <div>
                <h3 className="font-semibold mb-3">Evidence</h3>
                <div className="space-y-3 text-sm">
                  {/* A recorded offline return has no evidence BY DESIGN — there was no
                      upload step. Rendering the usual "No video / No proof" would read as
                      a missing requirement and invite someone to reject a valid return. */}
                  {request.origin === 'admin_offline' ? (
                    <p className="text-gray-500 flex items-center gap-2 border rounded p-3 bg-gray-50">
                      <Store className="h-4 w-4 flex-shrink-0" />
                      Handled offline — the unboxing video and proof of purchase do not apply. See the operator note below.
                    </p>
                  ) : (
                    <>
                      {request.video?.url
                        ? <a href={request.video.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-blue-600 hover:underline"><Video className="h-4 w-4" /> Unboxing video</a>
                        : <p className="text-gray-400 flex items-center gap-2"><Video className="h-4 w-4" /> No video</p>}
                      {request.proofOfPurchase?.url
                        ? <a href={request.proofOfPurchase.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-blue-600 hover:underline"><FileText className="h-4 w-4" /> Proof of purchase</a>
                        : <p className="text-gray-400 flex items-center gap-2"><FileText className="h-4 w-4" /> No proof</p>}
                    </>
                  )}
                  {request.images && request.images.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      {request.images.map((img, i) => (
                        <a key={i} href={img.url} target="_blank" rel="noopener noreferrer" className="block border rounded overflow-hidden h-20">
                          <img src={img.url} alt="Evidence" className="w-full h-full object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                {request.refund && request.status === 'refunded' && (
                  <div className="mt-6 border rounded p-3 text-sm bg-green-50">
                    <p className="font-semibold mb-2">Refund</p>
                    {/* Show the list value and the discount that was taken off it, so a
                        past refund can be explained without re-deriving it. */}
                    {(request.refund.discountShare ?? 0) > 0 && (
                      <>
                        <Line k="List value" v={inr(request.refund.listValue)} />
                        <Line k="Order discount" v={`−${inr(request.refund.discountShare)}`} />
                      </>
                    )}
                    <Line k="Customer paid" v={inr(request.refund.productValue)} />
                    <Line k="Shipping deducted" v={inr(request.refund.shippingDeduction)} />
                    <Line k="Restocking deducted" v={inr(request.refund.restockingDeduction)} />
                    <Line k="Refunded" v={inr(request.refund.finalAmount)} bold />
                    <Line k="Status" v={request.refund.status || ''} />
                    {request.refund.method === 'offline' && (
                      <>
                        <Line k="Paid by" v={OFFLINE_METHODS.find((m) => m.value === request.refund?.offlineMethod)?.label || 'Offline'} />
                        <Line k="Reference" v={request.refund.reference || '—'} />
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Actions per status */}
            <div className="mt-8 pt-4 border-t">
              {request.status === 'pending' && (
                <div className="space-y-3">
                  <div className="flex gap-3">
                    <button disabled={busy} onClick={() => call(() => apiClient.patch(API_ENDPOINTS.RETURN_REVIEW(request._id), { decision: 'approve' }))}
                      className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">Approve</button>
                    <input placeholder="Rejection reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="flex-1 border rounded px-3 py-2 text-sm" />
                    <button disabled={busy || !rejectReason.trim()} onClick={() => call(() => apiClient.patch(API_ENDPOINTS.RETURN_REVIEW(request._id), { decision: 'reject', rejectionReason: rejectReason.trim() }))}
                      className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50">Reject</button>
                  </div>
                </div>
              )}

              {/* Courier is a REQUIRED step — no "Mark received" shortcut here. We book
                  the pickup, so the AWB is the only handle for a claim if the goods go
                  missing between the customer and the warehouse. It stays editable while
                  in `courier_booked` so a wrong AWB — mandatory and already emailed to
                  the customer — can be corrected; the backend freezes it after that. */}
              {(request.status === 'approved' || request.status === 'courier_booked') && (
                <div className="space-y-2">
                  <div className="flex gap-3 items-center flex-wrap">
                    <Truck className="h-5 w-5 text-gray-500" />
                    <input required placeholder="Courier (e.g. Delhivery)" value={courier.provider} onChange={(e) => setCourier({ ...courier, provider: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                    <input required placeholder="Tracking / AWB" value={courier.trackingNumber} onChange={(e) => setCourier({ ...courier, trackingNumber: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                    <button
                      disabled={busy || !courier.provider.trim() || !courier.trackingNumber.trim()}
                      onClick={() => call(() => apiClient.patch(API_ENDPOINTS.RETURN_COURIER(request._id), {
                        provider: courier.provider.trim(),
                        trackingNumber: courier.trackingNumber.trim(),
                      }))}
                      className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {request.status === 'courier_booked' ? 'Correct courier details' : 'Book courier'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">
                    {request.status === 'courier_booked'
                      ? 'Correcting re-sends the pickup email with the new courier and AWB. The original booking time is kept.'
                      : 'Both fields are required — the customer is emailed the courier and AWB, and it is our claim reference if the pickup goes missing.'}
                  </p>
                </div>
              )}

              {request.status === 'courier_booked' && (
                <button disabled={busy} onClick={() => call(() => apiClient.patch(API_ENDPOINTS.RETURN_RECEIVED(request._id), {}))} className="mt-3 px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50">Mark received at warehouse</button>
              )}

              {request.status === 'received' && request.inspection?.passed !== true && (
                <div className="space-y-3">
                  <p className="font-semibold flex items-center gap-2"><ClipboardCheck className="h-5 w-5" /> Inspection</p>
                  <textarea placeholder="Inspection notes" value={inspectionNotes} onChange={(e) => setInspectionNotes(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" rows={2} />
                  <div className="flex gap-3">
                    <button disabled={busy} onClick={() => call(() => apiClient.patch(API_ENDPOINTS.RETURN_INSPECTION(request._id), { passed: true, notes: inspectionNotes }))} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">Pass</button>
                    <button disabled={busy || !inspectionNotes.trim()} onClick={() => call(() => apiClient.patch(API_ENDPOINTS.RETURN_INSPECTION(request._id), { passed: false, notes: inspectionNotes }))} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50">Fail (reject)</button>
                  </div>
                </div>
              )}

              {/* The offline escape hatch. Shown for anything still in flight, including a
                  `received` return whose inspection was never recorded. It hits a separate
                  endpoint from "Mark received at warehouse" on purpose: that one refuses to
                  skip the mandatory AWB, and this one is the audited exception to it. */}
              {!['refunded', 'rejected', 'cancelled'].includes(request.status)
                && !(request.status === 'received' && request.inspection?.passed === true) && (
                <div className="mt-4 pt-4 border-t space-y-2">
                  <p className="font-semibold flex items-center gap-2 text-sm"><Store className="h-4 w-4" /> Handled offline?</p>
                  <p className="text-xs text-gray-500">
                    Marks the goods received and the inspection passed in one step, skipping the courier and
                    warehouse checks. Use it when the customer returned the item in person.
                  </p>
                  <div className="flex gap-3 items-center flex-wrap">
                    <input
                      placeholder="What happened (required)"
                      value={offlineNote}
                      onChange={(e) => setOfflineNote(e.target.value)}
                      className="flex-1 min-w-[16rem] border rounded px-3 py-2 text-sm"
                    />
                    <button
                      disabled={busy || !offlineNote.trim()}
                      onClick={() => call(() => apiClient.patch(API_ENDPOINTS.RETURN_OFFLINE_RECEIVED(request._id), { note: offlineNote.trim() }))}
                      className="px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50"
                    >
                      Mark returned (offline)
                    </button>
                  </div>
                </div>
              )}

              {request.status === 'received' && request.inspection?.passed === true && (() => {
                // The base is what the customer PAID (list value minus their share of any
                // coupon/karma discount). Refunding the list value over-refunds every
                // discounted order and is rejected outright by Razorpay once the gap
                // exceeds the capture — the 2026-08-03 bug.
                const base = preview?.productValue ?? request.refund?.productValue ?? 0;
                const deductions = (Number(refund.shippingDeduction) || 0) + (Number(refund.restockingDeduction) || 0);
                const payout = base - deductions;
                const overHeadroom = preview != null && payout > preview.maxRefundable;
                const isOffline = refundMethod === 'offline';
                // Debit-card EMI: the issuer can only unwind the whole loan, so anything
                // short of the full capture is rejected at the gateway. Mirrors the
                // server-side 422 in returnController.partialRefundBlockReason. It does
                // NOT apply to money handed back by hand — that never reaches the issuer.
                const blockedPartialEmi =
                  !isOffline && preview != null && preview.fullRefundOnly && payout < preview.orderTotal;
                // Deductions are only locked out on the gateway path for the same reason.
                const lockDeductions = !isOffline && !!preview?.fullRefundOnly;
                const missingReference = isOffline && !offlinePay.reference.trim();

                return (
                  <div className="space-y-3">
                    <p className="font-semibold">{isOffline ? 'Record a refund paid outside the gateway' : 'Initiate refund to original payment'}</p>

                    {/* Two genuinely different actions behind one control: one SENDS money
                        through Razorpay, the other RECORDS money that already left. Both
                        draw on the same headroom, so recording cash here reduces what a
                        later gateway refund on this order is allowed to take. */}
                    <div className="flex gap-4 text-sm">
                      {([
                        ['original_payment', 'Refund via Razorpay'],
                        ['offline', 'Already paid offline'],
                      ] as const).map(([value, text]) => (
                        <label key={value} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="refund-method"
                            value={value}
                            checked={refundMethod === value}
                            onChange={() => setRefundMethod(value)}
                          />
                          {text}
                        </label>
                      ))}
                    </div>

                    <div className="text-sm text-gray-600 space-y-1">
                      <div>
                        Customer paid: <strong>{inr(base)}</strong>
                        {preview != null && preview.discountShare > 0 && (
                          <>
                            {' '}
                            <span className="line-through text-gray-400">{inr(preview.listValue)}</span>
                            <span className="ml-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                              −{inr(preview.discountShare)} {preview.couponCode ? `(${preview.couponCode})` : 'discount'}
                            </span>
                          </>
                        )}
                      </div>
                      {preview != null && preview.alreadyRefunded > 0 && (
                        <div className="text-xs text-gray-500">
                          {inr(preview.alreadyRefunded)} of {inr(preview.orderTotal)} already refunded on this order — {inr(preview.maxRefundable)} still refundable.
                        </div>
                      )}
                      {preview?.paidBy && (
                        <div className="text-xs text-gray-500">Paid via {preview.paidBy}.</div>
                      )}
                    </div>

                    {/* Debit-card EMI: the issuer can only unwind the whole loan, so any
                        deduction makes this a partial refund it will reject. Say so once,
                        next to the disabled inputs, instead of leaving the operator to
                        discover it by typing a number and hitting a wall. */}
                    {preview?.fullRefundOnly && !isOffline && (
                      <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                        <strong>Full refund only.</strong> This order was paid via {preview.paidBy || 'Debit Card EMI'},
                        and the bank can only cancel the whole EMI plan. Deductions are unavailable — refund the exact
                        captured amount, or pay the customer outside the gateway and record it with “Already paid offline”.
                      </div>
                    )}

                    {isOffline && (
                      <div className="flex gap-3 items-end flex-wrap">
                        <label className="text-sm">Paid by
                          <select
                            value={offlinePay.method}
                            onChange={(e) => setOfflinePay({ ...offlinePay, method: e.target.value as OfflineRefundMethod })}
                            className="block border rounded px-3 py-2 text-sm mt-1"
                          >
                            {OFFLINE_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                          </select>
                        </label>
                        <label className="text-sm flex-1 min-w-[14rem]">Reference <span className="text-red-600">*</span>
                          <input
                            value={offlinePay.reference}
                            onChange={(e) => setOfflinePay({ ...offlinePay, reference: e.target.value })}
                            placeholder="UTR / cheque no / receipt no"
                            className="block w-full border rounded px-3 py-2 text-sm mt-1"
                          />
                        </label>
                      </div>
                    )}

                    <div className="flex gap-3 items-end flex-wrap">
                      <label className={`text-sm ${lockDeductions ? 'opacity-50' : ''}`}>Shipping deduction (₹)
                        <input type="number" min="0" disabled={lockDeductions} value={refund.shippingDeduction} onChange={(e) => setRefund({ ...refund, shippingDeduction: e.target.value })} className="block border rounded px-3 py-2 text-sm mt-1 w-40 disabled:cursor-not-allowed disabled:bg-gray-100" />
                      </label>
                      <label className={`text-sm ${lockDeductions ? 'opacity-50' : ''}`}>Restocking deduction (₹)
                        <input type="number" min="0" disabled={lockDeductions} value={refund.restockingDeduction} onChange={(e) => setRefund({ ...refund, restockingDeduction: e.target.value })} className="block border rounded px-3 py-2 text-sm mt-1 w-40 disabled:cursor-not-allowed disabled:bg-gray-100" />
                      </label>
                      <button
                        disabled={busy || payout <= 0 || overHeadroom || blockedPartialEmi || missingReference}
                        onClick={() => call(() => apiClient.post(API_ENDPOINTS.RETURN_REFUND(request._id), {
                          shippingDeduction: Number(refund.shippingDeduction) || 0,
                          restockingDeduction: Number(refund.restockingDeduction) || 0,
                          ...(isOffline
                            ? { method: 'offline', offlineMethod: offlinePay.method, reference: offlinePay.reference.trim() }
                            : {}),
                        }))}
                        className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                      >
                        {isOffline ? `Record ${inr(payout)} refunded` : `Refund ${inr(payout)}`}
                      </button>
                    </div>

                    {/* Mirrors the server-side 422. Better to say so here than to let the
                        operator discover it as a gateway rejection. */}
                    {overHeadroom && (
                      <p className="text-xs text-red-600">
                        {inr(payout)} exceeds the {inr(preview!.maxRefundable)} still refundable on this order. Reduce the amount, or refund the balance manually in Razorpay.
                      </p>
                    )}
                    {missingReference && (
                      <p className="text-xs text-red-600">
                        A reference is required — with no gateway record, it is the only evidence the money moved.
                      </p>
                    )}
                    {blockedPartialEmi && (
                      <p className="text-xs text-red-600">
                        This order was paid by {preview!.paidBy || 'Debit Card EMI'}, which the bank can only
                        refund in full — a partial refund of {inr(payout)} will be rejected by Razorpay.
                        Either refund the full {inr(preview!.orderTotal)}, or settle this return outside the
                        gateway and record it manually.
                      </p>
                    )}
                    {payout <= 0 && <p className="text-xs text-red-600">Deductions leave nothing to refund.</p>}
                    {preview?.note && <p className="text-xs text-gray-500">{preview.note}</p>}
                  </div>
                );
              })()}
            </div>

            {/* Timeline */}
            {request.timeline?.length > 0 && (
              <div className="mt-8">
                <h3 className="font-semibold mb-3">Timeline</h3>
                <div className="space-y-3 border-l-2 border-gray-200 ml-2 pl-4">
                  {request.timeline.map((e, i) => (
                    <div key={i} className="relative">
                      <div className="absolute -left-[21px] top-1 h-3 w-3 rounded-full bg-gray-300" />
                      <p className="text-sm font-medium">{label(e.status)}</p>
                      <p className="text-xs text-gray-500">{formatDateTimeIST(e.timestamp)}</p>
                      {e.note && <p className="text-sm text-gray-600">{e.note}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Line({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}><span className="text-gray-500">{k}</span><span>{v}</span></div>;
}
