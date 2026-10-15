'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, FileText } from 'lucide-react';
import type { WorkOrder } from '@/components/staff/work/types';
import apiClient from '@/lib/api-client';
import { paymentKeys, rupees, slipHref, STATUS_TONE, type OrderPayment } from './api';
import PaymentRequestForm from './PaymentRequestForm';
import PaymentRequestDetail from './PaymentRequestDetail';

/**
 * Supplier payments on one order (procurement's order panel): what has been
 * asked for, where each stands, and a button to ask for the next. An item with
 * a payment still in flight cannot ship until it is paid — the server enforces
 * that; this only says so.
 */
export default function OrderSupplierPayments({ order }: { order: WorkOrder }) {
  const qc = useQueryClient();
  const [raising, setRaising] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: paymentKeys.forOrder(order.id),
    queryFn: () => apiClient.get<{ requests: OrderPayment[] }>(`/payment-requests/order/${order.id}`),
  });
  const requests = q.data?.requests ?? [];
  const covered = new Set(requests.filter((r) => r.status !== 'declined' && r.status !== 'cancelled').flatMap((r) => r.itemIds));
  const payable = order.lines
    .filter((l) => (l.stage === 'to_ship' || l.stage === 'with_supplier') && !covered.has(l.itemId))
    .map((l) => ({ itemId: l.itemId, name: l.variantLabel ? `${l.name} — ${l.variantLabel}` : l.name }));
  // `canShip` is the server's "procurement (or admin) may act on shipping here" —
  // exactly who raises supplier payments.
  const canRaise = order.canShip && payable.length > 0;

  if (!requests.length && !canRaise) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Supplier payments</p>
      {requests.length > 0 && (
        <ul className="divide-y rounded-lg border border-gray-200">
          {requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <button type="button" onClick={() => setOpen(r.id)} className="font-medium text-blue-700 hover:underline">{r.number}</button>
              <span className="text-gray-700">{rupees(r.amount)} to {r.payee} · {r.itemNames.join(', ')}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[r.status]}`}>{r.statusLabel}</span>
              <a href={slipHref(r.id)} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-gray-600 hover:underline">
                <FileText className="h-3.5 w-3.5" /> {r.status === 'paid' ? 'Receipt' : 'Slip'}
              </a>
            </li>
          ))}
        </ul>
      )}
      {canRaise && !raising && (
        <button type="button" onClick={() => setRaising(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50">
          <Banknote className="h-4 w-4 text-emerald-700" /> Request supplier payment
        </button>
      )}
      {raising && (
        <PaymentRequestForm
          supplier={{
            orderId: order.id,
            orderNumber: order.orderNumber,
            customer: order.customer.name,
            closedBy: order.source === 'sales' ? `GTM lead: ${order.soldBy}` : 'Website',
            lines: payable,
          }}
          onCancel={() => setRaising(false)}
          onDone={() => { setRaising(false); qc.invalidateQueries({ queryKey: paymentKeys.forOrder(order.id) }); }}
        />
      )}
      {open && <PaymentRequestDetail id={open} onClose={() => { setOpen(null); qc.invalidateQueries({ queryKey: paymentKeys.forOrder(order.id) }); }} />}
    </div>
  );
}
