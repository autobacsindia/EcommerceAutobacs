'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  /**
   * `affiliate: null` BUT an application exists under this account's email, unlinked,
   * because the address is not verified yet.
   *
   * Deliberately just a boolean — the server will not send a code, a rate or an earnings
   * figure to someone who has not proven they own the inbox. It exists so the UI can say
   * "verify your email to unlock this" instead of the flatly false "you're not an
   * affiliate yet", which sends them to re-apply into a duplicate-guard dead end.
   */
  needsEmailVerification?: boolean;
  /**
   * The payout floor, in paise, from the server's own config.
   *
   * Sent rather than hardcoded in the UI: the alternative is a number that silently
   * stops matching the server the first time AFFILIATE_MIN_PAYOUT_RUPEES changes, and
   * a dashboard promising a threshold we no longer use is worse than one that is silent.
   */
  minPayoutPaise?: number;
  /** Set when this affiliate has already asked to be paid. Null once a batch is built. */
  payoutRequestedAt?: string | null;
  /**
   * The balance they were shown when they asked.
   *
   * Compared against the live balance so a request that has gone stale — a clawback
   * dropped them back under the floor after they asked — is explained rather than
   * leaving "requested, nothing to do" on screen while nothing will in fact happen.
   */
  payoutRequestedBalancePaise?: number | null;
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

/**
 * Ask to be paid.
 *
 * ⚠️ A SIGNAL, NOT A MONEY ACTION — it sets a flag an admin can see. No amount is sent:
 * the server re-reads the balance from the ledger, because a client-supplied figure is
 * exactly the kind of number this codebase never trusts.
 *
 * NOT optimistic. Payout state is money state, so the button reflects what the server
 * confirmed and nothing sooner — the same rule that keeps price and stock honest.
 */
export function useRequestPayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post<{
      success: boolean; alreadyRequested: boolean; payoutRequestedAt: string; message: string;
    }>(API_ENDPOINTS.AFFILIATE_ME_PAYOUT_REQUEST, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: affiliateKeys.me() }),
  });
}

export interface PayoutQueueRow {
  _id: string;
  code: string | null;
  name: string;
  status: string;
  tdsPercent: number;
  hasBankDetails: boolean;
  payableBalancePaise: number;
  commissionCount: number;
  oldestApprovedAt: string | null;
  payoutRequestedAt: string | null;
}

export interface PayoutQueueResponse {
  success: boolean;
  queue: PayoutQueueRow[];
  minPayoutPaise: number;
  /** Across EVERY due affiliate, not just this page. */
  totalPayablePaise: number;
  dueCount: number;
  hasMore: boolean;
  /** Owed to non-active affiliates: visible, deliberately not in the worklist. */
  suspendedHeld: { heldPaise: number; count: number };
}

/**
 * ADMIN: who is owed at least the minimum payout, in priority order.
 *
 * Goes through TanStack Query rather than a hand-rolled `useEffect` so the key in
 * `affiliateKeys` has a real producer — a key nobody reads under is a key whose
 * invalidation silently does nothing, which is how a screen ends up showing an affiliate
 * who was paid five minutes ago.
 */
export function usePayoutQueue() {
  return useQuery({
    queryKey: affiliateKeys.payoutQueue(),
    queryFn: () => apiClient.get<PayoutQueueResponse>(API_ENDPOINTS.AFFILIATE_PAYOUT_QUEUE),
    // Money state: never serve a stale worklist from cache on revisit.
    staleTime: 0,
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
