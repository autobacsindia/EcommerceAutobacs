'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { ClipboardList, Loader2, Check } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAuth } from '@/context/AuthContext';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { isValidIndianMobile } from '@/lib/utils';

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
 * there is NO automatic email — sales follow up by PHONE, so joining asks for an
 * Indian mobile number (required; the server validates it again). `variantId` scopes the
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
  // The phone step: the first press opens it, the second submits.
  const [asking, setAsking] = useState(false);
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');

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
    if (!asking) {
      setAsking(true);
      return;
    }
    if (!isValidIndianMobile(phone)) {
      setPhoneError('Enter a valid 10-digit mobile number');
      return;
    }
    setPhoneError('');
    setLoading(true);
    try {
      // The number goes in the POST body only — never a URL, never logged.
      const res = await apiClient.post<{ success: boolean; request?: { _id: string } }>(
        API_ENDPOINTS.JOIN_WAITLIST(productId),
        { variantId: variantId ?? undefined, phone: `+91${phone.replace(/\D/g, '').slice(-10)}` }
      );
      const id = res.request?._id ?? (await findMyRequestId());
      setRequestId(id);
      setAsking(false);
      toast.success("You're on the waiting list — our team will call you about availability.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add you to the list. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, asking, phone, productId, variantId, router, pathname, findMyRequestId]);

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
        <div className="flex items-center justify-center gap-2.5 border border-gold/50 bg-gold/10 py-4 font-display text-[15px] font-semibold text-gold rounded-full">
          <Check className="h-4 w-4" />
          You&apos;re on the waiting list
        </div>
        <button
          onClick={leave}
          disabled={loading}
          className="self-center text-[12px] uppercase tracking-[0.12em] text-ink-muted underline-offset-4 transition-colors hover:text-gold hover:underline disabled:opacity-40 font-semibold"
        >
          {loading ? 'Updating…' : 'Leave the list'}
        </button>
      </div>
    );
  }

  if (asking) {
    return (
      <form
        className={`flex flex-col gap-2 ${className}`}
        onSubmit={(e) => { e.preventDefault(); void join(); }}
        noValidate
      >
        <label htmlFor="waitlist-phone" className="text-[13px] font-semibold text-ink">
          Your mobile number — our team will call you when it&apos;s available
        </label>
        <div className={`flex items-center overflow-hidden rounded-full border bg-white ${phoneError ? 'border-red-500' : 'border-ink/20 focus-within:border-gold'}`}>
          <span className="pl-5 pr-2 text-[15px] text-ink-muted" aria-hidden>+91</span>
          <input
            id="waitlist-phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            required
            maxLength={14}
            placeholder="98765 43210"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); if (phoneError) setPhoneError(''); }}
            aria-invalid={phoneError ? true : undefined}
            aria-describedby={phoneError ? 'waitlist-phone-error' : undefined}
            className="min-w-0 flex-1 bg-transparent py-3.5 pr-5 text-[15px] text-ink outline-none"
          />
        </div>
        {phoneError && <p id="waitlist-phone-error" role="alert" className="text-[12px] text-red-600">{phoneError}</p>}
        <button
          type="submit"
          disabled={loading}
          className="flex items-center justify-center gap-3 rounded-full bg-gold py-4 font-display text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
          {loading ? 'One moment…' : 'Join the waiting list'}
        </button>
      </form>
    );
  }

  return (
    <button
      onClick={join}
      disabled={loading}
      className={`flex items-center justify-center gap-3 bg-gold py-4 font-display text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${className} rounded-full`}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
      {loading ? 'One moment…' : 'Join the waiting list'}
    </button>
  );
}
