'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { errorMessage } from '@/components/staff/sales/types';
import WorkOrderPanel from '@/components/staff/work/WorkOrderPanel';
import { entityHref, viewerOf } from '@/lib/entityLinks';

/**
 * One order on its own page, for the teams that work orders from a list —
 * procurement, accounts, operations and the GTM head. It is the same panel the
 * list rows open (WorkOrderPanel, /staff/work/orders/:id), so an order number
 * clicked anywhere in the panel (Payments, Approvals, a task) lands here.
 *
 * The API decides per order (an order a team can't see yet answers "not
 * found"); this only keeps other roles from a page that would refuse them.
 */
export default function TeamOrderPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const viewer = viewerOf(user);
  const allowed = !!id && entityHref('order', { id }, viewer) === `/team/orders/${encodeURIComponent(id)}`;
  const back = viewer?.role === 'staff' && viewer.team === 'procurement' ? '/team/procurement' : '/team/orders';
  // Same query (and cache entry) as WorkOrderPanel, so this costs no extra request.
  const order = useQuery({
    queryKey: staffKeys.workOrder(id),
    queryFn: () => apiClient.get(`/staff/work/orders/${id}`),
    enabled: allowed,
    retry: false,
  });

  return (
    <div className="max-w-4xl space-y-4">
      <Link href={back} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to orders
      </Link>
      <h1 className="text-2xl font-bold text-gray-900">Order</h1>
      {!user ? null : allowed ? (
        // The API only shows a team the orders on its lists (paid, or in the workflow).
        // Say so plainly instead of a bare "Order not found".
        order.isError ? (
          <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            {errorMessage(order.error, 'Could not load this order.')} An order shows here once it is on your team&rsquo;s
            lists — for example, a GTM order reaches accounts and procurement after it is paid.
          </p>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <WorkOrderPanel orderId={id} />
          </div>
        )
      ) : (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Orders open from your own lists — this page is for procurement, accounts, operations and the GTM head.
        </p>
      )}
    </div>
  );
}
