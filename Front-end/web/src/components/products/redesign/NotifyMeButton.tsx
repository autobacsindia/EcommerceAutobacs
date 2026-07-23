'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Bell, BellRing, Check } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAuth } from '@/context/AuthContext';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

interface MineResponse {
  success: boolean;
  requests: Array<{ _id: string; variantId: string | null }>;
}

/**
 * "Notify me when available" — shown on the PDP for an out-of-stock target
 * (a simple product, or the selected variant of a variable one). Login-only:
 * a signed-out shopper is sent to /login and returned here. Idempotent on the
 * backend, so a double-tap is harmless.
 *
 * `variantId` is the selected variant's id for a variable product, or null for a
 * simple product — it scopes the subscription so a shopper only hears about the
 * exact model they were looking at.
 */
export default function NotifyMeButton({
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
  const subscribed = requestId !== null;

  // Resolve the caller's pending request id for THIS exact target (variant-aware),
  // or null if none. Single source of truth for hydrate + the cancel fallback.
  const findMyRequestId = useCallback(async (): Promise<string | null> => {
    const res = await apiClient.get<MineResponse>(
      `${API_ENDPOINTS.STOCK_NOTIFICATIONS_MINE}?productId=${productId}`
    );
    const match = res.requests?.find((r) => (r.variantId ?? null) === (variantId ?? null));
    return match?._id ?? null;
  }, [productId, variantId]);

  // Hydrate the subscribed state so a returning shopper sees "You're on the list"
  // instead of a fresh CTA.
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
        // Non-critical — leave the CTA in its default (unsubscribed) state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, findMyRequestId]);

  const subscribe = useCallback(async () => {
    if (!isAuthenticated) {
      router.push(`/login?redirect=${encodeURIComponent(pathname)}`);
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.post<{ success: boolean; request?: { _id: string } }>(
        API_ENDPOINTS.NOTIFY_ME(productId),
        { variantId: variantId ?? undefined }
      );
      // The endpoint returns the request id (even for an existing signup). On the
      // rare chance it's absent, resolve it via /mine so we always hold a real,
      // cancellable id — never a UI-only placeholder.
      const id = res.request?._id ?? (await findMyRequestId());
      setRequestId(id);
      toast.success("Great — we'll email you when it's back in stock.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not register you. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, productId, variantId, router, pathname, findMyRequestId]);

  const unsubscribe = useCallback(async () => {
    setLoading(true);
    try {
      // Always cancel against a real server id — resolve it if we somehow only have
      // a stale/placeholder state, so "Cancel alert" can never be a silent no-op.
      const id = requestId ?? (await findMyRequestId());
      if (id) await apiClient.delete(API_ENDPOINTS.STOCK_NOTIFICATION_CANCEL(id));
      setRequestId(null);
      toast.success("Okay — we won't notify you about this item.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [requestId, findMyRequestId]);

  if (subscribed) {
    return (
      <div className={`flex flex-col gap-1.5 ${className}`}>
        <div className="flex items-center justify-center gap-2.5 border border-gold/50 bg-gold/10 py-4 font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">
          <Check className="h-4 w-4" />
          You&apos;re on the list — we&apos;ll email you
        </div>
        <button
          onClick={unsubscribe}
          disabled={loading}
          className="self-center text-[11px] uppercase tracking-[0.14em] text-ink-muted underline-offset-4 transition-colors hover:text-gold hover:underline disabled:opacity-40"
        >
          {loading ? 'Updating…' : 'Cancel alert'}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={subscribe}
      disabled={loading}
      className={`flex items-center justify-center gap-3 border border-gold py-4 font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-gold transition-colors hover:bg-gold hover:text-obsidian disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {loading ? <BellRing className="h-4 w-4 animate-pulse" /> : <Bell className="h-4 w-4" />}
      {loading ? 'One moment…' : 'Notify me when available'}
    </button>
  );
}
