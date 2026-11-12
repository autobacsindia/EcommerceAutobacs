'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import DiscountApprovalPanel from '@/components/staff/sales/DiscountApprovalPanel';
import QuoteDiscountSummary from '@/components/staff/sales/QuoteDiscountSummary';
import { errorMessage, rupees, type QuotationPage } from '@/components/staff/sales/types';

const PARAMS = { status: 'approval' };

/**
 * Admin: GTM discounts above 10% waiting for approval ("prior approval mandatory").
 * The GTM head approves the same requests from the team panel; whoever decides
 * first wins and the other sees it decided.
 */
export default function AdminDiscountApprovalsPage() {
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: staffKeys.quotationList(PARAMS),
    queryFn: () => apiClient.get<QuotationPage>('/staff/sales/quotations?status=approval'),
  });
  const rows = q.data?.quotations ?? [];
  return (
    <div className="max-w-4xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Discount approvals</h1>
          <p className="text-sm text-gray-500">GTM quotations with more than 10% off the website price. They cannot be shared or accepted until approved.</p>
        </div>
        <button type="button" onClick={() => q.refetch()} disabled={q.isFetching}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {q.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load the requests.')}</p>}
      {!q.isPending && !q.isError && rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">No discount requests waiting.</p>
      )}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold text-gray-900">{r.number} · {r.customer.name}</p>
              <p className="text-xs text-gray-500">{r.salesPerson}</p>
            </div>
            <ul className="divide-y divide-gray-100 text-sm">
              {r.items.map((l, i) => (
                <li key={i} className="flex justify-between gap-3 py-1.5">
                  <span className="min-w-0 text-gray-800">
                    {l.variantLabel ? `${l.name} — ${l.variantLabel}` : l.name}
                    <span className="ml-1 text-xs text-gray-500">
                      {l.quantity} × {rupees(l.price)}{l.listPrice ? <span className="ml-1 line-through">{rupees(l.listPrice)}</span> : null}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium">{rupees(l.price * l.quantity)}</span>
                </li>
              ))}
            </ul>
            <QuoteDiscountSummary subtotal={r.subtotal} discount={r.discount} total={r.totalAmount} />
            {/* An admin may decide on any waiting request; the server checks again. */}
            <DiscountApprovalPanel quote={{ ...r, approval: r.approval && { ...r.approval, canDecide: true } }}
              onChanged={() => queryClient.invalidateQueries({ queryKey: staffKeys.quotations() })} />
          </li>
        ))}
      </ul>
    </div>
  );
}
