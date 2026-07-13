'use client';

import { useState } from 'react';
import { Search, Plus, Trash2 } from 'lucide-react';
import apiClient from '@/lib/api';
import { SalesRep } from '@/lib/leads';

interface ProductHit { _id: string; name: string; price: number }
interface OfflineLineItem { product: string; name: string; price: number; quantity: number }

export interface OfflineOrderFormProps {
  reps: SalesRep[];
  /** When closing a CRM lead, pass its id so the lead converts to Won. Omit for a standalone sale. */
  leadId?: string;
  defaults?: { name?: string; email?: string; phone?: string; repId?: string };
  /** Standalone sales require picking the crediting rep. */
  requireRep?: boolean;
  submitLabel?: string;
  onCreated: (orderRef: string) => void;
  onCancel?: () => void;
}

const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';

/**
 * The offline-order form body — customer, delivery address, products, status and
 * crediting rep — posting to POST /orders/admin/offline. Shared by the lead
 * "close deal" flow (with leadId) and the standalone "new offline order" modal
 * (no leadId, e.g. a Meta lead or walk-in not in the CRM).
 */
export default function OfflineOrderForm({
  reps, leadId, defaults, requireRep = false, submitLabel = 'Create order', onCreated, onCancel,
}: OfflineOrderFormProps) {
  const [name, setName] = useState(defaults?.name || '');
  const [email, setEmail] = useState(defaults?.email || '');
  const [phone, setPhone] = useState(defaults?.phone || '');
  const [addr, setAddr] = useState({
    fullName: defaults?.name || '', addressLine1: '', addressLine2: '',
    city: '', state: '', postalCode: '', country: 'India',
  });
  const setAddrField = (k: keyof typeof addr, v: string) => setAddr((p) => ({ ...p, [k]: v }));

  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [items, setItems] = useState<OfflineLineItem[]>([]);
  const [status, setStatus] = useState<'processing' | 'delivered'>('processing');
  const [repId, setRepId] = useState(defaults?.repId || '');
  const [submitting, setSubmitting] = useState(false);

  const addressComplete = !!(addr.addressLine1.trim() && addr.city.trim() && addr.state.trim() && /^\d{6}$/.test(addr.postalCode.trim()));
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const canSubmit = !!email && !!phone && items.length > 0 && addressComplete && (!requireRep || !!repId) && !submitting;

  async function searchProducts() {
    if (!term.trim()) return;
    try {
      const res = await apiClient.get<{ products: ProductHit[] }>(`/products?search=${encodeURIComponent(term.trim())}&limit=8`);
      setHits(res.products || []);
    } catch (e) {
      console.error('[OfflineOrder] search failed', e);
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

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await apiClient.post<{ success: boolean; order: { orderNumber?: string; _id: string } }>(
        '/orders/admin/offline',
        {
          name: name || undefined,
          email, phone,
          items: items.map((i) => ({ product: i.product, name: i.name, price: i.price, quantity: i.quantity })),
          shippingAddress: { ...addr, fullName: addr.fullName || name, phone },
          status,
          leadId: leadId || undefined,
          repId: repId || undefined,
        }
      );
      if (res.success) onCreated(res.order.orderNumber || res.order._id);
    } catch (e: unknown) {
      const msg = (e as { rawData?: { message?: string } })?.rawData?.message;
      alert(msg || 'Failed to create offline order.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Customer */}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-gray-600">Customer name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-600">Email <span className="text-red-500">*</span></span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-600">Phone <span className="text-red-500">*</span></span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
        </label>
      </div>

      {/* Delivery address */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Delivery address</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-gray-600">Recipient name</span>
            <input value={addr.fullName} onChange={(e) => setAddrField('fullName', e.target.value)} placeholder={name || 'Same as customer'} className={inputCls} />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-gray-600">Address line 1 <span className="text-red-500">*</span></span>
            <input value={addr.addressLine1} onChange={(e) => setAddrField('addressLine1', e.target.value)} placeholder="House / flat no., street" className={inputCls} />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-gray-600">Address line 2</span>
            <input value={addr.addressLine2} onChange={(e) => setAddrField('addressLine2', e.target.value)} placeholder="Area, landmark (optional)" className={inputCls} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">City <span className="text-red-500">*</span></span>
            <input value={addr.city} onChange={(e) => setAddrField('city', e.target.value)} className={inputCls} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">State <span className="text-red-500">*</span></span>
            <input value={addr.state} onChange={(e) => setAddrField('state', e.target.value)} className={inputCls} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">PIN code <span className="text-red-500">*</span></span>
            <input value={addr.postalCode} onChange={(e) => setAddrField('postalCode', e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="6 digits" className={inputCls} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Country</span>
            <input value={addr.country} onChange={(e) => setAddrField('country', e.target.value)} className={inputCls} />
          </label>
        </div>
        {!addressComplete && (
          <p className="mt-2 text-xs text-amber-600">Address line 1, city, state and a 6-digit PIN are required so the order can be delivered.</p>
        )}
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

      {/* Status + rep + total */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="text-gray-600">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as 'processing' | 'delivered')} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">
            <option value="processing">Confirmed (paid)</option>
            <option value="delivered">Delivered</option>
          </select>
          <label className="text-gray-600">{leadId ? 'Closed by' : 'Sold by'}{requireRep && <span className="text-red-500"> *</span>}</label>
          <select value={repId} onChange={(e) => setRepId(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">
            <option value="">— none —</option>
            {reps.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
          </select>
        </div>
        <div className="text-sm font-semibold text-gray-900">Total: ₹{total.toLocaleString()}</div>
      </div>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <button onClick={onCancel} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
        )}
        <button onClick={submit} disabled={!canSubmit} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
          {submitting ? 'Creating…' : submitLabel}
        </button>
      </div>
    </div>
  );
}
