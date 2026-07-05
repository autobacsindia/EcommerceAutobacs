'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Phone, Mail, ShoppingBag, UserPlus, UserMinus, Search, Plus, Trash2, Check,
} from 'lucide-react';
import apiClient from '@/lib/api';
import {
  Lead, LeadStatus, LEAD_STATUSES, LEAD_STATUS_LABELS, LEAD_STATUS_COLORS,
  LEAD_SOURCE_LABELS, LEAD_SOURCE_COLORS,
} from '@/lib/leads';

interface OrderHistoryItem {
  _id: string;
  orderNumber?: string;
  totalAmount: number;
  status: string;
  createdAt: string;
}
interface LeadDetailResponse {
  success: boolean;
  lead: Lead;
  orderHistory: OrderHistoryItem[];
}
interface ProductHit { _id: string; name: string; price: number }
interface OfflineLineItem { product: string; name: string; price: number; quantity: number }

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [lead, setLead] = useState<Lead | null>(null);
  const [orderHistory, setOrderHistory] = useState<OrderHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // activity form
  const [activityType, setActivityType] = useState<'call' | 'note' | 'email'>('call');
  const [activityNotes, setActivityNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<LeadDetailResponse>(`/leads/${id}`);
      if (res.success) { setLead(res.lead); setOrderHistory(res.orderHistory || []); }
    } catch (e) {
      console.error('[Lead] load failed', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function changeStatus(next: LeadStatus) {
    setSaving(true);
    try {
      await apiClient.patch(`/leads/${id}/status`, { status: next });
      await load();
    } catch (e) {
      console.error('[Lead] status failed', e);
    } finally {
      setSaving(false);
    }
  }

  async function claimToggle() {
    setSaving(true);
    try {
      if (lead?.assignedTo) await apiClient.post(`/leads/${id}/release`, {});
      else await apiClient.post(`/leads/${id}/claim`, {});
      await load();
    } catch (e) {
      console.error('[Lead] claim/release failed', e);
    } finally {
      setSaving(false);
    }
  }

  async function logActivity() {
    if (!activityNotes.trim()) return;
    setSaving(true);
    try {
      await apiClient.post(`/leads/${id}/activity`, { type: activityType, notes: activityNotes.trim() });
      setActivityNotes('');
      await load();
    } catch (e) {
      console.error('[Lead] activity failed', e);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-10 text-center text-gray-400">Loading…</div>;
  if (!lead) return <div className="p-10 text-center text-gray-400">Lead not found.</div>;

  return (
    <div className="space-y-6">
      <Link href="/admin/leads" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> Back to leads
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-gray-200 bg-white p-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">{lead.name || 'Unknown lead'}</h1>
            {lead.hasPurchased && (
              <span className="inline-flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                <ShoppingBag className="h-3 w-3" /> Existing customer
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-col gap-1 text-sm text-gray-600">
            {lead.email && <span className="flex items-center gap-1"><Mail className="h-4 w-4" />{lead.email}</span>}
            {lead.phone && <span className="flex items-center gap-1"><Phone className="h-4 w-4" />{lead.phone}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`rounded px-2 py-1 text-xs font-medium ${LEAD_STATUS_COLORS[lead.status]}`}>
            {LEAD_STATUS_LABELS[lead.status]}
          </span>
          <span className="text-xs text-gray-500">
            {lead.assignedTo ? `Owner: ${lead.assignedTo.name || lead.assignedTo.email}` : 'Unclaimed (pool)'}
          </span>
          <button
            onClick={claimToggle}
            disabled={saving}
            className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {lead.assignedTo ? <><UserMinus className="h-3 w-3" /> Release</> : <><UserPlus className="h-3 w-3" /> Claim</>}
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: status + activity + close deal */}
        <div className="space-y-6 lg:col-span-2">
          {/* Status control */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Status</h2>
            <div className="flex flex-wrap gap-2">
              {LEAD_STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => changeStatus(s)}
                  disabled={saving || lead.status === s}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    lead.status === s ? LEAD_STATUS_COLORS[s] + ' ring-2 ring-offset-1 ring-blue-400' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  } disabled:cursor-default`}
                >
                  {LEAD_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            {lead.sources.some((s) => s.type === 'consultation') && (
              <p className="mt-2 text-xs text-gray-400">Status changes mirror to the linked consultancy record.</p>
            )}
          </section>

          {/* Log contact */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Log a contact</h2>
            <div className="flex gap-2">
              <select value={activityType} onChange={(e) => setActivityType(e.target.value as 'call' | 'note' | 'email')} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                <option value="call">Call</option>
                <option value="email">Email</option>
                <option value="note">Note</option>
              </select>
              <input
                value={activityNotes}
                onChange={(e) => setActivityNotes(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') logActivity(); }}
                placeholder="What happened?"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <button onClick={logActivity} disabled={saving || !activityNotes.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                Log
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-400">Logging a call/email marks the lead as contacted.</p>
          </section>

          {/* Close deal */}
          <CloseDealForm lead={lead} onClosed={load} />

          {/* Activity timeline */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Activity</h2>
            {lead.activities.length === 0 ? (
              <p className="text-sm text-gray-400">No activity yet.</p>
            ) : (
              <ul className="space-y-3">
                {[...lead.activities].reverse().map((a, i) => (
                  <li key={a._id || i} className="flex gap-3 text-sm">
                    <span className="mt-0.5 rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 capitalize">{a.type.replace('_', ' ')}</span>
                    <div>
                      <p className="text-gray-700">{a.notes}</p>
                      <p className="text-xs text-gray-400">
                        {new Date(a.at).toLocaleString()}
                        {a.by && typeof a.by === 'object' && a.by.name ? ` · ${a.by.name}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Right: sources + order history */}
        <div className="space-y-6">
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Signals</h2>
            <ul className="space-y-2">
              {lead.sources.map((s, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${LEAD_SOURCE_COLORS[s.type]}`}>{LEAD_SOURCE_LABELS[s.type]}</span>
                  {s.capturedAt && <span className="text-xs text-gray-400">{new Date(s.capturedAt).toLocaleDateString()}</span>}
                </li>
              ))}
              {lead.sources.length === 0 && <li className="text-sm text-gray-400">No active signals.</li>}
            </ul>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Order history</h2>
            {orderHistory.length === 0 ? (
              <p className="text-sm text-gray-400">No orders on this account.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {orderHistory.map((o) => (
                  <li key={o._id} className="flex items-center justify-between">
                    <Link href={`/admin/orders/${o._id}`} className="text-blue-600 hover:underline">{o.orderNumber || o._id.slice(-6)}</Link>
                    <span className="text-gray-500">₹{o.totalAmount?.toLocaleString()} · {o.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** Close a deal by creating an offline order for this lead's customer. */
function CloseDealForm({ lead, onClosed }: { lead: Lead; onClosed: () => void }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [items, setItems] = useState<OfflineLineItem[]>([]);
  const [status, setStatus] = useState<'processing' | 'delivered'>('processing');
  const [email, setEmail] = useState(lead.email || '');
  const [phone, setPhone] = useState(lead.phone || '');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function searchProducts() {
    if (!term.trim()) return;
    try {
      const res = await apiClient.get<{ products: ProductHit[] }>(`/products?search=${encodeURIComponent(term.trim())}&limit=8`);
      setHits(res.products || []);
    } catch (e) {
      console.error('[CloseDeal] search failed', e);
    }
  }

  function addItem(p: ProductHit) {
    if (items.some((i) => i.product === p._id)) return;
    setItems((prev) => [...prev, { product: p._id, name: p.name, price: p.price, quantity: 1 }]);
    setHits([]);
    setTerm('');
  }

  function updateItem(idx: number, patch: Partial<OfflineLineItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  async function submit() {
    if (!email || !phone || items.length === 0) return;
    setSubmitting(true);
    try {
      const res = await apiClient.post<{ success: boolean; order: { orderNumber?: string; _id: string } }>(
        '/orders/admin/offline',
        {
          email, phone, name: lead.name,
          items: items.map((i) => ({ product: i.product, name: i.name, price: i.price, quantity: i.quantity })),
          status,
          leadId: lead._id,
        }
      );
      if (res.success) {
        setDone(res.order.orderNumber || res.order._id);
        setItems([]);
        onClosed();
      }
    } catch (e) {
      console.error('[CloseDeal] submit failed', e);
      alert('Failed to create offline order.');
    } finally {
      setSubmitting(false);
    }
  }

  if (lead.status === 'won' && !open) {
    return (
      <section className="rounded-lg border border-green-200 bg-green-50 p-5 text-sm text-green-800">
        <Check className="mr-1 inline h-4 w-4" /> This deal is won.
        {lead.convertedOrder && (
          <Link href={`/admin/orders/${lead.convertedOrder._id}`} className="ml-2 underline">View order</Link>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Close deal → offline order</h2>
        {!open && (
          <button onClick={() => setOpen(true)} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700">
            Create offline order
          </button>
        )}
      </div>

      {done && <p className="mt-3 rounded bg-green-50 p-2 text-sm text-green-700">Offline order {done} created. The customer will get an invoice + set-password link.</p>}

      {open && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-gray-600">Customer email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-600">Customer phone</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
          </div>

          {/* Product search */}
          <div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <input
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); searchProducts(); } }}
                  placeholder="Search products to add…"
                  className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm"
                />
              </div>
              <button onClick={searchProducts} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Search</button>
            </div>
            {hits.length > 0 && (
              <ul className="mt-2 max-h-48 overflow-auto rounded-lg border border-gray-200">
                {hits.map((p) => (
                  <li key={p._id}>
                    <button onClick={() => addItem(p)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50">
                      <span>{p.name}</span>
                      <span className="flex items-center gap-2 text-gray-500">₹{p.price?.toLocaleString()} <Plus className="h-4 w-4" /></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Line items */}
          {items.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr><th className="py-1">Product</th><th className="py-1 w-20">Qty</th><th className="py-1 w-28">Unit ₹</th><th className="py-1 w-8"></th></tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={it.product} className="border-t border-gray-100">
                    <td className="py-2">{it.name}</td>
                    <td className="py-2"><input type="number" min={1} value={it.quantity} onChange={(e) => updateItem(idx, { quantity: Math.max(1, Number(e.target.value)) })} className="w-16 rounded border border-gray-300 px-2 py-1" /></td>
                    <td className="py-2"><input type="number" min={0} value={it.price} onChange={(e) => updateItem(idx, { price: Math.max(0, Number(e.target.value)) })} className="w-24 rounded border border-gray-300 px-2 py-1" /></td>
                    <td className="py-2"><button onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))} className="text-red-500 hover:text-red-700"><Trash2 className="h-4 w-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="flex items-center justify-between border-t border-gray-100 pt-3">
            <div className="flex items-center gap-3 text-sm">
              <label className="text-gray-600">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as 'processing' | 'delivered')} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">
                <option value="processing">Confirmed (paid)</option>
                <option value="delivered">Delivered</option>
              </select>
            </div>
            <div className="text-sm font-semibold text-gray-900">Total: ₹{total.toLocaleString()}</div>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
            <button onClick={submit} disabled={submitting || !email || !phone || items.length === 0} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
              {submitting ? 'Creating…' : 'Create order & close'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
