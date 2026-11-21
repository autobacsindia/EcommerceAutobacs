'use client';

import { useEffect, useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, ChevronDown, Factory, FileText, Pencil } from 'lucide-react';
import type { WorkOrder } from '@/components/staff/work/types';
import apiClient from '@/lib/api-client';
import { money, paymentKeys, paymentMoney, slipHref, STATUS_TONE, type OrderPayment, type OrderPayments, type SupplierDeal } from './api';
import SupplierDealCard, { SetUpDealForm } from './SupplierDealCard';
import PaymentRequestForm from './PaymentRequestForm';
import PaymentRequestDetail from './PaymentRequestDetail';
import OrderTypeTag from '@/components/orders/OrderTypeTag';
import { SupplierRefundLine } from './SupplierCredit';
import HoldLine from './HoldLine';

type Line = WorkOrder['lines'][number];
const live = (r: OrderPayment) => r.status !== 'declined' && r.status !== 'cancelled';

/** One order's payments (supplier + linked expenses) and supplier deals — one query, shared by every line. */
export function useOrderSupplierPayments(orderId: string) {
  return useQuery({
    queryKey: paymentKeys.forOrder(orderId),
    queryFn: () => apiClient.get<OrderPayments>(`/payment-requests/order/${orderId}`),
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
export default function LineSupplierPayment({ order, line, requests, deals = [] }: { order: WorkOrder; line: Line; requests: OrderPayment[]; deals?: SupplierDeal[] }) {
  const qc = useQueryClient();
  const [raising, setRaising] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [open, setOpen] = useState<{ id: string; edit: boolean } | null>(null);
  const deal = deals.find((d) => d.itemIds.includes(line.itemId));
  const mine = requests.filter((r) => r.kind !== 'expense' && r.itemIds.includes(line.itemId));
  const covered = mine.some(live);
  const payableStage = line.stage === 'to_ship' || line.stage === 'with_supplier'
    || (line.stage === 'stock_check' && line.actions.includes('ordered'));
  // `canShip`: the server's "procurement (or admin) may act here" — exactly who raises supplier payments.
  const canRaise = order.canShip && payableStage && !covered;
  const previous = [...requests].filter(live).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
  const refresh = () => qc.invalidateQueries({ queryKey: paymentKeys.forOrder(order.id) });

  // Bought from several suppliers: each part shows its own payments (staff/work/SupplierParts).
  if (line.split) return null;
  // Made to order, paid in parts: the deal card holds its payments (shown once, on its first item).
  if (deal) {
    if (deal.itemIds[0] !== line.itemId) {
      return <p className="inline-flex items-center gap-1 text-xs text-indigo-800"><Factory className="h-3.5 w-3.5" /> Paid in parts with {deal.itemNames[0]} — see above</p>;
    }
    return <SupplierDealCard order={order} deal={deal} requests={requests} />;
  }
  if (settingUp) {
    return <SetUpDealForm order={order} line={line} onCancel={() => setSettingUp(false)} onDone={() => {
      setSettingUp(false);
      refresh();
      // The advance was raised with the deal: the line now reads "Payment Pending".
      qc.invalidateQueries({ predicate: (query) => JSON.stringify(query.queryKey).includes(order.id) });
    }} />;
  }

  if (!mine.length && !canRaise) return null;
  return (
    <div className="space-y-2">
      {mine.map((r) => <SupplierPaymentRow key={r.id} r={r} onOpen={(edit) => setOpen({ id: r.id, edit })} />)}
      {canRaise && !raising && (
        <button type="button" onClick={() => setRaising(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-900 hover:bg-amber-200"
          title="Only when ordering from a supplier — our own stock ships without this">
          <Banknote className="h-4 w-4" /> Request supplier payment
        </button>
      )}
      {canRaise && !raising && (
        <button type="button" onClick={() => setSettingUp(true)} className="ml-2 inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-sm font-medium text-indigo-800 hover:bg-indigo-50"
          title="The supplier makes it for this order and is paid an advance first, the balance later">
          <Factory className="h-4 w-4" /> Made to order — pay in parts
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

/**
 * One supplier payment on an order line: number (opens it), amount and payee, its
 * status, Edit while still editable, the slip / receipt — and, once paid for
 * something cancelled or for a supplier that was changed, "Supplier must refund".
 */
export function SupplierPaymentRow({ r, onOpen, muted = false }: { r: OrderPayment; onOpen: (edit: boolean) => void; muted?: boolean }) {
  return (
    <div className="space-y-2">
      <div className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm ${muted ? 'bg-gray-50/60' : 'bg-gray-50'}`}>
        <Banknote className="h-4 w-4 text-emerald-700" />
        <button type="button" onClick={() => onOpen(false)} className="font-medium text-blue-700 hover:underline">{r.number}</button>
        <OrderTypeTag type="procurement" />
        <span className="text-gray-700">{paymentMoney(r)} to {r.payee}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[r.status]}`}>{r.statusLabel}</span>
        {r.canEdit && (
          <button type="button" onClick={() => onOpen(true)} aria-label={`Edit ${r.number}`}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
            <Pencil className="h-3 w-3" /> Edit
          </button>
        )}
        <a href={slipHref(r.id)} target="_blank" rel="noopener noreferrer" className={`${r.canEdit ? '' : 'ml-auto '}inline-flex items-center gap-1 text-xs text-gray-600 hover:underline`}>
          <FileText className="h-3.5 w-3.5" /> {r.status === 'paid' ? 'Receipt' : 'Slip'}
        </a>
        {r.credit && <span className="w-full text-xs text-emerald-800">{money(r.credit.amount, r.currency)} of it from supplier credit</span>}
        <HoldLine hold={r.hold} className="w-full" />
        {r.status === 'declined' && r.decisionNote && <span className="w-full text-xs text-red-800">Declined: {r.decisionNote}</span>}
      </div>
      {r.supplierRefund && (
        <SupplierRefundLine requestId={r.id} refund={r.supplierRefund} currency={r.currency || 'INR'}
          bill={Math.round(((r.currency && r.currency !== 'INR' ? r.foreignAmount ?? 0 : r.amount) + (r.credit?.amount || 0)) * 100) / 100} />
      )}
    </div>
  );
}

/** Done with: nobody has to act on these any more. */
const SETTLED = new Set<OrderPayment['status']>(['approved', 'paid', 'cancelled']);
const SETTLED_OPEN_KEY = 'orderExpenses.settledOpen';

/**
 * Open / closed, remembered in this browser (a per-viewer convenience — closed by
 * default, and when storage is blocked or empty). Read after mount, so the server
 * render and the first client render agree.
 */
function useRememberedOpen(key: string): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(key) === '1') setOpen(true);
    } catch { /* private window / blocked storage: stay closed */ }
  }, [key]);
  const set = (next: boolean) => {
    setOpen(next);
    try {
      window.localStorage.setItem(key, next ? '1' : '0');
    } catch { /* not remembered — still works */ }
  };
  return [open, set];
}

/**
 * Expenses linked to this order (a courier charge, packing, a site visit), and
 * "Add expense for this order" — which raises an ordinary expense with the order
 * linked. Accounts approves and the admin pays it as usual; it never changes what
 * the customer pays, and it never holds the order's items back from shipping.
 */
export function OrderOtherPayments({ order, requests }: { order: WorkOrder; requests: OrderPayment[] }) {
  const qc = useQueryClient();
  const [raising, setRaising] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const expenses = requests.filter((r) => r.kind === 'expense');
  // Owner (2026-11-21): what still needs someone stays on top — waiting, on hold,
  // declined; what is done (approved, paid, cancelled) folds into one dropdown.
  const needsAction = expenses.filter((r) => !SETTLED.has(r.status));
  const settled = expenses.filter((r) => SETTLED.has(r.status));
  const [showSettled, toggleSettled] = useRememberedOpen(SETTLED_OPEN_KEY);
  const settledId = useId();
  const refresh = () => qc.invalidateQueries({ queryKey: paymentKeys.forOrder(order.id) });
  const row = (r: OrderPayment) => (
    <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
      <button type="button" onClick={() => setOpen(r.id)} className="font-medium text-blue-700 hover:underline">{r.number}</button>
      <span className="text-gray-700">{r.categoryLabel} · {paymentMoney(r)} to {r.payee}</span>
      {r.requestedByName && <span className="text-xs text-gray-500">by {r.requestedByName}</span>}
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[r.status]}`}>{r.statusLabel}</span>
      <a href={slipHref(r.id)} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-gray-600 hover:underline">
        <FileText className="h-3.5 w-3.5" /> {r.status === 'paid' ? 'Receipt' : 'Slip'}
      </a>
      <HoldLine hold={r.hold} className="w-full" />
      {r.status === 'declined' && r.decisionNote && <span className="w-full text-xs text-red-800">Declined: {r.decisionNote}</span>}
    </li>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Other payments for this order</p>
        {!raising && (
          <button type="button" onClick={() => setRaising(true)} className="ml-auto inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
            <Banknote className="h-3.5 w-3.5" /> Add expense for this order
          </button>
        )}
      </div>
      {expenses.length === 0 && !raising && <p className="text-sm text-gray-500">None yet.</p>}
      {needsAction.length > 0 && <ul className="space-y-1" aria-label="Expenses still in progress">{needsAction.map(row)}</ul>}
      {settled.length > 0 && (
        <div>
          <button type="button" aria-expanded={showSettled} aria-controls={settledId} onClick={() => toggleSettled(!showSettled)}
            className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
            <ChevronDown className={`h-4 w-4 transition-transform ${showSettled ? '' : '-rotate-90'}`} aria-hidden />
            Approved &amp; closed ({settled.length})
          </button>
          {showSettled && <ul id={settledId} className="mt-1 space-y-1" aria-label="Approved and closed expenses">{settled.map(row)}</ul>}
        </div>
      )}
      {raising && (
        <PaymentRequestForm
          orderLink={{ orderId: order.id, orderNumber: order.orderNumber }}
          onCancel={() => setRaising(false)}
          onDone={() => { setRaising(false); refresh(); }}
        />
      )}
      {open && <PaymentRequestDetail id={open} onClose={() => { setOpen(null); refresh(); }} />}
    </div>
  );
}
