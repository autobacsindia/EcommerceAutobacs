'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { ClipboardList, Loader2, Check } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAuth } from '@/context/AuthContext';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

interface MineResponse {
  success: boolean;
  requests: Array<{ _id: string; variantId: string | null }>;
}

/**
 * "Join the waiting list" — shown on the PDP for an ON-BACKORDER target (a simple
 * product, or the selected variant of a variable one). Login-only, exactly like
 * the out-of-stock "Notify me" button: a signed-out shopper is sent to /login and
 * returned here. Idempotent on the backend, so a double-tap is harmless.
 *
 * Joining seeds a warm CRM lead (source `backorder_waitlist`) and surfaces the
 * shopper under the admin Stock Requests → "On backorder" list. Unlike restock,
 * there is NO automatic email — sales follow up manually. `variantId` scopes the
 * signup to the exact model on a variable product (null for a simple one).
 */
export default function JoinWaitlistButton({
  productId,
  variantId = null,
  className = '',
}: {
  productId: string;
  variantId?: string | null;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();

  const [loading, setLoading] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const joined = requestId !== null;

  // Resolve the caller's pending waitlist request id for THIS exact target
  // (variant-aware), or null if none. Scoped to the backorder list via `kind`.
  const findMyRequestId = useCallback(async (): Promise<string | null> => {
    const res = await apiClient.get<MineResponse>(
      `${API_ENDPOINTS.STOCK_NOTIFICATIONS_MINE}?productId=${productId}&kind=backorder`
    );
    const match = res.requests?.find((r) => (r.variantId ?? null) === (variantId ?? null));
    return match?._id ?? null;
  }, [productId, variantId]);

  // Hydrate so a returning shopper sees "You're on the waiting list".
  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated) {
      setRequestId(null);
      return;
    }
    (async () => {
      try {
        const id = await findMyRequestId();
        if (!cancelled) setRequestId(id);
      } catch {
        // Non-critical — leave the CTA in its default (not-joined) state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, findMyRequestId]);

  const join = useCallback(async () => {
    if (!isAuthenticated) {
      router.push(`/login?redirect=${encodeURIComponent(pathname)}`);
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.post<{ success: boolean; request?: { _id: string } }>(
        API_ENDPOINTS.JOIN_WAITLIST(productId),
        { variantId: variantId ?? undefined }
      );
      const id = res.request?._id ?? (await findMyRequestId());
      setRequestId(id);
      toast.success("You're on the waiting list — our team will reach out about availability.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add you to the list. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, productId, variantId, router, pathname, findMyRequestId]);

  const leave = useCallback(async () => {
    setLoading(true);
    try {
      const id = requestId ?? (await findMyRequestId());
      if (id) await apiClient.delete(API_ENDPOINTS.STOCK_NOTIFICATION_CANCEL(id));
      setRequestId(null);
      toast.success("Okay — we've taken you off the waiting list.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [requestId, findMyRequestId]);

  if (joined) {
    return (
      <div className={`flex flex-col gap-1.5 ${className}`}>
        <div className="flex items-center justify-center gap-2.5 border border-gold/50 bg-gold/10 py-4 font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">
          <Check className="h-4 w-4" />
          You&apos;re on the waiting list
        </div>
        <button
          onClick={leave}
          disabled={loading}
          className="self-center text-[11px] uppercase tracking-[0.14em] text-ink-muted underline-offset-4 transition-colors hover:text-gold hover:underline disabled:opacity-40"
        >
          {loading ? 'Updating…' : 'Leave the list'}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={join}
      disabled={loading}
      className={`flex items-center justify-center gap-3 bg-gold py-4 font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-obsidian transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
      {loading ? 'One moment…' : 'Join the waiting list'}
    </button>
  );
}
