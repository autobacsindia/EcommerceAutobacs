'use client';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import PaymentLinkCard from './PaymentLinkCard';
import { errorMessage, rupees, type SalesOrder, type SalesOrderPage } from './types';

type Mode = 'sales' | 'paid';

/** One status pill per row, in words the team uses. */
function statusOf(o: SalesOrder): { text: string; cls: string } {
  if (o.paymentStatus === 'paid') {
    const after: Record<string, string> = { shipped: 'Paid · shipped', delivered: 'Paid · delivered', cancelled: 'Paid · cancelled' };
    return { text: after[o.status] || 'Paid', cls: 'bg-green-100 text-green-800' };
  }
  if (o.status === 'cancelled') return { text: 'Cancelled', cls: 'bg-gray-200 text-gray-700' };
  if (o.linkState === 'active') return { text: 'Waiting for payment', cls: 'bg-amber-100 text-amber-800' };
  return { text: 'Link expired', cls: 'bg-red-100 text-red-800' };
}

function OrderRow({ order, mode, showSeller }: { order: SalesOrder; mode: Mode; showSeller: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const status = statusOf(order);
  const unpaid = order.paymentStatus !== 'paid' && order.status === 'awaiting_payment';
  const discounted = order.items.some((i) => i.listPrice);

  const done = () => queryClient.invalidateQueries({ queryKey: staffKeys.orders() });
  const relink = useMutation({
    mutationFn: () => apiClient.post(`/staff/sales/orders/${order.id}/payment-link`, {}),
    onSuccess: () => { setError(''); done(); },
    onError: (e) => setError(errorMessage(e, 'Could not create a new link.')),
  });
  const cancel = useMutation({
    mutationFn: () => apiClient.post(`/staff/sales/orders/${order.id}/cancel`, {}),
    onSuccess: () => { setError(''); done(); },
    onError: (e) => setError(errorMessage(e, 'Could not cancel the order.')),
  });
  const busy = relink.isPending || cancel.isPending;

  const a = order.shippingAddress;
  return (
    <li className="rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 p-4 text-left"
      >
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <p className="text-sm font-semibold text-gray-900">
            {order.customer.name} <span className="font-normal text-gray-500">· {order.orderNumber}</span>
          </p>
          <p className="text-xs text-gray-500">
            {formatDateTimeIST(order.createdAt)}
            {showSeller && order.salesPerson ? ` · by ${order.salesPerson}` : ''}
            {` · ${order.items.length} item${order.items.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.cls}`}>{status.text}</span>
        <span className="ml-auto text-right text-sm font-bold text-gray-900 sm:ml-0 sm:w-28">{rupees(order.totalAmount)}</span>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-gray-100 p-4">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {order.items.map((i, idx) => (
                <tr key={idx}>
                  <td className="py-2 pr-2 text-gray-800">
                    {i.name}{i.variantLabel ? ` — ${i.variantLabel}` : ''} <span className="text-gray-500">× {i.quantity}</span>
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {i.listPrice && <span className="mr-2 text-xs text-gray-400 line-through">{rupees(i.listPrice)}</span>}
                    <span className="text-gray-900">{rupees(i.price)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {discounted && <p className="text-xs font-medium text-green-700">Sold at an offer price</p>}

          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Customer</p>
              <p className="text-gray-900">{order.customer.name}</p>
              <p className="text-gray-700">{order.customer.phone}</p>
              <p className="break-all text-gray-700">{order.customer.email}</p>
            </div>
            {a && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Deliver to</p>
                <p className="text-gray-700">
                  {[a.addressLine1, a.addressLine2].filter(Boolean).join(', ')}<br />
                  {[a.city, a.state, a.postalCode].filter(Boolean).join(', ')}
                </p>
              </div>
            )}
            {order.razorpayPaymentId && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Payment</p>
                <p className="font-mono text-xs text-gray-800">{order.razorpayPaymentId}</p>
                {order.paymentMethod && <p className="text-gray-700 capitalize">{order.paymentMethod}</p>}
              </div>
            )}
            {order.salesPerson && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Sold by</p>
                <p className="text-gray-700">{order.salesPerson}</p>
              </div>
            )}
          </div>

          {mode === 'sales' && unpaid && order.linkState === 'active' && order.paymentLinkUrl && (
            <div className="rounded-lg bg-gray-50 p-4">
              <PaymentLinkCard
                url={order.paymentLinkUrl}
                orderNumber={order.orderNumber}
                amount={order.totalAmount}
                customerName={order.customer.name}
                customerPhone={order.customer.phone}
                expiresAt={order.paymentLinkExpiresAt}
              />
            </div>
          )}

          {mode === 'sales' && unpaid && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const msg = order.linkState === 'active'
                    ? 'Send a new link? The current link and QR will stop working.'
                    : 'Create a new payment link for this order?';
                  if (window.confirm(msg)) relink.mutate();
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {relink.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} New payment link
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Cancel order ${order.orderNumber}? The customer will no longer be able to pay for it.`)) cancel.mutate();
                }}
                className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {cancel.isPending ? 'Cancelling…' : 'Cancel order'}
              </button>
            </div>
          )}
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        </div>
      )}
    </li>
  );
}

/**
 * Sales-panel orders. `sales`: the member's own (or, for the head, the team's).
 * `paid`: every paid sales order, for Accounts / Procurement.
 */
export default function SalesOrdersList({ mode }: { mode: Mode }) {
  const endpoint = mode === 'paid' ? '/staff/orders/paid' : '/staff/sales/orders';
  const q = useInfiniteQuery({
    queryKey: mode === 'paid' ? staffKeys.paidOrders() : staffKeys.salesOrders(),
    queryFn: ({ pageParam }) =>
      apiClient.get<SalesOrderPage>(pageParam ? `${endpoint}?cursor=${encodeURIComponent(pageParam)}` : endpoint),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    // Payments land from the customer's phone — keep the list fresh while open.
    refetchInterval: 30_000,
  });

  const orders = q.data?.pages.flatMap((p) => p.orders) ?? [];
  const showSeller = mode === 'paid' || q.data?.pages[0]?.scope === 'team';

  if (q.isPending) {
    return <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading orders…</p>;
  }
  if (q.isError) {
    return <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load orders.')}</p>;
  }
  if (orders.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
        {mode === 'paid' ? 'No paid sales orders yet.' : 'No orders yet. Create one from “New order”.'}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" onClick={() => q.refetch()} disabled={q.isFetching}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      <ul className="space-y-3">
        {orders.map((o) => <OrderRow key={o.id} order={o} mode={mode} showSeller={showSeller} />)}
      </ul>
      {q.hasNextPage && (
        <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}
          className="w-full rounded-lg border border-gray-300 bg-white py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {q.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}
