'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Tag, Sparkles, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { useCart } from '@/context/CartContext';
import { useCheckoutQuote, type CheckoutQuote, type QuoteItem } from '@/hooks/useCheckoutQuote';

interface KarmaInfo {
  balance: number;
  config: { enabled: boolean; pointValueInRupees: number; redeemMaxPercent: number; minRedeemPoints: number };
}

interface Props {
  items: QuoteItem[];
  isAuthenticated: boolean;
  shippingCost?: number;
  /** Reports the live pricing + selections up to the checkout page. */
  onChange: (state: { couponCode?: string; redeemKarmaPoints: number; quote: CheckoutQuote | null }) => void;
}

const money = (n: number) => `₹${(n ?? 0).toFixed(2)}`;

/**
 * Checkout order-summary with coupon application + karma redemption. The breakdown
 * is computed by the server (useCheckoutQuote); this component only collects the
 * coupon code and redeem amount and renders the result. The order is recomputed
 * authoritatively at creation, so these values are display + intent only.
 */
export default function CheckoutSummary({ items, isAuthenticated, shippingCost = 0, onChange }: Props) {
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [karma, setKarma] = useState<KarmaInfo | null>(null);

  // Coupons are applied on the cart page and travel here on the cart document — a single
  // place to enter one, so the cart total the buyer agreed to is the total they are charged.
  const { cart } = useCart();
  const appliedCode = cart?.couponCode || '';

  const { quote, loading } = useCheckoutQuote(items, appliedCode || undefined, redeemPoints, shippingCost);

  // Karma balance/config (coupon discovery now lives on the cart page).
  useEffect(() => {
    if (isAuthenticated) {
      apiClient.get<{ success: boolean } & KarmaInfo>(API_ENDPOINTS.LOYALTY_ME)
        .then(r => setKarma({ balance: r.balance, config: r.config }))
        .catch(() => setKarma(null));
    }
  }, [isAuthenticated]);

  // Report pricing + selections upward whenever they settle.
  useEffect(() => {
    onChange({ couponCode: quote?.appliedCoupon?.code || undefined, redeemKarmaPoints: quote?.karmaPointsUsed ?? 0, quote });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote]);

  // If the coupon changed the cart, karma cap may shrink — clamp the requested amount.
  useEffect(() => {
    if (quote && redeemPoints > quote.maxRedeemablePoints) setRedeemPoints(quote.maxRedeemablePoints);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.maxRedeemablePoints]);

  const karmaEnabled = isAuthenticated && karma?.config?.enabled && (karma?.balance ?? 0) > 0;
  const maxRedeem = quote?.maxRedeemablePoints ?? 0;

  return (
    <div className="space-y-5">
      {/* ── Coupon (applied on the cart page; read-only here) ────────────────── */}
      {appliedCode && (
        <div>
          <h3 className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-2 flex items-center gap-2">
            <Tag className="h-3.5 w-3.5" /> Coupon
          </h3>

          {quote?.appliedCoupon ? (
            <div className="bg-green-500/10 border border-green-500/30 rounded-sm px-3 py-2">
              <span className="text-green-400 font-display font-bold text-sm uppercase tracking-wide">
                {quote.appliedCoupon.code} applied
              </span>
            </div>
          ) : quote?.couponError ? (
            // Valid when applied on the cart, no longer valid now. Order creation would
            // hard-fail, so say so here and send them back rather than fail at payment.
            <div className="bg-red-500/10 border border-red-500/30 rounded-sm px-3 py-2">
              <p className="text-red-400 text-xs font-display">{quote.couponError}</p>
              <Link href="/cart" className="text-gold text-xs font-display font-bold uppercase tracking-wide hover:underline">
                Edit coupon in cart →
              </Link>
            </div>
          ) : null}
        </div>
      )}

      {/* ── Karma points ────────────────────────────────────────────────────── */}
      {karmaEnabled && (
        <div className="border-t border-hairline pt-4">
          <h3 className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-2 flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5" /> Karma Points
          </h3>
          <p className="text-ink/70 font-display text-sm mb-2">
            Balance: <span className="text-ink font-display font-bold">{karma!.balance}</span> pts
            <span className="text-ink-muted"> · 1 pt = {money(karma!.config.pointValueInRupees)}</span>
          </p>
          {maxRedeem > 0 ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={maxRedeem}
                value={redeemPoints}
                onChange={(e) => setRedeemPoints(Math.max(0, Math.min(maxRedeem, parseInt(e.target.value, 10) || 0)))}
                className="w-28 bg-obsidian-raised border border-hairline text-ink rounded-sm px-3 py-2 text-sm font-display focus:outline-none focus:border-gold transition-colors"
              />
              <button
                onClick={() => setRedeemPoints(maxRedeem)}
                className="px-3 py-2 text-xs font-display font-bold uppercase tracking-widest text-gold border border-gold/30 hover:border-gold rounded-sm transition-colors"
              >
                Use max ({maxRedeem})
              </button>
            </div>
          ) : (
            <p className="text-ink-muted font-display text-xs">
              Minimum {karma!.config.minRedeemPoints} pts needed, up to {karma!.config.redeemMaxPercent}% of the order.
            </p>
          )}
        </div>
      )}

      {/* ── Breakdown ───────────────────────────────────────────────────────── */}
      <div className="border-t border-hairline pt-4">
        <h3 className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-3 flex items-center gap-2">
          Order Summary {loading && <Loader2 className="h-3 w-3 animate-spin text-gold" />}
        </h3>
        <div className="space-y-2">
          <Row label="Subtotal (incl. GST)" value={money(quote?.subtotal ?? 0)} />
          {!!quote?.couponDiscount && (
            <Row label={`Coupon (${quote.appliedCoupon?.code})`} value={`- ${money(quote.couponDiscount)}`} positive />
          )}
          <Row label="Shipping" value="Calculated at delivery" muted />
          {!!quote?.karmaDiscount && (
            <Row label={`Karma (${quote.karmaPointsUsed} pts)`} value={`- ${money(quote.karmaDiscount)}`} positive />
          )}
          <Row label="GST (18% included)" value={money(quote?.tax ?? 0)} muted />
        </div>
        <div className="flex justify-between border-t border-hairline pt-3 mt-3">
          <span className="font-display font-light text-ink tracking-[-0.01em]">Total</span>
          <span className="text-xl font-display font-bold text-gold">{money(quote?.totalAmount ?? 0)}</span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, positive, muted }: { label: string; value: string; positive?: boolean; muted?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-ink-muted font-display">{label}</span>
      <span className={`font-display ${positive ? 'text-green-400' : muted ? 'text-ink-muted' : 'text-ink/70'}`}>{value}</span>
    </div>
  );
}
