'use client';

import { useEffect, useState } from 'react';
import { Tag, X, Sparkles, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { useCheckoutQuote, type CheckoutQuote, type QuoteItem } from '@/hooks/useCheckoutQuote';

interface AvailableCoupon {
  code: string; description?: string; type: string; value: number;
  maxDiscountAmount?: number | null; minCartValue?: number;
}
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
  const [couponInput, setCouponInput] = useState('');
  const [appliedCode, setAppliedCode] = useState<string>('');
  const [redeemPoints, setRedeemPoints] = useState(0);

  const [available, setAvailable] = useState<AvailableCoupon[]>([]);
  const [karma, setKarma] = useState<KarmaInfo | null>(null);

  const { quote, loading } = useCheckoutQuote(items, appliedCode || undefined, redeemPoints, shippingCost);

  // Discover public coupons + (if signed in) the karma balance/config.
  useEffect(() => {
    apiClient.get<{ success: boolean; coupons: AvailableCoupon[] }>(API_ENDPOINTS.COUPONS_AVAILABLE)
      .then(r => setAvailable(r.coupons || []))
      .catch(() => setAvailable([]));
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

  const applyCoupon = () => setAppliedCode(couponInput.trim().toUpperCase());
  const removeCoupon = () => { setAppliedCode(''); setCouponInput(''); };

  const karmaEnabled = isAuthenticated && karma?.config?.enabled && (karma?.balance ?? 0) > 0;
  const maxRedeem = quote?.maxRedeemablePoints ?? 0;

  return (
    <div className="space-y-5">
      {/* ── Coupon ──────────────────────────────────────────────────────────── */}
      <div>
        <h3 className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest mb-2 flex items-center gap-2">
          <Tag className="h-3.5 w-3.5" /> Coupon
        </h3>

        {quote?.appliedCoupon ? (
          <div className="flex items-center justify-between bg-green-500/10 border border-green-500/30 rounded-sm px-3 py-2">
            <span className="text-green-400 font-display font-bold text-sm uppercase tracking-wide">
              {quote.appliedCoupon.code} applied
            </span>
            <button onClick={removeCoupon} className="text-ink-muted hover:text-red-400 transition-colors" title="Remove coupon">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyCoupon(); }}
              placeholder="Enter code"
              className="flex-1 bg-obsidian-raised border border-hairline text-ink placeholder:text-ink-muted rounded-sm px-3 py-2 text-sm font-display uppercase tracking-wide focus:outline-none focus:border-gold transition-colors"
            />
            <button
              onClick={applyCoupon}
              disabled={!couponInput.trim()}
              className="px-4 bg-gold hover:bg-gold text-obsidian font-display font-bold uppercase tracking-widest text-sm rounded-sm disabled:bg-obsidian-raised disabled:text-obsidian-muted disabled:cursor-not-allowed transition-colors"
            >
              Apply
            </button>
          </div>
        )}

        {appliedCode && quote?.couponError && (
          <p className="text-red-400 text-xs font-display mt-1.5">{quote.couponError}</p>
        )}

        {!quote?.appliedCoupon && available.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {available.map((c) => (
              <button
                key={c.code}
                onClick={() => { setCouponInput(c.code); setAppliedCode(c.code); }}
                className="text-xs font-display font-bold uppercase tracking-wide text-gold border border-gold/30 hover:border-gold rounded-sm px-2 py-1 transition-colors"
                title={c.description || ''}
              >
                {c.code}
              </button>
            ))}
          </div>
        )}
      </div>

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
          {quote?.freeShippingApplied && <Row label="Shipping" value="Free" positive />}
          {!!quote?.karmaDiscount && (
            <Row label={`Karma (${quote.karmaPointsUsed} pts)`} value={`- ${money(quote.karmaDiscount)}`} positive />
          )}
          <Row label="GST (18% included)" value={money(quote?.tax ?? 0)} muted />
        </div>
        <div className="flex justify-between border-t border-hairline pt-3 mt-3">
          <span className="font-display font-bold text-ink uppercase tracking-wide">Total</span>
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
