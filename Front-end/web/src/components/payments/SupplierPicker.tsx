'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { listSuppliers, supplierKeys, type Supplier } from './suppliers';

export const payLine = (s: Supplier) => (s.payment.method === 'upi'
  ? `UPI · ${s.payment.upiId}`
  : `${s.payment.bankName || 'Bank'} · ${s.payment.accountName} · A/c ${s.payment.accountNumber || s.payment.accountMasked} · ${s.payment.ifsc}`);

/**
 * Saved suppliers whose name starts with what is being typed, shown right under
 * the name box (so typing the name IS the search). Empty until something is
 * typed; hidden once the typed text exactly matches the only result. Silent on
 * error — the box still works as plain text.
 */
export function SupplierSuggestions({ query, onPick, label = 'Saved suppliers' }: {
  query: string;
  onPick: (s: Supplier) => void;
  label?: string;
}) {
  const q = query.trim();
  const results = useQuery({
    queryKey: supplierKeys.list(q.toLowerCase(), 'active'),
    queryFn: () => listSuppliers(q, 'active'),
    enabled: q.length >= 1,
    staleTime: 30_000,
  });
  const rows = (results.data?.suppliers ?? []).slice(0, 8);
  if (!q || !rows.length) return null;
  if (rows.length === 1 && rows[0].name.toLowerCase() === q.toLowerCase()) return null;
  return (
    <ul role="listbox" aria-label={label} className="mt-1 max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-blue-200 bg-white shadow-sm">
      {rows.map((s) => (
        <li key={s.id}>
          <button type="button" role="option" aria-selected={false} onClick={() => onPick(s)} className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50">
            <span className="font-medium text-gray-900">{s.name}</span>
            <span className="block text-xs text-gray-500">{payLine(s)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The saved supplier picked for a payment. Only the id is sent — the server copies
 * the supplier's bank details itself, so what shows here is for checking only.
 */
export default function SupplierPicker({ picked, onPick }: { picked: Supplier | null; onPick: (s: Supplier | null) => void }) {
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

  return null;
}
