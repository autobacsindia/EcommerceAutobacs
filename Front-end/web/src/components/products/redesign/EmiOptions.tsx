'use client';

import { useEffect, useId, useRef } from 'react';

/**
 * Razorpay Affordability Widget — the "EMI from ₹X/month · View plans" strip
 * plus the bank-wise EMI / Pay-Later modal, identical to what the WooCommerce
 * Razorpay plugin injected on the old storefront.
 *
 * We embed Razorpay's official widget rather than hand-rolling EMI maths: the
 * available banks, tenures and interest rates are configured on the Razorpay
 * account and change over time — Razorpay is the single source of truth.
 *
 * Amount is the product's unit price (in paise). The widget renders once on
 * mount; it is intentionally not re-rendered on quantity changes (the SDK has
 * no clean live-amount update, and per-unit EMI matches standard PDP behaviour).
 */

// Module-level promise cache: dedupe the <script> across every PDP mount and
// concurrent callers (mirrors the loader in hooks/useRazorpay.ts).
const WIDGET_SRC = 'https://cdn.razorpay.com/widgets/affordability/affordability.js';
let widgetScriptPromise: Promise<boolean> | null = null;

function loadWidgetScript(): Promise<boolean> {
  if (widgetScriptPromise) return widgetScriptPromise;

  widgetScriptPromise = new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(false);
    if ((window as unknown as { RazorpayAffordabilitySuite?: unknown }).RazorpayAffordabilitySuite) {
      return resolve(true);
    }

    // A tag may linger from a prior failed load (its promise was reset on error
    // below). Its load/error events have already fired and will never fire
    // again, so re-listening would hang forever — drop it and re-create.
    document.querySelector<HTMLScriptElement>(`script[src="${WIDGET_SRC}"]`)?.remove();

    // Apply the per-request CSP nonce so the injected <script> is trusted under
    // the strict nonce policy (browsers without 'strict-dynamic' fall back to
    // the cdn.razorpay.com allow-list in the CSP).
    const nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;
    const script = document.createElement('script');
    script.src = WIDGET_SRC;
    script.async = true;
    if (nonce) script.nonce = nonce;
    script.onload = () => resolve(true);
    script.onerror = () => {
      // Allow a later retry (e.g. transient CDN failure) to re-attempt the load.
      widgetScriptPromise = null;
      resolve(false);
    };
    document.body.appendChild(script);
  });

  return widgetScriptPromise;
}

interface RazorpayAffordabilitySuiteInstance {
  render: () => void;
  destroy?: () => void;
}
type RazorpayAffordabilitySuiteCtor = new (opts: {
  key: string;
  amount: number;
  containerId: string;
}) => RazorpayAffordabilitySuiteInstance;

interface EmiOptionsProps {
  /** Unit price in the store's major currency unit (e.g. rupees). */
  price: number;
  className?: string;
}

export default function EmiOptions({ price, className }: EmiOptionsProps) {
  const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  const containerRef = useRef<HTMLDivElement>(null);
  // useId() gives a stable id that matches across SSR and hydration (a random
  // per-render id would differ server↔client → hydration mismatch). ':' is
  // legal in an id attribute but not in a CSS selector, so sanitise it for the
  // widget's containerId lookup.
  const containerId = `rzp-affordability-${useId().replace(/:/g, '')}`;

  const amountPaise = Math.round(price * 100);

  useEffect(() => {
    // Nothing to show without a configured key or a valid amount.
    if (!keyId || !Number.isFinite(amountPaise) || amountPaise <= 0) return;

    let cancelled = false;
    let instance: RazorpayAffordabilitySuiteInstance | null = null;
    const container = containerRef.current;

    loadWidgetScript().then((ok) => {
      if (cancelled || !ok || !container) return;
      const Ctor = (window as unknown as { RazorpayAffordabilitySuite?: RazorpayAffordabilitySuiteCtor })
        .RazorpayAffordabilitySuite;
      if (!Ctor) return;
      try {
        instance = new Ctor({ key: keyId, amount: amountPaise, containerId });
        instance.render();
      } catch {
        // Widget failure must never break the PDP — fail silently.
      }
    });

    return () => {
      cancelled = true;
      try {
        instance?.destroy?.();
      } catch {
        /* noop */
      }
      if (container) container.innerHTML = '';
    };
  }, [keyId, amountPaise, containerId]);

  if (!keyId) return null;

  return <div id={containerId} ref={containerRef} className={className} />;
}
