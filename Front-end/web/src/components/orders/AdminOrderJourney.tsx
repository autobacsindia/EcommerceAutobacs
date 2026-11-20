'use client';

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import type { WorkOrder } from '@/components/staff/work/types';
import OrderJourney from './OrderJourney';
import { SupplierChanges } from '@/components/staff/work/SupplierParts';
import ParcelOverdueReason from '@/components/staff/work/ParcelOverdueReason';
import { formatEtaDay } from '@/components/staff/work/ParcelEta';

/**
 * The journey tracker on the admin order page. It reads the same team-workflow
 * view the team panel uses (GET /staff/work/orders/:id — admins may read any
 * order), under the same query key, so a team action that refreshes one
 * refreshes the other. Anyone the endpoint refuses (the marketing panel's
 * view-only reader) simply sees no tracker.
 */
export default function AdminOrderJourney({ orderId }: { orderId: string }) {
  const q = useQuery({
    queryKey: staffKeys.workOrder(orderId),
    queryFn: () => apiClient.get<{ order: WorkOrder }>(`/staff/work/orders/${orderId}`),
    retry: false,
  });
  if (q.isError) return <p className="text-sm text-gray-500">The team journey is not available for this order.</p>;
  if (!q.data?.order) return null;
  // The summary above already shows the customer, money and paid date.
  const order = q.data.order;
  // Items bought from several suppliers, or whose supplier was changed: who supplies
  // what now, and the change history ("G S Enterprises → Trek N Trade · by … · why").
  const supplied = order.lines.filter((l) => l.split && (l.supplierParts ?? []).length > 0);
  return (
    <>
      <OrderJourney order={order} showFacts={false} />
      <OverdueParcels order={order} />
      {supplied.length > 0 && (
        <section className="mt-4 space-y-3 rounded-lg bg-white p-4 shadow" aria-label="Suppliers">
          <h2 className="text-sm font-semibold text-gray-900">Suppliers</h2>
          {supplied.map((l) => (
            <div key={l.itemId} className="space-y-2 border-t border-gray-100 pt-2 first:border-0 first:pt-0">
              <p className="text-sm font-medium text-gray-900">{l.variantLabel ? `${l.name} — ${l.variantLabel}` : l.name}</p>
              <ul className="space-y-0.5 text-sm text-gray-700">
                {(l.supplierParts ?? []).filter((p) => p.status === 'active').map((p) => (
                  <li key={p.id}>{p.what ? `${p.what}: ` : ''}<span className="font-medium">{p.supplierName}</span>
                    <span className="text-gray-500"> · {p.state === 'ordered' ? 'ordered' : p.state === 'payment_pending' ? `payment pending${p.paymentRef ? ` (${p.paymentRef})` : ''}` : 'to order'}</span>
                  </li>
                ))}
              </ul>
              <SupplierChanges parts={l.supplierParts ?? []} />
            </div>
          ))}
        </section>
      )}
    </>
  );
}

/**
 * Parcels past their expected delivery date, or ever explained: the reason for
 * overdue (procurement's, or the admin's own — the server decides who may edit).
 */
function OverdueParcels({ order }: { order: WorkOrder }) {
  const parcels = order.parcels.filter((p) => p.etaState === 'overdue' || (p.overdueReasonHistory ?? []).length > 0);
  if (!parcels.length) return null;
  return (
    <section className="mt-4 space-y-3 rounded-lg bg-white p-4 shadow" aria-label="Overdue parcels">
      <h2 className="text-sm font-semibold text-gray-900">Overdue parcels</h2>
      {parcels.map((p) => (
        <div key={p.id} className="space-y-1 border-t border-gray-100 pt-2 first:border-0 first:pt-0">
          <p className="text-sm text-gray-900">
            Parcel {p.sequence}{p.courier ? ` · ${p.courier}` : ''}{p.eta?.date ? ` · expected ${formatEtaDay(p.eta.date)}` : ''}
            {p.etaState === 'overdue' && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 ring-1 ring-red-300">Overdue</span>}
          </p>
          <ParcelOverdueReason orderId={order.id} parcel={p} />
        </div>
      ))}
    </section>
  );
}
