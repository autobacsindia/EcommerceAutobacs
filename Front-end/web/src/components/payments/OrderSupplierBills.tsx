'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Banknote, FileText, Receipt } from 'lucide-react';
import { money, paymentMoney, slipHref, STATUS_TONE, type OrderPayment } from './api';
import { BillDetails } from './SupplierBills';
import PaymentRequestDetail from './PaymentRequestDetail';
import type { SupplierBill } from './supplierBillsApi';
import { useOrderSupplierPayments } from './OrderSupplierPayments';
import HoldLine from './HoldLine';

const BILL_TONE: Record<SupplierBill['state'], string> = {
  unpaid: 'bg-gray-100 text-gray-800',
  part_paid: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-200 text-gray-600',
};

/**
 * Supplier bills ("We owe suppliers") linked to this order: "Supplier bill SB-0001 ·
 * RK New Popular · ₹75,000 · Part paid", with what is paid / owed and — opened — its
 * payments (each opens in full). The bill's own row links back to this order, so the
 * link works both ways. The server sends bills only to procurement, accounts and the
 * admin; for anyone else the list is empty and nothing shows.
 */
export default function OrderSupplierBills({ bills, listHref }: { bills: SupplierBill[]; listHref: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!bills.length) return null;
  return (
    <div className="space-y-2" aria-label="Supplier bills for this order">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Supplier bills for this order</p>
        <Link href={listHref} className="ml-auto text-xs font-medium text-blue-700 hover:underline">All bills we owe →</Link>
      </div>
      <ul className="space-y-1">
        {bills.map((b) => (
          <li key={b.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Receipt className="h-4 w-4 text-indigo-700" />
              <button type="button" onClick={() => setOpen(open === b.id ? null : b.id)} aria-expanded={open === b.id} className="font-medium text-blue-700 hover:underline">
                Supplier bill {b.number}
              </button>
              <span className="text-gray-700">
                {b.supplier.name}{b.billNumber ? ` · bill ${b.billNumber}` : ''} · {b.amount == null ? 'amount not known yet' : money(b.amount)}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BILL_TONE[b.state]}`}>{b.stateLabel}</span>
              {b.amount != null && (
                <span className="ml-auto text-xs text-gray-600">
                  {money(b.paid)} paid{b.owed ? ` · ${money(b.owed)} owed` : ''}{b.waiting ? ` · ${money(b.waiting)} waiting` : ''}
                </span>
              )}
            </div>
            {b.payments.length > 0 && open !== b.id && (
              <p className="mt-1 text-xs text-gray-600">
                Payments: {b.payments.map((p) => `${p.number} (${p.statusLabel.toLowerCase()})`).join(', ')}
              </p>
            )}
            {open === b.id && <BillDetails id={b.id} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The admin order page: every payment raised for this order (supplier payments for its
 * items, expenses linked to it) and the supplier bills linked to it — each opens in
 * full. One query, shared with the team order view.
 */
export function AdminOrderPayments({ orderId }: { orderId: string }) {
  const q = useOrderSupplierPayments(orderId);
  const [open, setOpen] = useState<string | null>(null);
  const requests = q.data?.requests ?? [];
  const bills = q.data?.bills ?? [];
  if (q.isPending || q.isError || (!requests.length && !bills.length)) return null;
  const row = (r: OrderPayment) => (
    <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
      <Banknote className="h-4 w-4 text-emerald-700" />
      <button type="button" onClick={() => setOpen(r.id)} className="font-medium text-blue-700 hover:underline">{r.number}</button>
      <span className="text-gray-700">
        {r.kind === 'expense' ? r.categoryLabel : `Supplier${r.itemNames.length ? ` — ${r.itemNames.join(', ')}` : ''}`} · {paymentMoney(r)} to {r.payee}
      </span>
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[r.status]}`}>{r.statusLabel}</span>
      <a href={slipHref(r.id)} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-gray-600 hover:underline">
        <FileText className="h-3.5 w-3.5" /> {r.status === 'paid' ? 'Receipt' : 'Slip'}
      </a>
      {r.credit && <span className="w-full text-xs text-emerald-800">{money(r.credit.amount, r.currency)} of it from supplier credit</span>}
      <HoldLine hold={r.hold} className="w-full" />
    </li>
  );
  return (
    <section className="space-y-3" aria-label="Payments for this order">
      <h2 className="text-lg font-semibold text-gray-900">Payments for this order</h2>
      {requests.length > 0 && <ul className="space-y-1" aria-label="Payment requests for this order">{requests.map(row)}</ul>}
      <OrderSupplierBills bills={bills} listHref="/admin/payments?view=owe" />
      {open && <PaymentRequestDetail id={open} onClose={() => { setOpen(null); q.refetch(); }} />}
    </section>
  );
}
