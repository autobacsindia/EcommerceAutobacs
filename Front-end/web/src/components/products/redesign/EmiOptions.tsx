'use client';

import { useEffect, useRef, useState } from 'react';
import { useRazorpayKeyId } from '@/hooks/queries/useRazorpayKeyId';

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
 *
 * The key comes from the backend (`useRazorpayKeyId`) — the same value that signs
 * checkout orders — never from a build-time NEXT_PUBLIC_* copy. A baked-in key
 * outlived a Razorpay key rotation once: Razorpay answered it with 401, the widget
 * collapsed to nothing on every PDP, and checkout (already server-keyed) kept working,
 * so nobody noticed.
 */

// Module-level promise cache: dedupe the <script> across every PDP mount and
// concurrent callers (mirrors the loader in hooks/useRazorpay.ts).
const WIDGET_SRC = 'https://cdn.razorpay.com/widgets/affordability/affordability.js';
let widgetScriptPromise: Promise<boolean> | null = null;

/**
 * How long to wait for the widget's verdict before falling back to plain copy.
 * The widget fetches the account's affordability config over the network, so this
 * has to tolerate a slow connection; the MutationObserver below usually resolves
 * it far sooner. A verdict that arrives AFTER the timeout still wins — a late
 * paint replaces the fallback line rather than being ignored.
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

/**
 * The widget mounts itself into an element with THIS EXACT ID. It is hardcoded in
 * Razorpay's bundle (`T = "razorpay-affordability-widget"`, read via
 * `document.getElementById(T)`) and is not configurable.
 *
 * ⚠️ DO NOT make this dynamic. The component originally rendered a per-instance
 * `useId()` container and passed a `containerId` option — an option the current
 * widget bundle does not read at all (the string `containerId` does not appear in
 * it). The widget therefore loaded, built its iframe, failed to find its container,
 * and rendered nothing. The EMI strip was silently dead on every PDP in production,
 * with no console error, because the widget swallows the miss.
 *
 * Being a fixed id, it is a singleton: only one EmiOptions may be mounted per page.
 * That holds today (one BuyBox per PDP) — if a second EMI surface is ever added,
 * they must share one instance rather than render two containers.
 */
const WIDGET_CONTAINER_ID = 'razorpay-affordability-widget';

/**
 * Has the widget decided to show something? Read from what Razorpay's bundle writes to
 * the DOM, because "an iframe exists" proves nothing:
 *
 *   1. `render()` inserts its iframe at a DEFAULT `height="105px"` before the frame has
 *      loaded or asked Razorpay anything.
 *   2. The frame then posts `setWidgetHeight`, and the bundle writes the real height
 *      onto the iframe (`iframe.height = r ? r+5 : r` px) and sets the container to
 *      `display: none` when that height is 0.
 *
 * Step 2 lands as 0 whenever there is nothing to show: Affordability not enabled on the
 * account, no lender for this amount — or a key Razorpay rejects (401), which is what
 * happened in production. Counting step 1 as "painted" left a blank strip and suppressed
 * the fallback line. So only a height the widget has REPORTED (an attribute write we
 * observed after insertion) counts, and only if it is visibly non-zero.
 *
 * Returns true / false once the widget has a verdict, null while it is still deciding.
 * Attributes rather than offsetHeight: they are exactly what the bundle writes, and they
 * read the same while our wrapper is still collapsed (and under jsdom).
 */
function readWidgetVerdict(container: HTMLElement, heightReported: boolean): boolean | null {
  const iframe = container.querySelector('iframe');
  if (!iframe) return null;
  if (container.style.display === 'none') return false;
  if (!heightReported) return null;
  const height = parseFloat(iframe.getAttribute('height') ?? '');
  const width = parseFloat(iframe.getAttribute('width') ?? '');
  // A width of exactly 0 is the "container was zero-width at mount" failure (see the
  // width warning in the JSX). NaN (unset / "100%") is fine — the iframe fills the box.
  return height > 0 && width !== 0;
}

/**
 * Razorpay inserts its main frame with `loading="lazy"`. While we wait for a verdict our
 * wrapper is collapsed (`h-0 overflow-hidden`), which clips the frame to zero area — so
 * the browser never considers it near the viewport and never loads it. An unloaded frame
 * never reports a height, and without a height we never reveal the wrapper: a deadlock
 * that showed the fallback even for a perfectly valid key (seen in the preview, where the
 * frame loaded on one reload and not the next).
 *
 * Flipping the attribute to eager before the frame has loaded makes the browser start the
 * deferred load (HTML "lazy load resumption steps"). It costs one small iframe load on
 * PDPs whose strip is below the fold — the price of a widget that can actually decide.
 */
function loadWidgetFramesEagerly(container: HTMLElement) {
  container.querySelectorAll('iframe[loading="lazy"]').forEach((f) => f.setAttribute('loading', 'eager'));
}

interface RazorpayAffordabilitySuiteInstance {
  render: () => void;
  destroy?: () => void;
}
type RazorpayAffordabilitySuiteCtor = new (opts: {
  key: string;
  amount: number;
}) => RazorpayAffordabilitySuiteInstance;

interface EmiOptionsProps {
  /** Unit price in the store's major currency unit (e.g. rupees). */
  price: number;
  className?: string;
}

