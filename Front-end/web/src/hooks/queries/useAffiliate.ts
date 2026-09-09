'use client';

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { affiliateKeys } from './keys';

/**
 * The signed-in user's own affiliate profile and ledger.
 *
 * Both endpoints are scoped to `req.user` server-side — the affiliate id is never read
 * from the query string — so there is nothing to pass and nothing a caller could
 * tamper with to read somebody else's earnings.
 */

export interface AffiliateSummaryEntry { netPaise: number; count: number }

export interface MyAffiliate {
  _id: string;
  code?: string;
  name: string;
  status: 'pending' | 'active' | 'suspended' | 'rejected';
  commissionPercent: number;
  discountPercent: number;
  firstOrderOnly: boolean;
  payoutDetails?: { accountLast4?: string; ifsc?: string; upiId?: string };
}

export interface MyAffiliateResponse {
  success: boolean;
  affiliate: MyAffiliate | null;
  summary?: Record<string, AffiliateSummaryEntry>;
  payableBalancePaise?: number;
}

export interface Commission {
  _id: string;
  type: 'accrual' | 'clawback' | 'adjust';
  amountPaise: number;
  status: 'pending' | 'approved' | 'paid' | 'reversed' | 'void';
  maturesAt?: string | null;
  note?: string;
  createdAt: string;
  order?: { _id: string; totalAmount: number; createdAt: string } | null;
}

interface CommissionsResponse {
  success: boolean;
  commissions: Commission[];
  nextCursor: string | null;
}

export function useMyAffiliate(enabled = true) {
  return useQuery({
    queryKey: affiliateKeys.me(),
    queryFn: () => apiClient.get<MyAffiliateResponse>(API_ENDPOINTS.AFFILIATE_ME),
    enabled,
  });
}

export function useMyCommissions(cursor: string | null, enabled = true) {
  return useQuery({
    queryKey: affiliateKeys.commissions(cursor),
    queryFn: () => {
      const params = new URLSearchParams({ limit: '25' });
      if (cursor) params.set('before', cursor);
      return apiClient.get<CommissionsResponse>(
        `${API_ENDPOINTS.AFFILIATE_ME_COMMISSIONS}?${params}`,
      );
    },
    enabled,
  });
}
