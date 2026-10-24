'use client';

import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Pencil, Plus, Search } from 'lucide-react';
import { errorMessage } from './api';
import {
  createSupplier, listSuppliers, setSupplierActive, supplierKeys, updateSupplier,
  type Supplier, type SupplierInput,
} from './suppliers';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500';

const EMPTY: SupplierInput = {
  name: '', contactPerson: '', phone: '', email: '', gstin: '', address: '', notes: '',
  payment: { method: 'bank', upiId: '', accountName: '', accountNumber: '', ifsc: '', bankName: '' },
};

const toInput = (s: Supplier): SupplierInput => ({
  name: s.name, contactPerson: s.contactPerson, phone: s.phone, email: s.email, gstin: s.gstin, address: s.address, notes: s.notes,
  payment: {
    method: s.payment.method, upiId: s.payment.upiId, accountName: s.payment.accountName,
    accountNumber: s.payment.accountNumber, ifsc: s.payment.ifsc, bankName: s.payment.bankName,
  },
});

/** Add or edit one supplier. The server checks every field again. */
export function SupplierForm({ supplier, onDone, onCancel }: {
  supplier?: Supplier;
  onDone: (s: Supplier) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<SupplierInput>(supplier ? toInput(supplier) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof Omit<SupplierInput, 'payment'>) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const setPay = (k: keyof SupplierInput['payment']) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, payment: { ...v.payment, [k]: e.target.value } });
  const bank = v.payment.method === 'bank';
  const bankEdited = !!supplier && (
    v.payment.method !== supplier.payment.method || v.payment.upiId !== supplier.payment.upiId
    || v.payment.accountNumber !== supplier.payment.accountNumber || v.payment.ifsc !== supplier.payment.ifsc);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (bankEdited && !window.confirm('You are changing where this supplier is paid. Did you confirm the new details with the supplier by phone? Payments raised in the next 30 days will show a warning to accounts and the admin.')) return;
    const body: SupplierInput = {
      ...v,
      gstin: v.gstin.trim().toUpperCase(),
      payment: { ...v.payment, accountNumber: v.payment.accountNumber.replace(/\s+/g, ''), ifsc: v.payment.ifsc.trim().toUpperCase() },
    };
    setBusy(true);
    try {
      const res = supplier ? await updateSupplier(supplier.id, body) : await createSupplier(body);
      onDone(res.supplier);
    } catch (err) {
      setError(errorMessage(err, 'Could not save the supplier. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label={supplier ? 'Edit supplier' : 'Add supplier'} className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="text-base font-semibold text-gray-900">{supplier ? `Edit ${supplier.name}` : 'Add a supplier'}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className={label} htmlFor="sup-name">Supplier name</label>
          <input id="sup-name" className={input} required minLength={2} maxLength={120} value={v.name} onChange={set('name')} /></div>
        <div><label className={label} htmlFor="sup-contact">Contact person</label>
          <input id="sup-contact" className={input} maxLength={120} value={v.contactPerson} onChange={set('contactPerson')} /></div>
        <div><label className={label} htmlFor="sup-phone">Phone</label>
          <input id="sup-phone" className={input} inputMode="tel" maxLength={20} value={v.phone} onChange={set('phone')} /></div>
        <div><label className={label} htmlFor="sup-email">Email</label>
          <input id="sup-email" className={input} type="email" maxLength={160} value={v.email} onChange={set('email')} /></div>
        <div><label className={label} htmlFor="sup-gstin">GST number</label>
          <input id="sup-gstin" className={input} maxLength={15} value={v.gstin} onChange={set('gstin')} placeholder="Optional" autoCapitalize="characters" /></div>
        <div><label className={label} htmlFor="sup-address">Address</label>
          <input id="sup-address" className={input} maxLength={500} value={v.address} onChange={set('address')} /></div>
      </div>

      <div>
        <span className={label}>How we pay them</span>
        <div className="flex gap-2" role="radiogroup" aria-label="Supplier payment method">
          {(['bank', 'upi'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={v.payment.method === m} onClick={() => setV({ ...v, payment: { ...v.payment, method: m } })}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${v.payment.method === m ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700'}`}>
              {m === 'upi' ? 'UPI' : 'Bank transfer'}
            </button>
          ))}
        </div>
        {bank ? (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <input aria-label="Account holder" className={input} required value={v.payment.accountName} onChange={setPay('accountName')} placeholder="Account holder name" />
            <input aria-label="Account number" className={input} required inputMode="numeric" value={v.payment.accountNumber} onChange={setPay('accountNumber')} placeholder="Account number" />
            <input aria-label="IFSC" className={input} required value={v.payment.ifsc} onChange={setPay('ifsc')} placeholder="IFSC, e.g. HDFC0001234" autoCapitalize="characters" />
            <input aria-label="Bank name" className={input} value={v.payment.bankName} onChange={setPay('bankName')} placeholder="Bank (optional)" />
          </div>
        ) : (
          <div className="mt-2"><input aria-label="UPI ID" className={input} value={v.payment.upiId} onChange={setPay('upiId')} placeholder="UPI ID (optional — or attach their QR on each payment)" autoCapitalize="none" /></div>
        )}
        {bankEdited && (
          <p role="status" className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> You are changing where this supplier is paid. Confirm the new details with the supplier by phone first.
          </p>
        )}
      </div>

      <div><label className={label} htmlFor="sup-notes">Notes</label>
        <textarea id="sup-notes" className={input} rows={2} maxLength={1000} value={v.notes} onChange={set('notes')} placeholder="What they supply, payment terms…" /></div>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save supplier
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">Cancel</button>
      </div>
    </form>
  );
}

function SupplierCard({ s, onEdit }: { s: Supplier; onEdit: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const p = s.payment;
  async function toggle() {
    setBusy(true);
    try { await setSupplierActive(s.id, !s.active); await qc.invalidateQueries({ queryKey: supplierKeys.all }); } catch (err) { setError(errorMessage(err, 'Could not change it.')); } finally { setBusy(false); }
  }
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900">{s.name}{!s.active && <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">Inactive</span>}</p>
          <p className="text-sm text-gray-600">{[s.contactPerson, s.phone, s.email].filter(Boolean).join(' · ')}</p>
          <p className="text-sm text-gray-700">
            {p.method === 'upi' ? `UPI · ${p.upiId}` : `${p.bankName || 'Bank'} · ${p.accountName} · A/c ${p.accountNumber || p.accountMasked} · ${p.ifsc}`}
          </p>
          {s.gstin && <p className="text-xs text-gray-500">GST {s.gstin}</p>}
          {s.bankChangedAt && <p className="text-xs text-amber-700">Bank details changed {new Date(s.bankChangedAt).toLocaleDateString('en-IN')} by {s.bankChangedBy}</p>}
        </div>
        {s.can.edit && (
          <div className="flex gap-2">
            <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"><Pencil className="h-3.5 w-3.5" /> Edit</button>
            <button type="button" disabled={busy} onClick={toggle} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">{s.active ? 'Mark inactive' : 'Reactivate'}</button>
          </div>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </li>
  );
}

/** Procurement and the admin keep the list; accounts reads it. */
export default function SupplierDirectory({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const query = useInfiniteQuery({
    queryKey: supplierKeys.list(q.trim().toLowerCase(), status),
    queryFn: ({ pageParam }) => listSuppliers(q.trim(), status, pageParam),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextAfter || undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.suppliers) ?? [];
  const done = async () => { setEditing(null); await qc.invalidateQueries({ queryKey: supplierKeys.all }); };

  if (editing) {
    return <SupplierForm supplier={editing === 'new' ? undefined : editing} onDone={done} onCancel={() => setEditing(null)} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">Search suppliers</span>
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input className={`${input} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" />
        </label>
        <div role="tablist" aria-label="Supplier status" className="flex gap-2">
          {(['active', 'inactive'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={status === t} onClick={() => setStatus(t)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${status === t ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}>
              {t === 'active' ? 'Active' : 'Inactive'}
            </button>
          ))}
        </div>
        {canEdit && (
          <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" /> Add supplier
          </button>
        )}
      </div>

      {query.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {query.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(query.error, 'Could not load suppliers.')}</p>}
      {query.isSuccess && rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          {q ? 'No supplier with that name.' : status === 'active' ? 'No suppliers saved yet.' : 'No inactive suppliers.'}
        </p>
      )}
      <ul className="space-y-3">{rows.map((s) => <SupplierCard key={s.id} s={s} onEdit={() => setEditing(s)} />)}</ul>
      {query.hasNextPage && (
        <button type="button" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {query.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}
