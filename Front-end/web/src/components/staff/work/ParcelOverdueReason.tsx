'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { History, MessageSquareWarning } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage } from '@/components/staff/sales/types';
import { formatEtaDay } from './ParcelEta';
import type { OverdueReasonCode, WorkOrder } from './types';

/*
  Reason for overdue on a parcel past its expected delivery date (Back-end
  teamWorkflowService.setParcelOverdueReason). Procurement, operations and the admin give
  it; everyone who sees the parcel reads it. The server decides who may, checks
  the parcel is still overdue on the date shown, and keeps every reason given.
*/

/** Same list and limit as the server (utils/parcelEta.js). */
export const OVERDUE_REASONS: { value: OverdueReasonCode; label: string }[] = [
  { value: 'supplier_delay', label: 'Supplier delay' },
  { value: 'courier_delay', label: 'Courier delay' },
  { value: 'customer_unreachable', label: 'Customer unreachable' },
  { value: 'address_issue', label: 'Address issue' },
  { value: 'other', label: 'Other' },
];
export const MAX_OVERDUE_NOTE = 300;

type Parcel = WorkOrder['parcels'][number];
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50';
const field = 'rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

export default function ParcelOverdueReason({ orderId, parcel }: { orderId: string; parcel: Parcel }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState<OverdueReasonCode | ''>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const save = useMutation({
    mutationFn: () => apiClient.put<{ order: WorkOrder }>(
      `/staff/work/orders/${orderId}/parcels/${parcel.id}/overdue-reason`,
      { code, note: note.trim(), expectedDate: parcel.eta?.date ?? null },
    ),
    onSuccess: (res) => {
      setError('');
      setEditing(false);
      const self = staffKeys.workOrder(orderId);
      queryClient.setQueryData(self, res);
      // The lists carry the "no reason" count; this order's own reply is already fresh.
      queryClient.invalidateQueries({
        queryKey: staffKeys.orders(),
        predicate: (query) => JSON.stringify(query.queryKey) !== JSON.stringify(self),
      });
    },
    onError: (e) => setError(errorMessage(e, 'Could not save the reason.')),
  });

  const current = parcel.overdueReason ?? null;
  const history = parcel.overdueReasonHistory ?? [];
  const overdue = parcel.etaState === 'overdue';
  // Nothing to show: not overdue and never explained.
  if (!overdue && !history.length) return null;

  const noteNeeded = code === 'other' && !note.trim();
  const open = () => {
    setCode(current?.code ?? '');
    setNote(current?.note ?? '');
    setError('');
    setEditing(true);
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {overdue && (current ? (
          <span className="text-gray-800">
            <MessageSquareWarning className="mr-1 inline h-3.5 w-3.5 text-red-600" aria-hidden />
            Reason for overdue: <strong>{current.text}</strong>
            <span className="text-gray-500"> · by {current.by || 'Staff'}{current.at ? `, ${formatDateTimeIST(current.at)}` : ''}</span>
          </span>
        ) : (
          <span className="font-medium text-red-700">
            <MessageSquareWarning className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            No reason for overdue yet
          </span>
        ))}
        {parcel.canExplainOverdue && !editing && (
          <button type="button" className={`${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`} onClick={open}>
            {current ? 'Change reason' : 'Add reason'}
          </button>
        )}
        {history.length > 0 && (
          <button type="button" className="inline-flex items-center gap-1 text-gray-500 underline-offset-2 hover:underline"
            aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
            <History className="h-3 w-3" /> Reasons given ({history.length})
          </button>
        )}
      </div>
      {editing && (
        <form className="flex flex-wrap items-start gap-2" aria-label={`Reason for overdue, parcel ${parcel.sequence}`}
          onSubmit={(e) => { e.preventDefault(); if (code && !noteNeeded) save.mutate(); }}>
          <select required aria-label="Reason" value={code} className={field}
            onChange={(e) => setCode(e.target.value as OverdueReasonCode | '')}>
            <option value="">Choose a reason…</option>
            {OVERDUE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <input type="text" aria-label="Details" maxLength={MAX_OVERDUE_NOTE} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={code === 'other' ? 'Say what happened (required)' : 'Details (optional), e.g. stuck at the courier hub'}
            className={`${field} min-w-[16rem] flex-1`} />
          <button type="submit" disabled={save.isPending || !code || noteNeeded} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>Save reason</button>
          <button type="button" className={`${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`} onClick={() => setEditing(false)}>Cancel</button>
        </form>
      )}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {showHistory && (
        <ol className="space-y-0.5 border-l-2 border-gray-200 pl-2" aria-label={`Reasons given for parcel ${parcel.sequence}`}>
          {history.map((h, i) => (
            <li key={`${h.at}-${i}`} className="text-xs text-gray-600">
              {h.note ? `${h.label} — ${h.note}` : h.label}
              <span className="text-gray-500"> — {h.by || 'Staff'}, {formatDateTimeIST(h.at)}{h.forDate ? ` (was due ${formatEtaDay(h.forDate)})` : ''}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
