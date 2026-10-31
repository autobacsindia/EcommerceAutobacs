'use client';

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { paymentConfigKeys } from './keys';

/** Same shape check the backend applies — a defence against a proxy/error page body. */
const RAZORPAY_KEY_ID = /^rzp_(test|live)_[A-Za-z0-9]+$/;

async function fetchRazorpayKeyId(): Promise<string | null> {
  const res = await apiClient.get<{ data?: { keyId?: unknown } }>('/payment-config/razorpay', {
    retries: 0,
  });
  const keyId = res?.data?.keyId;
  return typeof keyId === 'string' && RAZORPAY_KEY_ID.test(keyId) ? keyId : null;
}

/**
 * The public Razorpay key id, served by the backend from the SAME env value that signs
 * checkout orders. There is deliberately no build-time NEXT_PUBLIC_* copy: a baked-in key
 * outlives a key rotation, and that is exactly how the EMI strip silently died on every
 * PDP (Razorpay answered the stale key with 401 while checkout kept working).
 *
 * `data` is null when the backend has no valid key (503) or the request failed — callers
 * render nothing in that case. The key only changes on a rotation + backend restart, so
 * one fetch per session is plenty.
 */
export function useRazorpayKeyId() {
  return useQuery({
    queryKey: paymentConfigKeys.razorpay(),
    queryFn: fetchRazorpayKeyId,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
}
