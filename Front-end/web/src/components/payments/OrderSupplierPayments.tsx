'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, FileText, Pencil } from 'lucide-react';
import type { WorkOrder } from '@/components/staff/work/types';
import apiClient from '@/lib/api-client';
import { paymentKeys, rupees, slipHref, STATUS_TONE, type OrderPayment } from './api';
import PaymentRequestForm from './PaymentRequestForm';
import PaymentRequestDetail from './PaymentRequestDetail';
import OrderTypeTag from '@/components/orders/OrderTypeTag';

type Line = WorkOrder['lines'][number];
const live = (r: OrderPayment) => r.status !== 'declined' && r.status !== 'cancelled';

/** The supplier payments raised on one order (one query, shared by every line). */
export function useOrderSupplierPayments(orderId: string) {
  return useQuery({
    queryKey: paymentKeys.forOrder(orderId),
    queryFn: () => apiClient.get<{ requests: OrderPayment[] }>(`/payment-requests/order/${orderId}`),
  });
}

/**
 * One product's supplier payment, on its own line of the order: what was asked
 * for and where it stands, or a "Request supplier payment" button. For a product
 * still at its stock check, raising the payment also records "ordered from this
 * supplier" (the server does both). "Same supplier as …" refills the last
 * supplier used on this order. A product with a payment in flight cannot ship
 * until it is paid — the server enforces that.
 */
export default function LineSupplierPayment({ order, line, requests }: { order: WorkOrder; line: Line; requests: OrderPayment[] }) {
  const qc = useQueryClient();
  const [raising, setRaising] = useState(false);
  const [open, setOpen] = useState<{ id: string; edit: boolean } | null>(null);
  const mine = requests.filter((r) => r.itemIds.includes(line.itemId));
  const covered = mine.some(live);
  const payableStage = line.stage === 'to_ship' || line.stage === 'with_supplier'
    || (line.stage === 'stock_check' && line.actions.includes('ordered'));
  // `canShip`: the server's "procurement (or admin) may act here" — exactly who raises supplier payments.
  const canRaise = order.canShip && payableStage && !covered;
  const previous = [...requests].filter(live).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
  const refresh = () => qc.invalidateQueries({ queryKey: paymentKeys.forOrder(order.id) });

  if (!mine.length && !canRaise) return null;
  return (
    <div className="space-y-2">
      {mine.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
          <Banknote className="h-4 w-4 text-emerald-700" />
          <button type="button" onClick={() => setOpen({ id: r.id, edit: false })} className="font-medium text-blue-700 hover:underline">{r.number}</button>
          <OrderTypeTag type="procurement" />
          <span className="text-gray-700">{rupees(r.amount)} to {r.payee}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[r.status]}`}>{r.statusLabel}</span>
          {r.canEdit && (
            <button type="button" onClick={() => setOpen({ id: r.id, edit: true })} aria-label={`Edit ${r.number}`}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
              <Pencil className="h-3 w-3" /> Edit
            </button>
          )}
          <a href={slipHref(r.id)} target="_blank" rel="noopener noreferrer" className={`${r.canEdit ? '' : 'ml-auto '}inline-flex items-center gap-1 text-xs text-gray-600 hover:underline`}>
            <FileText className="h-3.5 w-3.5" /> {r.status === 'paid' ? 'Receipt' : 'Slip'}
          </a>
        </div>
      ))}
      {canRaise && !raising && (
        <button type="button" onClick={() => setRaising(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-900 hover:bg-amber-200"
          title="Only when ordering from a supplier — our own stock ships without this">
          <Banknote className="h-4 w-4" /> Request supplier payment
        </button>
      )}
      {raising && (
        <PaymentRequestForm
          supplier={{
            orderId: order.id,
            orderNumber: order.orderNumber,
            customer: order.customer.name,
            closedBy: order.source === 'sales' ? `GTM lead: ${order.soldBy}` : 'Website',
            lines: [{ itemId: line.itemId, name: line.variantLabel ? `${line.name} — ${line.variantLabel}` : line.name }],
          }}
          sameAs={previous ? { id: previous.id, name: previous.payee } : undefined}
          onCancel={() => setRaising(false)}
          onDone={() => {
            setRaising(false);
            refresh();
            // The line may have moved to "ordered from supplier".
            qc.invalidateQueries({ predicate: (query) => JSON.stringify(query.queryKey).includes(order.id) });
          }}
        />
      )}
      {open && <PaymentRequestDetail id={open.id} startEditing={open.edit} onClose={() => { setOpen(null); refresh(); }} />}
    </div>
  );
}
