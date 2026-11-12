'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Loader2, ShieldAlert, XCircle } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage, percentText, type Quotation } from './types';

/**
 * "Above 10%: prior approval mandatory". The seller asks with a short reason; the
 * GTM head (own team) or an admin approves or rejects with a note. The server
 * decides everything — who may approve, whether it is still needed, and that a
 * price change voids it — this only shows the state and sends the click.
 */
export default function DiscountApprovalPanel({ quote, onChanged }: { quote: Quotation; onChanged?: () => void }) {
  const a = quote.approval;
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const base = `/staff/sales/quotations/${encodeURIComponent(quote.id)}/approval`;
  const done = () => {
    setError('');
    queryClient.invalidateQueries({ queryKey: staffKeys.quotations() });
    onChanged?.();
  };
  const ask = useMutation({
    mutationFn: () => apiClient.post(`${base}/request`, { reason: reason.trim() }),
    onSuccess: () => { setReason(''); done(); },
    onError: (e) => setError(errorMessage(e, 'Could not send the request.')),
  });
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') => apiClient.post(`${base}/decide`, { decision, note: note.trim(), priceKey: a?.priceKey }),
    onSuccess: () => { setNote(''); done(); },
    onError: (e) => setError(errorMessage(e, 'Could not save the decision.')),
  });

  if (!a || a.state === 'not_needed' || quote.status !== 'open') return null;
  const busy = ask.isPending || decide.isPending;
  const deep = `${percentText(a.percent)} off the website price`;

  if (a.state === 'approved') {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900" data-testid="approval-approved">
        <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" /> Discount approved — {deep}</p>
        <p className="mt-1 text-green-800">
          By {a.decidedByName || 'the approver'}{a.decidedAt ? ` on ${formatDateTimeIST(a.decidedAt)}` : ''}{a.note ? ` · “${a.note}”` : ''}.
          {' '}Changing any price, quantity or the discount will need a new approval.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm" data-testid="approval-box">
      <p className="flex items-center gap-2 font-semibold text-amber-900">
        <ShieldAlert className="h-4 w-4" /> Needs approval — {deep}
      </p>
      <p className="mt-1 text-amber-900">
        Discounts above {percentText(a.threshold)} need the GTM head or an admin to approve before the quotation can be shared or accepted.
        {a.maxLinePercent > 0 && a.maxLinePercent !== a.totalPercent ? ` Deepest single item: ${percentText(a.maxLinePercent)}; whole quotation: ${percentText(a.totalPercent)}.` : ''}
      </p>

      {a.state === 'rejected' && (
        <p className="mt-2 flex items-start gap-2 rounded-md bg-red-50 p-2 text-red-800">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Rejected by {a.decidedByName || 'the approver'}{a.decidedAt ? ` on ${formatDateTimeIST(a.decidedAt)}` : ''}{a.note ? `: “${a.note}”` : ''}. Lower the discount, or ask again with more detail.</span>
        </p>
      )}

      {a.state === 'pending' && (
        <p className="mt-2 flex items-start gap-2 text-amber-900">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Waiting for approval — asked by {a.requestedByName || 'the seller'}{a.requestedAt ? ` on ${formatDateTimeIST(a.requestedAt)}` : ''}: “{a.reason}”</span>
        </p>
      )}

      {(a.state === 'needed' || a.state === 'rejected') && (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); ask.mutate(); }}>
          <label htmlFor={`approval-reason-${quote.id}`} className="block text-xs font-medium text-amber-900">Why does this customer need this discount?</label>
          <input id={`approval-reason-${quote.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300}
            placeholder="e.g. fleet customer, 6 cars this month"
            className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm" />
          <button type="submit" disabled={busy || reason.trim().length < 3}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
            {ask.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Request approval
          </button>
        </form>
      )}

      {a.state === 'pending' && a.canDecide && (
        <div className="mt-3 space-y-2 border-t border-amber-200 pt-3">
          <label htmlFor={`approval-note-${quote.id}`} className="block text-xs font-medium text-amber-900">Note (needed to reject)</label>
          <input id={`approval-note-${quote.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300}
            placeholder="e.g. OK this once / max 8%"
            className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm" />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => decide.mutate('approve')}
              className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50">
              {decide.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve
            </button>
            <button type="button" disabled={busy || note.trim().length < 3} onClick={() => decide.mutate('reject')}
              className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
              <XCircle className="h-4 w-4" /> Reject
            </button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-2 rounded-md bg-red-50 p-2 text-red-700">{error}</p>}
    </div>
  );
}
