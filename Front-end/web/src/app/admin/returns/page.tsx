'use client';

import { useState, useEffect, useCallback } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { Search, Eye, Package, Video, FileText, ExternalLink, X, Truck, ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { ReturnRequest, PaginatedReturnRequests } from '@/lib/types';

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

export default function AdminReturnsPage() {
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [detail, setDetail] = useState<ReturnRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pagination, setPagination] = useState({ currentPage: 1, totalPages: 1, total: 0 });

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
      <h1 className="text-3xl font-bold mb-8">Returns &amp; Refunds</h1>

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
                  <div className="text-xs text-gray-500 mt-1">{new Date(req.createdAt).toLocaleDateString()}</div>
                </td>
                <td className="px-6 py-4 text-sm text-gray-900">{userName(req.user)}</td>
                <td className="px-6 py-4 text-sm text-gray-500">{req.items.length} item(s)</td>
                <td className="px-6 py-4 text-sm font-medium text-gray-900">{inr(req.refund?.productValue)}</td>
                <td className="px-6 py-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[req.status]}`}>{label(req.status)}</span></td>
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
  const [preview, setPreview] = useState<{ productValue: number; suggestedRestocking: number; note: string } | null>(null);

  const call = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); if (request) onActioned(request._id); }
    catch (e) { alert((e as Error).message || 'Action failed'); }
    finally { setBusy(false); }
  };

  const loadPreview = useCallback(async (id: string) => {
    try {
      const res = await apiClient.get<{ preview: { productValue: number; suggestedRestocking: number; note: string } }>(API_ENDPOINTS.RETURN_REFUND_PREVIEW(id));
      setPreview(res.preview);
      setRefund((r) => ({ ...r, restockingDeduction: res.preview.suggestedRestocking ? String(res.preview.suggestedRestocking) : '' }));
    } catch { /* preview is best-effort */ }
  }, []);

  useEffect(() => {
    if (request && request.status === 'received' && request.inspection?.passed === true) loadPreview(request._id);
  }, [request, loadPreview]);

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
                  {request.video?.url
                    ? <a href={request.video.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-blue-600 hover:underline"><Video className="h-4 w-4" /> Unboxing video</a>
                    : <p className="text-gray-400 flex items-center gap-2"><Video className="h-4 w-4" /> No video</p>}
                  {request.proofOfPurchase?.url
                    ? <a href={request.proofOfPurchase.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-blue-600 hover:underline"><FileText className="h-4 w-4" /> Proof of purchase</a>
                    : <p className="text-gray-400 flex items-center gap-2"><FileText className="h-4 w-4" /> No proof</p>}
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
                    <Line k="Product value" v={inr(request.refund.productValue)} />
                    <Line k="Shipping deducted" v={inr(request.refund.shippingDeduction)} />
                    <Line k="Restocking deducted" v={inr(request.refund.restockingDeduction)} />
                    <Line k="Refunded" v={inr(request.refund.finalAmount)} bold />
                    <Line k="Status" v={request.refund.status || ''} />
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

              {request.status === 'approved' && (
                <div className="flex gap-3 items-center flex-wrap">
                  <Truck className="h-5 w-5 text-gray-500" />
                  <input placeholder="Courier (e.g. Delhivery)" value={courier.provider} onChange={(e) => setCourier({ ...courier, provider: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                  <input placeholder="Tracking / AWB" value={courier.trackingNumber} onChange={(e) => setCourier({ ...courier, trackingNumber: e.target.value })} className="border rounded px-3 py-2 text-sm" />
                  <button disabled={busy} onClick={() => call(() => apiClient.patch(API_ENDPOINTS.RETURN_COURIER(request._id), courier))} className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">Book courier</button>
                  <button disabled={busy} onClick={() => call(() => apiClient.patch(API_ENDPOINTS.RETURN_RECEIVED(request._id), {}))} className="px-4 py-2 border rounded hover:bg-gray-50">Mark received</button>
                </div>
              )}

              {request.status === 'courier_booked' && (
                <button disabled={busy} onClick={() => call(() => apiClient.patch(API_ENDPOINTS.RETURN_RECEIVED(request._id), {}))} className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50">Mark received at warehouse</button>
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

              {request.status === 'received' && request.inspection?.passed === true && (
                <div className="space-y-3">
                  <p className="font-semibold">Initiate refund to original payment</p>
                  <div className="text-sm text-gray-600">Product value: <strong>{inr(preview?.productValue ?? request.refund?.productValue)}</strong></div>
                  <div className="flex gap-3 items-end flex-wrap">
                    <label className="text-sm">Shipping deduction (₹)
                      <input type="number" min="0" value={refund.shippingDeduction} onChange={(e) => setRefund({ ...refund, shippingDeduction: e.target.value })} className="block border rounded px-3 py-2 text-sm mt-1 w-40" />
                    </label>
                    <label className="text-sm">Restocking deduction (₹)
                      <input type="number" min="0" value={refund.restockingDeduction} onChange={(e) => setRefund({ ...refund, restockingDeduction: e.target.value })} className="block border rounded px-3 py-2 text-sm mt-1 w-40" />
                    </label>
                    <button disabled={busy} onClick={() => call(() => apiClient.post(API_ENDPOINTS.RETURN_REFUND(request._id), {
                      shippingDeduction: Number(refund.shippingDeduction) || 0,
                      restockingDeduction: Number(refund.restockingDeduction) || 0,
                    }))} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
                      Refund {inr((preview?.productValue ?? request.refund?.productValue ?? 0) - (Number(refund.shippingDeduction) || 0) - (Number(refund.restockingDeduction) || 0))}
                    </button>
                  </div>
                  {preview?.note && <p className="text-xs text-gray-500">{preview.note}</p>}
                </div>
              )}
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
                      <p className="text-xs text-gray-500">{new Date(e.timestamp).toLocaleString()}</p>
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
