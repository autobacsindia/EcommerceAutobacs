'use client';

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import type { WorkOrder } from '@/components/staff/work/types';
import OrderJourney from './OrderJourney';

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
  if (!q.data?.order) return null;
  return <OrderJourney order={q.data.order} />;
}
