'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Truck } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage, rupees } from '@/components/staff/sales/types';
import { payLaterKeys, type PayLaterOption } from './api';
import PayLaterBadge from './PayLaterBadge';
import SalesTypeApprove from './SalesTypeApprove';
import SalesTypeChange from './SalesTypeChange';
import SalesTypeBadge from '@/components/staff/sales/SalesTypeBadge';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

/**
 * Order page (admin) / accounts list: the GTM order's B2B / B2C badge and accounts'
 * check, then "Ship before payment" for an unpaid B2B order — or, once on, where it
 * stands. Renders nothing for a website order. The server decides everything
 * (who, when, which orders); this only asks and shows.
 */
export default function OrderPayLater({ orderId, onChanged, hideType = false }: { orderId: string; onChanged?: () => void; hideType?: boolean }) {
  const { data } = useQuery({
    queryKey: payLaterKeys.option(orderId),
    queryFn: async () => (await apiClient.get(`/staff/orders/${encodeURIComponent(orderId)}/pay-later`)) as unknown as PayLaterOption,
  });
  const t = data?.salesType;
  return (
    <>
      {t && !hideType && (
        <section aria-label="B2B or B2C" className="space-y-2">
          <SalesTypeBadge info={t} detail />
          {t.check?.status === 'pending' && <SalesTypeApprove orderId={orderId} label={t.label} onDone={onChanged} />}
          {data?.typeChange && <SalesTypeChange orderId={orderId} option={data.typeChange} onDone={onChanged} />}
        </section>
      )}
      <PayLaterPart orderId={orderId} onChanged={onChanged} />
    </>
  );
}

function PayLaterPart({ orderId, onChanged }: { orderId: string; onChanged?: () => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const { data, isError } = useQuery({
    queryKey: payLaterKeys.option(orderId),
    queryFn: async () => (await apiClient.get(`/staff/orders/${encodeURIComponent(orderId)}/pay-later`)) as unknown as PayLaterOption,
  });
  const approve = useMutation({
    mutationFn: () => apiClient.post(`/staff/orders/${encodeURIComponent(orderId)}/pay-later`, { reason: reason.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payLaterKeys.all });
      queryClient.invalidateQueries({ queryKey: staffKeys.orders() });
      setOpen(false);
      onChanged?.();
    },
    onError: (e) => setError(errorMessage(e, 'Could not turn on ship before payment.')),
  });

  if (isError || !data) return null;

  if (data.approved?.payLater) {
    const p = data.approved.payLater;
    return (
      <section aria-label="Ship before payment" className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Truck className="h-4 w-4" /> Ship before payment</h2>
        <PayLaterBadge state={p} detail />
        <p className="text-xs text-gray-600">Approved by {p.approvedBy || 'the admin / accounts'} on {formatDateTimeIST(p.approvedAt)}: “{p.reason}”</p>
        {p.payUrl && <p className="text-xs text-gray-600">Payment link: <a className="text-blue-700 underline" href={p.payUrl} target="_blank" rel="noopener noreferrer">{p.payUrl}</a></p>}
      </section>
    );
  }

  if (!data.canApprove) {
    if (!data.why) return null;
    return (
      <section aria-label="Ship before payment" className="text-xs text-gray-500">
        <span className="font-semibold text-gray-700">Ship before payment:</span> not available — {data.why.replace(/^Ship before payment: not available — /, '')}
      </section>
    );
  }

  return (
    <section aria-label="Ship before payment" className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Truck className="h-4 w-4" /> Ship before payment</h2>
      <p className="text-xs text-gray-600">
        For a customer who will only pay after getting the tracking. The order goes to the team now, unpaid. When it is sent,
        the customer gets a payment link. It is due {data.dueDays} days after dispatch
        {typeof data.owed === 'number' && data.owed > 0 ? `. Customers owe ${rupees(data.owed)} on these orders now` : ''}.
      </p>
      {!open ? (
        <button type="button" onClick={() => { setOpen(true); setError(''); }} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-gray-50">
          Ship before payment…
        </button>
      ) : (
        <form className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3" onSubmit={(e) => { e.preventDefault(); approve.mutate(); }} aria-label="Approve ship before payment">
          <label htmlFor={`pay-later-reason-${orderId}`} className="block text-xs font-medium text-gray-700">Why can this customer pay after dispatch?</label>
          <textarea id={`pay-later-reason-${orderId}`} className={input} rows={2} required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Example: Regular dealer, always pays after tracking" />
          <p className="text-xs text-amber-800">The order will ship <strong>without payment</strong>. It is marked paid only when the customer pays the link or accounts confirms a bank transfer.</p>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={approve.isPending || reason.trim().length < 3} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Yes, ship before payment</button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold">Close</button>
          </div>
        </form>
      )}
    </section>
  );
}
