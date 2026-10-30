'use client';

/**
 * The customer refund, for accounts. Every figure here is the SERVER's: the screen asks
 * for a preview of exactly the choices on screen and the button shows that number; the
 * refund route recomputes it again before anything is paid. Nothing is added up here.
 *
 *   - Razorpay orders: accounts sends it (up to ₹25,000; above that the accounts head
 *     or an admin).
 *   - Bank-transfer / cash orders: an admin records the payout with the UTR, in
 *     Admin → Returns. Accounts sees why the button is not here.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { errorMessage, rupees } from '@/components/staff/sales/types';
import type { RefundPreview, ReturnDetail } from './types';
import { input, primary, secondary } from './ui';

type PreviewRes = { success: boolean; preview: RefundPreview };

const Line = ({ k, v, strong }: { k: string; v: string; strong?: boolean }) => (
  <div className={`flex justify-between gap-4 ${strong ? 'font-semibold text-gray-900' : 'text-gray-700'}`}><span>{k}</span><span>{v}</span></div>
);

export default function ReturnRefundBox({ r }: { r: ReturnDetail }) {
  const qc = useQueryClient();
  const [services, setServices] = useState<string[]>([]);
  const [creditNoteNo, setCreditNoteNo] = useState('');
  // Money that leaves us cannot be pulled back: the first press only asks, the second sends.
  // Any change to what is ticked drops back to the first step, so the amount confirmed is
  // always the amount on screen.
  const [confirming, setConfirming] = useState(false);
  const done = r.refundDetail?.status === 'completed' || r.refundDetail?.status === 'processing';
  const choices = { serviceLines: services.map((orderItemId) => ({ orderItemId })) };

  const preview = useQuery({
    queryKey: staffKeys.returnPreview(r.id, choices),
    queryFn: () => apiClient.post<PreviewRes>(`/staff/returns/${r.id}/refund-preview`, choices),
    enabled: r.can.refund && !done,
    retry: false,
  });

  const send = useMutation({
    mutationFn: () => apiClient.post(`/staff/returns/${r.id}/refund`, { ...choices, creditNoteNo: creditNoteNo.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: staffKeys.returns() });
    },
  });

  if (done) {
    const d = r.refundDetail!;
    return (
      <section className="space-y-1 rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
        <h4 className="font-semibold text-green-900">Refund {d.status === 'completed' ? 'sent' : 'on its way'}: {rupees(d.finalAmount || 0)}</h4>
        <Line k="Item(s)" v={rupees(d.productValue || 0)} />
        {!!d.shippingShare && <Line k="Delivery charge share" v={`+ ${rupees(d.shippingShare)}`} />}
        {(d.serviceLines || []).map((l) => <Line key={l.orderItemId} k={l.name} v={`+ ${rupees(l.amountPaise / 100)}`} />)}
        {!!d.pickupDeduction && <Line k={`Pickup cost${d.pickupDeductionReason ? ` (${d.pickupDeductionReason})` : ''}`} v={`− ${rupees(d.pickupDeduction)}`} />}
        {d.creditNoteNo && <Line k="GST credit note" v={d.creditNoteNo} />}
      </section>
    );
  }

  if (r.refundRoute === 'offline') {
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        This order was paid by bank transfer or cash, so the refund is paid by an admin, who records the UTR in Admin → Returns.
      </section>
    );
  }

  const p = preview.data?.preview;
  const capped = p && p.refundNow < p.breakdown.total;
  return (
    <section className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
      <h4 className="font-semibold text-gray-900">Refund to the customer&apos;s original payment</h4>
      {preview.isPending && <p className="flex items-center gap-2 text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Working out the refund…</p>}
      {preview.isError && <p role="alert" className="text-xs text-red-700">{errorMessage(preview.error, 'Could not work out the refund.')}</p>}
      {p && (
        <>
          <div className="space-y-1 rounded bg-white p-2">
            <Line k="Item(s) — what the customer paid" v={rupees(p.breakdown.goodsNet)} />
            {p.breakdown.shippingShare > 0 && <Line k="Delivery charge share (our fault)" v={`+ ${rupees(p.breakdown.shippingShare)}`} />}
            {p.breakdown.service > 0 && <Line k="Installation (our fault)" v={`+ ${rupees(p.breakdown.service)}`} />}
            {p.breakdown.pickupDeduction > 0 && <Line k="Pickup cost (customer's reason)" v={`− ${rupees(p.breakdown.pickupDeduction)}`} />}
            {p.breakdown.restocking > 0 && <Line k="Restocking" v={`− ${rupees(p.breakdown.restocking)}`} />}
            <Line k="Refund" v={rupees(p.refundNow)} strong />
            {capped && <p className="text-xs text-amber-700">Capped at what is left of what the customer paid on this order.</p>}
          </div>
          {p.hasOurFault && p.serviceLineOptions.length > 0 && (
            <fieldset className="space-y-1">
              <legend className="text-xs font-semibold text-gray-700">Installation on the bill to refund (our fault)</legend>
              {p.serviceLineOptions.map((o) => (
                <label key={o.orderItemId} className={`flex items-center gap-2 text-xs ${o.alreadyRefunded ? 'opacity-50' : ''}`}>
                  <input type="checkbox" disabled={o.alreadyRefunded} checked={services.includes(o.orderItemId)}
                    onChange={(e) => { setConfirming(false); setServices(e.target.checked ? [...services, o.orderItemId] : services.filter((x) => x !== o.orderItemId)); }} />
                  {o.name} — paid {rupees(o.netPaid)}{o.alreadyRefunded ? ' (already refunded)' : ''}
                </label>
              ))}
            </fieldset>
          )}
          <input className={input} placeholder="GST credit note number (optional)" value={creditNoteNo} onChange={(e) => setCreditNoteNo(e.target.value)} />
          {p.fullRefundOnly && p.refundNow < p.orderTotal && (
            <p className="text-xs text-red-700">Paid by {p.paidBy || 'Debit Card EMI'}: the bank only refunds the full order. Ask an admin to settle it.</p>
          )}
          {!p.canSend && (
            <p className="text-xs text-amber-800">Refunds above {rupees(p.limit)} are sent by the accounts head or an admin.</p>
          )}
          {confirming ? (
            <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-2" role="group" aria-label="Confirm the refund">
              <p className="text-xs font-semibold text-amber-900">
                Send {rupees(p.refundNow)} to the customer&apos;s original payment? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button type="button" className={primary} disabled={send.isPending || preview.isFetching} onClick={() => send.mutate()}>
                  {send.isPending ? 'Sending…' : `Yes, send ${rupees(p.refundNow)}`}
                </button>
                <button type="button" className={secondary} disabled={send.isPending} onClick={() => setConfirming(false)}>Back</button>
              </div>
            </div>
          ) : (
            <button type="button" className={primary}
              disabled={send.isPending || preview.isFetching || !p.canSend || p.refundNow <= 0 || (p.fullRefundOnly && p.refundNow < p.orderTotal)}
              onClick={() => setConfirming(true)}>
              {`Send refund of ${rupees(p.refundNow)}`}
            </button>
          )}
        </>
      )}
      {send.isError && <p role="alert" className="text-xs text-red-700">{errorMessage(send.error, 'The refund could not be sent.')}</p>}
    </section>
  );
}
