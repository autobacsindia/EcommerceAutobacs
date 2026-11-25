'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import { payLaterKeys, salesTypeKeys } from './api';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

/**
 * Accounts / admin: approve a GTM order's B2B or B2C type, with a note. The server
 * records it once (services/salesTypeService.js); a B2B order can then ship before payment.
 */
export default function SalesTypeApprove({ orderId, label, onDone }: { orderId: string; label: 'B2B' | 'B2C'; onDone?: () => void }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const approve = useMutation({
    mutationFn: () => apiClient.post(`/staff/orders/${encodeURIComponent(orderId)}/sales-type-check`, { note: note.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salesTypeKeys.all });
      queryClient.invalidateQueries({ queryKey: payLaterKeys.all });
      queryClient.invalidateQueries({ queryKey: staffKeys.orders() });
      setNote('');
      onDone?.();
    },
    onError: (e) => setError(errorMessage(e, 'Could not approve.')),
  });
  const id = `sales-type-note-${orderId}`;
  return (
    <form className="space-y-2" aria-label={`Approve ${label}`} onSubmit={(e) => { e.preventDefault(); setError(''); approve.mutate(); }}>
      <label htmlFor={id} className="block text-xs font-medium text-gray-700">Note (accounts)</label>
      <textarea id={id} className={input} rows={2} required minLength={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)}
        placeholder={label === 'B2B' ? 'Example: GSTIN checked, regular dealer' : 'Example: Black Friday 10% offer checked'} />
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      <button type="submit" disabled={approve.isPending || note.trim().length < 3}
        className="rounded-lg bg-green-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
        Approve as {label}
      </button>
    </form>
  );
}
