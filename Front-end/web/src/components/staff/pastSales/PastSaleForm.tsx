'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Search, Trash2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { pastSaleKeys } from '@/hooks/queries/keys';
import { errorMessage, rupees, type SalesProduct } from '@/components/staff/sales/types';
import {
  CHANNELS, PAYMENT_METHODS, type PastSale, type PastSaleSeller, type Viewer,
} from './types';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'mb-1 block text-xs font-medium text-gray-700';

type Line = { key: string; product: string | null; name: string; quantity: string; price: string };

let lineSeq = 0;
const newLine = (over: Partial<Line> = {}): Line => {
  lineSeq += 1;
  return { key: `l${lineSeq}`, product: null, name: '', quantity: '1', price: '', ...over };
};

/** Debounce a fast-changing value (search box). */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(/[₹,\s]/g, '')));
const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/** Type a name, or pick the website product it was (optional — the name is what is saved). */
function ItemName({ line, onChange }: { line: Line; onChange: (patch: Partial<Line>) => void }) {
  const [open, setOpen] = useState(false);
  const term = useDebounced(line.name.trim(), 300);
  const search = useQuery({
    queryKey: pastSaleKeys.products(term),
    queryFn: () => apiClient.get<{ products: SalesProduct[] }>(`/staff/past-sales/products?q=${encodeURIComponent(term)}`),
    enabled: open && !line.product && term.length >= 2,
    staleTime: 30_000,
  });
  const hits = search.data?.products ?? [];
  return (
    <div className="relative">
      <input
        aria-label="Item name"
        value={line.name}
        onChange={(e) => { onChange({ name: e.target.value, product: null }); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="e.g. 7D floor mats"
        className={input}
        maxLength={200}
      />
      {line.product && <p className="mt-1 text-xs text-green-700">Linked to a website product</p>}
      {open && hits.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {hits.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange({ product: p.id, name: p.name }); setOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
              >
                <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                <span className="truncate">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Add or correct one past sale. The server checks everything again (the same rules
 * the spreadsheet upload uses) and saves the amounts exactly as typed.
 */
export default function PastSaleForm({ sale, viewer, onDone, onCancel }: {
  sale?: PastSale;
  viewer: Viewer;
  onDone: (warnings: string[]) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [f, setF] = useState(() => ({
    saleDate: sale?.saleDate || '',
    invoiceNo: sale?.invoiceNo || '',
    name: sale?.customer.name || '',
    phone: sale?.customer.phone || '',
    email: sale?.customer.email || '',
    city: sale?.customer.city || '',
    state: sale?.customer.state || '',
    vehicle: sale?.vehicle || '',
    channel: sale?.channel || '',
    discount: sale?.discount ? String(sale.discount) : '',
    gstAmount: sale?.gstAmount != null ? String(sale.gstAmount) : '',
    totalAmount: sale ? String(sale.totalAmount) : '',
    paymentMethod: sale?.paymentMethod || '',
    legalName: sale?.business?.legalName || '',
    gstin: sale?.business?.gstin || '',
    notes: sale?.notes || '',
    salesUserId: sale ? (sale.soldBy?.id || 'none') : '',
  }));
  const [lines, setLines] = useState<Line[]>(() => (sale?.items.length
    ? sale.items.map((i) => newLine({ product: i.product, name: i.name, quantity: String(i.quantity), price: String(i.price) }))
    : [newLine()]));
  const [showMore, setShowMore] = useState(!!sale && !!(sale.customer.email || sale.customer.state || sale.business || sale.notes));
  const [error, setError] = useState('');
  const [offerDuplicate, setOfferDuplicate] = useState(false);

  const sellers = useQuery({
    queryKey: pastSaleKeys.sellers(),
    queryFn: () => apiClient.get<{ sellers: PastSaleSeller[] }>('/staff/past-sales/sellers'),
    enabled: viewer.manage,
    staleTime: 5 * 60_000,
  });

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const setLine = (key: string, patch: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const itemsTotal = lines.reduce((s, l) => s + (num(l.quantity) || 0) * (num(l.price) || 0), 0);
  const expected = Math.round((itemsTotal - (num(f.discount) || 0)) * 100) / 100;
  const total = num(f.totalAmount);
  const mismatch = Number.isFinite(total) && itemsTotal > 0 && Math.abs(expected - total) > 1;

  const save = useMutation({
    mutationFn: (allowDuplicate: boolean) => {
      const body = {
        saleDate: f.saleDate,
        invoiceNo: f.invoiceNo.trim(),
        customer: { name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(), city: f.city.trim(), state: f.state.trim() },
        business: { legalName: f.legalName.trim(), gstin: f.gstin.trim() },
        vehicle: f.vehicle.trim(),
        channel: f.channel,
        items: lines.filter((l) => l.name.trim() || l.price.trim()).map((l) => ({ product: l.product, name: l.name.trim(), quantity: l.quantity.trim(), price: l.price.trim() })),
        discount: f.discount.trim(),
        gstAmount: f.gstAmount.trim(),
        totalAmount: f.totalAmount.trim(),
        paymentMethod: f.paymentMethod,
        notes: f.notes.trim(),
        ...(viewer.manage ? { salesUserId: f.salesUserId || 'none' } : {}),
        ...(sale ? { version: sale.version } : {}),
        ...(allowDuplicate ? { allowDuplicate: true } : {}),
      };
      return sale
        ? apiClient.put<{ sale: PastSale; warnings: string[] }>(`/staff/past-sales/${encodeURIComponent(sale.id)}`, body)
        : apiClient.post<{ sale: PastSale; warnings: string[] }>('/staff/past-sales', body);
    },
    onSuccess: (res) => {
      setError('');
      queryClient.invalidateQueries({ queryKey: pastSaleKeys.all });
      onDone(res.warnings || []);
    },
    onError: (e) => {
      const message = errorMessage(e, 'Could not save the sale. Please try again.');
      setError(message);
      setOfferDuplicate(!sale && /save it anyway/i.test(message));
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setOfferDuplicate(false);
    save.mutate(false);
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl border border-blue-200 bg-blue-50/30 p-4 sm:p-5" aria-label={sale ? 'Edit past sale' : 'Add a past sale'}>
      <h2 className="text-base font-semibold text-gray-900">{sale ? 'Edit past sale' : 'Add a past sale'}</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm"><span className={label}>Sale date *</span>
          <input type="date" required max={todayIST()} min="2000-01-01" value={f.saleDate} onChange={set('saleDate')} className={input} />
        </label>
        <label className="text-sm"><span className={label}>Bill / invoice number</span>
          <input value={f.invoiceNo} onChange={set('invoiceNo')} maxLength={60} placeholder="e.g. AB/2024/0315" className={input} />
        </label>
        <label className="text-sm"><span className={label}>Customer name *</span>
          <input required value={f.name} onChange={set('name')} maxLength={120} className={input} />
        </label>
        <label className="text-sm"><span className={label}>Customer phone (recommended)</span>
          <input type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} maxLength={20} placeholder="98xxxxxxxx" className={input} />
        </label>
        <label className="text-sm"><span className={label}>City</span>
          <input value={f.city} onChange={set('city')} maxLength={80} className={input} />
        </label>
        <label className="text-sm"><span className={label}>Car</span>
          <input value={f.vehicle} onChange={set('vehicle')} maxLength={120} placeholder="e.g. Hyundai Creta 2022" className={input} />
        </label>
        <label className="text-sm"><span className={label}>Where the sale happened</span>
          <select value={f.channel} onChange={set('channel')} className={input}>
            <option value="">—</option>
            {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        {viewer.manage && (
          <label className="text-sm"><span className={label}>Sold by</span>
            <select value={f.salesUserId} onChange={set('salesUserId')} className={input}>
              <option value="none">No salesman</option>
              {(sellers.data?.sellers ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.current ? '' : ' (former)'}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className={label}>Items *</legend>
        {lines.map((l, i) => (
          <div key={l.key} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-gray-200 bg-white p-3 sm:grid-cols-[1fr_5rem_8rem_auto] sm:items-start">
            <div className="col-span-2 sm:col-span-1"><ItemName line={l} onChange={(p) => setLine(l.key, p)} /></div>
            <label className="text-sm"><span className="sr-only">Quantity</span>
              <input aria-label={`Quantity, item ${i + 1}`} inputMode="numeric" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} placeholder="Qty" className={input} />
            </label>
            <label className="text-sm"><span className="sr-only">Price per unit</span>
              <input aria-label={`Price per unit, item ${i + 1}`} inputMode="decimal" value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} placeholder="Price ₹" className={input} />
            </label>
            <button type="button" aria-label={`Remove item ${i + 1}`} disabled={lines.length === 1}
              onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
              className="self-center justify-self-end rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-30">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setLines((prev) => [...prev, newLine()])} disabled={lines.length >= 100}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:underline disabled:opacity-50">
          <Plus className="h-4 w-4" /> Add another item
        </button>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm"><span className={label}>Discount ₹</span>
          <input inputMode="decimal" value={f.discount} onChange={set('discount')} placeholder="0" className={input} />
        </label>
        <label className="text-sm"><span className={label}>GST amount ₹ (if on the bill)</span>
          <input inputMode="decimal" value={f.gstAmount} onChange={set('gstAmount')} className={input} />
        </label>
        <label className="text-sm"><span className={label}>Total paid ₹ *</span>
          <input required inputMode="decimal" value={f.totalAmount} onChange={set('totalAmount')} className={input} />
        </label>
      </div>
      {itemsTotal > 0 && (
        <p className={`text-sm ${mismatch ? 'text-amber-700' : 'text-gray-500'}`}>
          Items {rupees(itemsTotal)}{num(f.discount) ? ` − discount ${rupees(num(f.discount))}` : ''} = {rupees(expected)}.
          {mismatch && ' This does not match the total paid. That is fine if the bill says so — it is saved as you typed it.'}
          {!f.totalAmount.trim() && expected > 0 && (
            <button type="button" onClick={() => setF((p) => ({ ...p, totalAmount: String(expected) }))} className="ml-2 font-medium text-blue-700 hover:underline">Use {rupees(expected)}</button>
          )}
        </p>
      )}

      <label className="block text-sm sm:max-w-xs"><span className={label}>Payment method *</span>
        <select required value={f.paymentMethod} onChange={set('paymentMethod')} className={input}>
          <option value="">Choose…</option>
          {PAYMENT_METHODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>

      {!showMore ? (
        <button type="button" onClick={() => setShowMore(true)} className="text-sm font-medium text-blue-700 hover:underline">
          + Email, state, business customer (GSTIN), notes
        </button>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm"><span className={label}>Customer email</span>
            <input type="email" value={f.email} onChange={set('email')} maxLength={254} className={input} />
          </label>
          <label className="text-sm"><span className={label}>State</span>
            <input value={f.state} onChange={set('state')} maxLength={80} className={input} />
          </label>
          <label className="text-sm"><span className={label}>Company name (business customer)</span>
            <input value={f.legalName} onChange={set('legalName')} maxLength={160} className={input} />
          </label>
          <label className="text-sm"><span className={label}>GSTIN</span>
            <input value={f.gstin} onChange={set('gstin')} maxLength={15} placeholder="27AAPFU0939F1ZV" className={`${input} uppercase`} />
          </label>
          <label className="text-sm sm:col-span-2"><span className={label}>Notes</span>
            <textarea value={f.notes} onChange={set('notes')} maxLength={1000} rows={2} className={input} />
          </label>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
          {offerDuplicate && (
            <button type="button" disabled={save.isPending} onClick={() => save.mutate(true)}
              className="ml-2 font-semibold underline">Save anyway</button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={save.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {sale ? 'Save changes' : 'Save sale'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  );
}
