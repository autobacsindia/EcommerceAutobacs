'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Search } from 'lucide-react';
import { listSuppliers, supplierKeys, type Supplier } from './suppliers';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

export const payLine = (s: Supplier) => (s.payment.method === 'upi'
  ? `UPI · ${s.payment.upiId}`
  : `${s.payment.bankName || 'Bank'} · ${s.payment.accountName} · A/c ${s.payment.accountNumber || s.payment.accountMasked} · ${s.payment.ifsc}`);

/**
 * Pick a saved supplier for a payment. Only the id is sent — the server copies
 * the supplier's bank details itself, so what shows here is for checking only.
 */
export default function SupplierPicker({ picked, onPick }: { picked: Supplier | null; onPick: (s: Supplier | null) => void }) {
  const [q, setQ] = useState('');
  const results = useQuery({
    queryKey: supplierKeys.list(q.trim().toLowerCase(), 'active'),
    queryFn: () => listSuppliers(q.trim(), 'active'),
    enabled: !picked,
  });

  if (picked) {
    const recent = picked.bankChangedAt && Date.now() - new Date(picked.bankChangedAt).getTime() < 30 * 86400000;
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-gray-900">{picked.name}</p>
            <p className="text-gray-700">{payLine(picked)}</p>
            {picked.phone && <p className="text-gray-600">{picked.phone}</p>}
          </div>
          <button type="button" onClick={() => onPick(null)} className="rounded-lg px-2 py-1 text-sm font-medium text-blue-700 hover:bg-blue-100">Change</button>
        </div>
        {recent && (
          <p role="status" className="mt-2 flex items-start gap-2 rounded bg-amber-100 p-2 text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Bank details changed on {new Date(picked.bankChangedAt as string).toLocaleDateString('en-IN')} by {picked.bankChangedBy}. Accounts and the admin will see this warning.
          </p>
        )}
      </div>
    );
  }

  const rows = results.data?.suppliers ?? [];
  return (
    <div className="space-y-2">
      <label className="relative block">
        <span className="sr-only">Search saved suppliers</span>
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
        <input className={`${input} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search saved suppliers by name" />
      </label>
      {results.isPending && <p className="flex items-center gap-2 text-xs text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading suppliers…</p>}
      {results.isSuccess && rows.length === 0 && <p className="text-xs text-gray-500">No saved supplier{q ? ' with that name' : ' yet'} — type their details below.</p>}
      {rows.length > 0 && (
        <ul role="listbox" aria-label="Saved suppliers" className="max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 bg-white">
          {rows.map((s) => (
            <li key={s.id}>
              <button type="button" role="option" aria-selected={false} onClick={() => onPick(s)} className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50">
                <span className="font-medium text-gray-900">{s.name}</span>
                <span className="block text-xs text-gray-500">{payLine(s)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
