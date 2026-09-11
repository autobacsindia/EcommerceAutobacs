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

/**
 * Mirrors `toSelfView` in Back-end/server/services/affiliateService.js EXACTLY.
 *
 * That function is a whitelist, so this type is the whole response — not a convenient
 * subset of a larger document. Keep the two in step: an earlier version of this
 * interface omitted fields the endpoint was in fact sending (the admin-only `notes`
 * among them), and because TypeScript describes nothing about the wire, the leak was
 * invisible here. A field absent from this type is now a field absent from the JSON.
 */
export interface MyAffiliate {
  _id: string;
  /** Absent until approval — a pending application has no code yet. */
  code: string | null;
  name: string;
  status: 'pending' | 'active' | 'suspended' | 'rejected';
  commissionPercent: number;
  /** `null` means "no separate repeat rate"; `0` means repeats earn nothing. */
  repeatCommissionPercent: number | null;
  discountPercent: number;
  approvedAt: string | null;
  createdAt: string;
  payoutDetails: { accountLast4: string | null; ifsc: string | null; upiId: string | null };
  termsAcceptance: { version: string | null; acceptedAt: string | null };
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