export default function EmiOptions({ price, className }: EmiOptionsProps) {
  // undefined while loading, null when the backend has no valid key (or is unreachable).
  const { data: keyId, isPending: keyPending } = useRazorpayKeyId();
  const containerRef = useRef<HTMLDivElement>(null);

  // null = still waiting. Drives the fallback copy: the widget silently renders
  // nothing when Affordability is not enabled on the Razorpay account, when no
  // lender covers this amount, when Razorpay rejects the key, or when the CDN is
  // blocked — and a blank gap where the EMI strip should be is indistinguishable
  // from a broken page.
  const [widgetPainted, setWidgetPainted] = useState<boolean | null>(null);

  const amountPaise = Math.round(price * 100);
  // Below the lender floor there is no EMI to describe — render nothing at all
  // rather than a promise we cannot keep.
  const eligibleForEmi = price >= EMI_MIN_AMOUNT;

  useEffect(() => {
    // Nothing to show without a configured key, a valid amount, or an eligible price.
    if (!keyId || !eligibleForEmi || !Number.isFinite(amountPaise) || amountPaise <= 0) return;

    let cancelled = false;
    let instance: RazorpayAffordabilitySuiteInstance | null = null;
    const container = containerRef.current;

    // Follow the widget's own verdict rather than guessing at a fixed delay — resolves
    // as soon as Razorpay reports a height, and the timeout below is only the floor for
    // "it never decided". The observer stays connected after a verdict: the widget can
    // re-report (e.g. a late paint after we already showed the fallback), and the UI
    // should follow its latest word.
    let heightReported = false;
    let observer: MutationObserver | null = null;
    if (container) {
      observer = new MutationObserver((records) => {
        loadWidgetFramesEagerly(container);
        for (const r of records) {
          if (r.type === 'attributes' && r.attributeName === 'height' && r.target instanceof HTMLIFrameElement) {
            heightReported = true;
          }
        }
        const verdict = readWidgetVerdict(container, heightReported);
        if (verdict !== null) setWidgetPainted(verdict);
      });
      observer.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['height', 'style'],
      });
    }

    const timer = setTimeout(() => {
      if (cancelled) return;
      // No verdict yet → be honest and show the fallback line; a late verdict still
      // flips it via the observer above.
      setWidgetPainted(container ? (readWidgetVerdict(container, heightReported) ?? false) : false);
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
        instance = new Ctor({ key: keyId, amount: amountPaise });
        instance.render();
        // render() inserts the frame synchronously when it finds the container; don't
        // wait for the observer's microtask to un-lazy it.
        loadWidgetFramesEagerly(container);
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
  }, [keyId, amountPaise, eligibleForEmi]);

  if (!eligibleForEmi) return null;
  // No key (backend unconfigured or unreachable) means no widget AND a broken checkout,
  // so even the "shown at checkout" line would be a promise we cannot keep. While the
  // key is still loading, render the shell so the explainer does not pop in later.
  if (!keyPending && !keyId) return null;

  return (
    <div className={className}>
      {/*
        LEGIBILITY: the widget renders inside a CROSS-ORIGIN iframe
        (cdn.razorpay.com/…/frame.html), so its text colours cannot be restyled from
        here — no CSS of ours reaches inside it, by design.

        Razorpay does read `getComputedStyle(document.body).background-color` (ours is
        #080808) and tints its own surface with it, but its type stays the near-black
        it uses for light storefronts. On this obsidian theme that rendered as dark
        grey on near-black: present, but unreadable.

        So we give it a light surface of its own to sit on. This is the only reliable
        lever — it holds whatever Razorpay changes inside the frame, and it reads as a
        deliberate payment chip rather than a hole in the page. The container id must
        stay exactly WIDGET_CONTAINER_ID, so the styling goes on this wrapper.
      */}
      {/*
        ⚠️ The hidden state must NEVER zero the WIDTH. Razorpay sizes its iframe from
        `container.clientWidth` at mount time (`var r = e.clientWidth; … t.width = r+"px"`),
        so a `w-0`/`display:none`/absolutely-positioned container yields a 0px-wide
        iframe that stays invisible even after being revealed. Collapse the HEIGHT and
        fade the opacity only — and keep the padding/border box identical across both
        states so the measured width does not shift when the card appears.
      */}
      <div
        className={
          widgetPainted
            ? 'overflow-hidden rounded-lg border border-hairline bg-obsidian px-3 py-1 opacity-100 transition-opacity duration-300'
            : 'pointer-events-none h-0 overflow-hidden rounded-lg border border-transparent px-3 opacity-0'
        }
      >
        <div id={WIDGET_CONTAINER_ID} ref={containerRef} />
      </div>

      {/* Widget silent (Affordability not enabled on the account, no lender for this
          amount, key rejected, or the CDN blocked). State only what is true regardless —
          Razorpay checkout shows whatever methods the account has enabled. No rate claims. */}
      {widgetPainted === false && (
        <p className="text-[12px] uppercase tracking-[0.12em] text-ink-muted font-semibold">
          EMI &amp; pay-later options are shown at checkout
        </p>
      )}

      {/* The part Razorpay's widget never says. Collapsed by default so it informs
          without competing with the buy CTA. */}
      <details className="group mt-3">
        <summary className="cursor-pointer list-none text-[12px] uppercase tracking-[0.12em] text-ink-muted transition-colors hover:text-gold font-semibold">
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
