'use client';

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { adminKeys } from './keys';

/** Order fulfilment statuses behind each counter, as reported by the backend. */
export interface AdminStatFilters {
  pendingOrders: string[];
  totalRevenue: string[];
}

/** The window `totalRevenue` covers — the Indian financial year to date. */
export interface AdminRevenuePeriod {
  /** e.g. "FY 26-27" */
  label: string;
  /** "YYYY-MM-DD", store-timezone anchored — feeds the Orders date filter directly. */
  startDate: string;
}

/** Whole-company revenue, FY to date, incl. GST: Zoho bills after refunds + panel orders not billed in Zoho. */
export interface CompanyRevenueTile {
  total: number;
  /** Every Zoho Books invoice, net of credit notes. */
  zoho: number;
  zohoExGst: number;
  /** Website / old website / sales-panel orders that no Zoho invoice stands for yet. */
  panelNotInZoho: number;
  /** Zoho credit notes (refunds) already taken off `zoho`. */
  creditNotes: number;
  basis: 'incl_gst';
  period: { kind: 'fy' | 'all'; label: string; startDate: string | null };
  /** Zoho bills that probably are a website order (counted once, as the bill) — an admin should confirm. */
  needsCheck: { count: number; total: number };
}

/** FY sales: Zoho bills still a sale after credit notes + panel orders not billed in Zoho. */
export interface SalesTile {
  total: number;
  website: { total: number; delivered: number; shipped: number; processing: number };
  zoho: number;
  /** Zoho bills fully cancelled by a credit note — NOT in `total`. */
  zohoCancelled: number;
  fyLabel: string;
}

export interface AdminStats {
  totalOrders: number;
  pendingOrders: number;
  /** Rupees, financial-year to date (Order.totalAmount is rupees, not paise). */
  totalRevenue: number;
  totalProducts: number;
  totalUsers: number;
  revenuePeriod?: AdminRevenuePeriod;
  filters?: AdminStatFilters;
  companyRevenue?: CompanyRevenueTile;
  sales?: SalesTile;
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
