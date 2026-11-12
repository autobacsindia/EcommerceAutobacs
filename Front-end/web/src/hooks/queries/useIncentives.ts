'use client';

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { incentiveKeys } from './keys';
import type { Champion, LedgerRow, MonthView, RuleVersion, Rules, Slab, Statement, NextSlab } from '@/lib/incentives';

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

/** For the sales board: my month so far. */
export function useMyIncentives(month: string) {
  return useQuery({
    queryKey: incentiveKeys.me(month),
    queryFn: () => apiClient.get<{ month: string; status: string; statement: Statement | null; points: number; slab: string | null; payout: number; next: NextSlab | null; slabs: Slab[] }>(`/incentives/me?month=${month}`),
  });
}
