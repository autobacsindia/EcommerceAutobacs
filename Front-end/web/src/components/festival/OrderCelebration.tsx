'use client';

import { useEffect, useState } from 'react';
import apiClient from '@/lib/api';
import { useFestival } from './FestivalThemeContext';
import { festivalVars } from './festivalStyle';
import { loadEngine } from './loadEngine';
import { claimOrderCelebration } from '@/lib/festival/celebrateOnce';

const SHOW_MS = 3500;
const FIREWORKS_MS = 3000;
/** While the webhook is landing: poll at most this often, this many times. */
const POLL_MS = 2000;
const POLL_MAX = 10;

const NOT_CONFIRMED = ['cancelled', 'failed', 'returned'];

/** Confirmed = the server says PAID (the verified webhook), nothing less. */
export function isConfirmedOrder(paymentStatus?: string, orderStatus?: string): boolean {
  if (NOT_CONFIRMED.includes((orderStatus || '').toLowerCase())) return false;
  return (paymentStatus || '').toLowerCase() === 'paid';
}

function justPaidInThisTab(orderId: string): boolean {
  try {
    return !!sessionStorage.getItem(`awaitingPaymentConfirmation:${orderId}`);
  } catch {
    return false;
  }
}

/**
 * ~3s of fireworks + "Happy Diwali! Your order is confirmed 🪔" on the order
 * success page — once per order, only for a server-confirmed paid order.
 *
 * The page often renders a beat before the Razorpay webhook lands. If this tab
 * just paid (the marker useRazorpay sets after signature verification), it polls
 * the order a few times and celebrates when the server says paid — the client
 * signal alone never triggers it.
 *
 * Under reduced motion: the message only, no fireworks. The overlay never takes
 * a tap (pointer-events: none) and the receipt below stays fully usable.
 */
export default function OrderCelebration({
  orderId,
  paymentStatus,
  orderStatus,
}: {
  orderId: string;
  paymentStatus?: string;
  orderStatus?: string;
}) {
  const festival = useFestival();
  const tokens = festival?.tokens ?? null;
  const [showing, setShowing] = useState(false);

  useEffect(() => {
    if (!tokens || !orderId) return;
    let cancelled = false;
    let polls = 0;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const celebrate = () => {
      if (cancelled || !claimOrderCelebration(orderId)) return;
      setShowing(true);
      hideTimer = setTimeout(() => setShowing(false), SHOW_MS);
      void loadEngine(tokens).then((engine) => { if (!cancelled) engine?.fireworks(FIREWORKS_MS); });
    };

    const poll = async () => {
      polls += 1;
      try {
        const res = (await apiClient.get(`/orders/${orderId}`)) as { order?: { paymentStatus?: string; status?: string } };
        if (isConfirmedOrder(res?.order?.paymentStatus, res?.order?.status)) return celebrate();
        if (NOT_CONFIRMED.includes((res?.order?.status || '').toLowerCase())) return;
      } catch {
        /* transient — try again below */
      }
      if (!cancelled && polls < POLL_MAX) pollTimer = setTimeout(poll, POLL_MS);
    };

    if (isConfirmedOrder(paymentStatus, orderStatus)) celebrate();
    else if (!NOT_CONFIRMED.includes((orderStatus || '').toLowerCase()) && justPaidInThisTab(orderId)) {
      pollTimer = setTimeout(poll, POLL_MS);
    }

    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
      clearTimeout(hideTimer);
    };
  }, [tokens, orderId, paymentStatus, orderStatus]);

  if (!festival || !showing) return null;
  return (
    <div
      role="status"
      data-testid="order-celebration"
      style={{
        ...festivalVars(festival.tokens),
        position: 'fixed', left: 0, right: 0, top: '18%', zIndex: 9991,
        display: 'flex', justifyContent: 'center', padding: '0 16px', pointerEvents: 'none',
      }}
    >
      <p
        style={{
          background: 'var(--fx-primary)', color: 'var(--fx-on-primary)',
          border: '2px solid var(--fx-accent)', borderRadius: 16,
          padding: '14px 22px', fontWeight: 800, fontSize: 18, textAlign: 'center',
          boxShadow: `0 10px 40px ${festival.tokens.colors.glow}`, maxWidth: 420,
        }}
      >
        {festival.tokens.copy.orderConfirmed}
      </p>
    </div>
  );
}
