'use client';

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { incentiveKeys } from './keys';
import type { Champion, LedgerRow, MonthView, RuleVersion, Rules, MyMonth, MyOrdersPage, MyRatings } from '@/lib/incentives';

/** Last month's Incentive Champion, for the staff-panel banner. */
export function useIncentiveChampion(enabled = true) {
  return useQuery({
    queryKey: incentiveKeys.champion(),
    queryFn: () => apiClient.get<{ champion: Champion | null }>('/incentives/champion').then((r) => r.champion),
    enabled,
    staleTime: 10 * 60 * 1000,
  });
}

/** Admin: one month — snapshot when closed, live while open. */
export function useIncentiveMonth(month: string) {
  return useQuery({
    queryKey: incentiveKeys.month(month),
    queryFn: () => apiClient.get<MonthView>(`/incentives/months/${month}`),
  });
}

export function useIncentiveRules() {
  return useQuery({
    queryKey: incentiveKeys.rules(),
    queryFn: () => apiClient.get<{ current: { version: number; effectiveFrom: string; rules: Rules }; versions: RuleVersion[] }>('/incentives/rules'),
  });
}

/** The orders behind one person's month (first page; the API is cursor-paginated). */
export function useIncentiveRows(earnerKey: string | null, month: string, cursor: string | null = null) {
  return useQuery({
    queryKey: [...incentiveKeys.rows(earnerKey || '', month), cursor || ''],
    queryFn: () => apiClient.get<{ rows: LedgerRow[]; nextCursor: string | null }>(
      `/incentives/people/${earnerKey}/rows?month=${month}${cursor ? `&cursor=${cursor}` : ''}`
    ),
    enabled: !!earnerKey,
  });
}

/** My month so far (or a closed month's snapshot) — always the logged-in person. */
export function useMyIncentives(month: string) {
  return useQuery({
    queryKey: incentiveKeys.me(month),
    queryFn: () => apiClient.get<MyMonth>(`/incentives/me?month=${month}`),
  });
}

/** My month, order by order (cursor-paginated). */
export function useMyIncentiveOrders(month: string, cursor: string | null = null) {
  return useQuery({
    queryKey: incentiveKeys.myOrders(month, cursor || ''),
    queryFn: () => apiClient.get<MyOrdersPage>(`/incentives/me/orders?month=${month}${cursor ? `&cursor=${cursor}` : ''}`),
  });
}

/** My customers' ratings — `visible: false` unless the owner allows staff to see them. */
export function useMyIncentiveRatings(month: string) {
  return useQuery({
    queryKey: incentiveKeys.myRatings(month),
    queryFn: () => apiClient.get<MyRatings>(`/incentives/me/ratings?month=${month}`),
  });
}
