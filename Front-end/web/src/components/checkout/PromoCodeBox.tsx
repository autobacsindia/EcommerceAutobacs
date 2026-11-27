'use client';

import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import { useCart } from '@/context/CartContext';

/**
 * "Have a promo code?" — type a code, or remove the one on the cart.
 *
 * Used on the checkout's first step. "Buy now" puts the product in the cart and goes
 * straight to /checkout, so a shopper on that path never sees the cart page's promo
 * box and had no way to enter a code (e.g. the HILUX5000 card code).
 *
 * It decides nothing about money. It hands the code to CartContext.applyCoupon — the
 * same call the cart page makes — and the server says whether it applies. The totals on
 * the page come from the server quote, which is keyed on `cart.couponCode`, so they move
 * only once the server has accepted the code.
 */
export default function PromoCodeBox() {
  const { cart, applyCoupon, removeCoupon } = useCart();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applied = cart?.couponCode || '';

  const apply = async () => {
    const code = input.trim().toUpperCase();
    if (!code || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { discountApplied, message } = await applyCoupon(code);
      setInput('');
      // A resolved call does not always mean money came off (see cart/page.tsx).
      if (discountApplied) toast.success(`${code} applied`);
      else toast(message || `${code} saved — no discount on this order`);
    } catch (err: any) {
      setError(err?.message || 'Could not apply this coupon');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await removeCoupon();
    } catch (err: any) {
      setError(err?.message || 'Could not remove this coupon');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="checkout-promo" className="mt-4 pt-4 border-t border-hairline">
      <p className="text-sm font-display font-bold text-ink/70 uppercase tracking-[0.12em] mb-2">Have a promo code?</p>

      {applied ? (
        <div className="flex items-center justify-between gap-2 bg-obsidian-raised border border-gold/40 rounded-lg px-3 py-2">
          <span className="text-sm font-display font-bold text-gold">{applied} applied</span>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="text-ink-muted hover:text-red-600 transition-colors disabled:opacity-50"
            title="Remove coupon"
            aria-label="Remove coupon"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
            placeholder="Enter code"
            aria-label="Promo code"
            className="flex-1 min-w-0 bg-obsidian-raised border border-hairline text-ink placeholder:text-ink-muted rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold font-display"
          />
          <button
            type="button"
            onClick={apply}
            disabled={!input.trim() || busy}
            className="bg-obsidian-raised hover:bg-gold text-ink/70 hover:text-white px-4 py-2 rounded-lg text-sm font-display font-bold uppercase tracking-[0.12em] transition-colors disabled:opacity-50 disabled:hover:bg-obsidian-raised disabled:hover:text-ink/70"
          >
            {busy ? '…' : 'Apply'}
          </button>
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-sm text-red-600 font-display">{error}</p>}
    </div>
  );
}
