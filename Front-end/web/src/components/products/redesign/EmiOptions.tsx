'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * Razorpay Affordability Widget — the "EMI from ₹X/month · View plans" strip
 * plus the bank-wise EMI / Pay-Later modal, identical to what the WooCommerce
 * Razorpay plugin injected on the old storefront.
 *
 * We embed Razorpay's official widget rather than hand-rolling EMI maths: the
 * available banks, tenures and interest rates are configured on the Razorpay
 * account and change over time — Razorpay is the single source of truth. Publishing
 * our own rate table would mean quoting an interest rate we do not control on a
 * six-figure purchase, and being wrong the moment a bank's plan changes.
 *
 * What we DO own is the explanation. The widget states the monthly figure; it does
 * not tell the customer that the loan is with their bank, that the interest is the
 * bank's and not ours, or what happens on a refund. That gap is the single biggest
 * source of EMI support tickets, so it is answered here, before purchase.
 *
 * Amount is the product's unit price (in paise). The widget renders once on
 * mount; it is intentionally not re-rendered on quantity changes (the SDK has
 * no clean live-amount update, and per-unit EMI matches standard PDP behaviour).
 */

// Module-level promise cache: dedupe the <script> across every PDP mount and
// concurrent callers (mirrors the loader in hooks/useRazorpay.ts).
const WIDGET_SRC = 'https://cdn.razorpay.com/widgets/affordability/affordability.js';
let widgetScriptPromise: Promise<boolean> | null = null;

/**
 * How long to wait for the widget to paint before falling back to plain copy.
 * The widget fetches the account's affordability config over the network, so this
 * has to tolerate a slow connection; the MutationObserver below usually resolves
 * it far sooner.
 */
const WIDGET_RENDER_TIMEOUT_MS = 3500;

/**
 * Below the lender's floor no EMI plan exists, and the widget correctly renders
 * nothing — so we must not offer a fallback message either. ₹3,000 is the common
 * Indian card-EMI minimum; override per environment if a lender differs.
 */
const EMI_MIN_AMOUNT = Number(process.env.NEXT_PUBLIC_EMI_MIN_AMOUNT || 3000);

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

  // null = still waiting. Drives the fallback copy: the widget silently renders
  // nothing when Affordability is not enabled on the Razorpay account, when no
  // lender covers this amount, or when the CDN is blocked — and a blank gap where
  // the EMI strip should be is indistinguishable from a broken page.
  const [widgetPainted, setWidgetPainted] = useState<boolean | null>(null);

  const amountPaise = Math.round(price * 100);

  useEffect(() => {
    // Nothing to show without a configured key or a valid amount.
    if (!keyId || !Number.isFinite(amountPaise) || amountPaise <= 0) return;

    let cancelled = false;
    let instance: RazorpayAffordabilitySuiteInstance | null = null;
    const container = containerRef.current;

    // Watch for the widget painting into our container rather than guessing at a
    // fixed delay — resolves immediately on a fast connection, and the timeout
    // below is only the floor for "it never came".
    // Declared before assignment so the callback can disconnect the very observer it
    // belongs to (a `const` initialised with a closure over itself is not in scope yet).
    let observer: MutationObserver | null = null;
    if (container) {
      observer = new MutationObserver(() => {
        if (container.childElementCount > 0) {
          setWidgetPainted(true);
          observer?.disconnect();
        }
      });
      observer.observe(container, { childList: true, subtree: true });
    }

    const timer = setTimeout(() => {
      if (cancelled) return;
      setWidgetPainted((container?.childElementCount ?? 0) > 0);
      observer?.disconnect();
    }, WIDGET_RENDER_TIMEOUT_MS);

    loadWidgetScript().then((ok) => {
      if (cancelled || !container) return;
      if (!ok) {
        setWidgetPainted(false);
        return;
      }
      const Ctor = (window as unknown as { RazorpayAffordabilitySuite?: RazorpayAffordabilitySuiteCtor })
        .RazorpayAffordabilitySuite;
      if (!Ctor) {
        setWidgetPainted(false);
        return;
      }
      try {
        instance = new Ctor({ key: keyId, amount: amountPaise, containerId });
        instance.render();
      } catch {
        // Widget failure must never break the PDP — fall back to plain copy.
        setWidgetPainted(false);
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      observer?.disconnect();
      try {
        instance?.destroy?.();
      } catch {
        /* noop */
      }
      if (container) container.innerHTML = '';
    };
  }, [keyId, amountPaise, containerId]);

  if (!keyId) return null;

  // Below the lender floor there is no EMI to describe — render nothing at all
  // rather than a promise we cannot keep.
  const eligibleForEmi = price >= EMI_MIN_AMOUNT;
  if (!eligibleForEmi) return null;

  return (
    <div className={className}>
      <div id={containerId} ref={containerRef} />

      {/* Widget silent (Affordability not enabled on the account, no lender for this
          amount, or the CDN blocked). State only what is true regardless — Razorpay
          checkout shows whatever methods the account has enabled. No rate claims. */}
      {widgetPainted === false && (
        <p className="text-[11px] uppercase tracking-[0.16em] text-ink-muted">
          EMI &amp; pay-later options are shown at checkout
        </p>
      )}

      {/* The part Razorpay's widget never says. Collapsed by default so it informs
          without competing with the buy CTA. */}
      <details className="group mt-3">
        <summary className="cursor-pointer list-none text-[11px] uppercase tracking-[0.16em] text-ink-muted transition-colors hover:text-gold">
          How EMI works
          <span className="ml-1 inline-block transition-transform group-open:rotate-90">›</span>
        </summary>
        <div className="mt-2 space-y-2 text-xs leading-relaxed text-ink-muted">
          <p>
            Your bank charges the full order amount to your card and converts it into
            monthly instalments. Autobacs India is paid once, in full — the instalment
            plan and the <strong className="text-ink/70">interest are between you and your bank</strong>.
          </p>
          <p>
            Available banks, tenures and interest rates are set by the lenders and shown
            at checkout before you confirm.
          </p>
          <p>
            If an order is refunded, your bank returns the <strong className="text-ink/70">principal only</strong>.
            Interest already billed, and any cancellation charge your bank applies for
            closing the plan early, are not refundable. Refunds take 5–7 business days
            and cannot be instant on EMI.
          </p>
        </div>
      </details>
    </div>
  );
}
