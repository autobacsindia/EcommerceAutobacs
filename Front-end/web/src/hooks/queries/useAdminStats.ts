'use client';

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { adminKeys } from './keys';

/** Order fulfilment statuses behind each counter, as reported by the backend. */
export interface AdminStatFilters {
  pendingOrders: string[];
  totalRevenue: string[];
}

export interface AdminStats {
  totalOrders: number;
  pendingOrders: number;
  /** Rupees (Order.totalAmount is rupees, not paise). */
  totalRevenue: number;
  totalProducts: number;
  totalUsers: number;
  filters?: AdminStatFilters;
}

const EMPTY_STATS: AdminStats = {
  totalOrders: 0,
  pendingOrders: 0,
  totalRevenue: 0,
  totalProducts: 0,
  totalUsers: 0,
};

async function fetchAdminStats(): Promise<AdminStats> {
  const data = await apiClient.get<{ success?: boolean; stats?: Partial<AdminStats> }>(
    '/admin/stats'
  );
  return { ...EMPTY_STATS, ...(data?.stats ?? {}) };
}

/**
 * Admin header counters. Shared across every admin screen via one query key, so
 * navigating between admin pages reuses the cached value instead of re-fetching,
 * and the 30s poll runs once no matter how many components read it.
 *
 * `retry: false` on purpose: a 401 here means the admin session expired, and the
 * page-level auth guard is what should react to that — not a retry storm.
 */
export function useAdminStats() {
  const query = useQuery({
    queryKey: adminKeys.stats(),
    queryFn: fetchAdminStats,
    refetchInterval: 30_000,
    staleTime: 30_000,
    retry: false,
  });

  return { ...query, stats: query.data ?? EMPTY_STATS };
}
