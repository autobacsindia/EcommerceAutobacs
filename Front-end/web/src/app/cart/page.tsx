'use client';

import * as Sentry from '@sentry/nextjs';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { Trash2, Plus, Minus, ShoppingBag, ArrowRight, AlertTriangle } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useCurrency } from '@/context/CurrencyContext';
import SavingsCelebration from '@/components/checkout/SavingsCelebration';
import EnhancedImage from '@/components/layout/EnhancedImage';
import { ProductImage, productUrl } from '@/lib/types';
import { toast } from 'react-hot-toast';
import SkeletonLoader from '@/components/layout/SkeletonLoader';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { useAuth } from '@/context/AuthContext';
import CheckoutErrorBoundary from '@/components/checkout/CheckoutErrorBoundary';
import Eyebrow from '@/components/ui/Eyebrow';
import Reveal from '@/components/ui/Reveal';
import { useCheckoutQuote } from '@/hooks/useCheckoutQuote';
import { useCampaign } from '@/hooks/queries/useCampaign';
import CampaignMeter from '@/components/campaign/CampaignMeter';
import CampaignCartNotice from '@/components/campaign/CampaignCartNotice';
import CartLineDiscount from '@/components/campaign/CartLineDiscount';

export default function CartPage() {
  return (
    <CheckoutErrorBoundary feature="cart">
      <CartPageContent />
    </CheckoutErrorBoundary>
  );
}

function CartPageContent() {
  const { cart, removeFromCart, updateQuantity, clearCart, isLoading, refreshCart, applyCoupon, removeCoupon } = useCart();

  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  // Public (visibility: 'public') coupons only. Hidden ones still work when typed.
  const [availableCoupons, setAvailableCoupons] = useState<{ code: string; description?: string }[]>([]);

  useEffect(() => {
    apiClient.get<{ success: boolean; coupons: { code: string; description?: string }[] }>(API_ENDPOINTS.COUPONS_AVAILABLE)
      .then((r) => setAvailableCoupons(r.coupons || []))
      .catch(() => setAvailableCoupons([]));
  }, []);

  // The server prices the cart; this mirrors it for display only. Order creation
  // re-computes from scratch, so nothing here can influence what the buyer is charged.
  const quoteItems = useMemo(
    () => (cart?.items || []).map((i) => ({
      product: i.product._id,
      quantity: i.quantity,
      /*
        `variantId` is REQUIRED for a variable product — the server prices the selected
        variant, never the parent, so a variable line without one is rejected outright.

        It was being dropped here. One variable item in the basket therefore 400'd the
        whole quote, and because the failure is swallowed below, the summary silently
        fell back to the client's own totals: TAX SHOWED AS ₹0, no discount line appeared,
        and the campaign looked as though it had never applied. The cart holds the id
        already — this only stopped throwing it away.
      */
      variantId: i.variantId ?? null,
    })),
    [cart?.items]
  );
  const { quote, quotedCouponCode, loading: quoteLoading, error: quoteError } = useCheckoutQuote(quoteItems, cart?.couponCode || undefined, 0);

  // ── Campaign reward ────────────────────────────────────────────────────────
  // An invited customer never types the code — the card tells them the reward is
  // theirs, so making them hunt for a coupon field would be a needless drop-off.
  // Applied once, only when no other coupon is set (never overwrite a code the
  // customer chose themselves), and the server re-validates it at checkout anyway.
  const cartSubtotal = quote?.subtotal ?? cart?.total ?? 0;

  /*
    True while the first real price is still coming, INCLUDING the moment after the
    campaign coupon has been auto-applied but before the re-quote lands. Both windows
    show a total that is about to change, and both are better spent saying so.
  */
  const awaitingPricing = quoteLoading || (!quote && (cart?.items?.length ?? 0) > 0);
  const { data: campaignStatus } = useCampaign(Math.round(cartSubtotal));
  const autoAppliedRef = useRef(false);

  useEffect(() => {
    if (autoAppliedRef.current) return;
    if (!campaignStatus?.eligible || !campaignStatus.couponCode) return;
    if (cart?.couponCode) return;
    if (!cart?.items?.length) return;

    autoAppliedRef.current = true;
    applyCoupon(campaignStatus.couponCode).catch((err) => {
      /*
        Still not an error toast — the reward is a bonus the customer did not ask for,
        and shouting at them about a failure they did not cause helps nobody.

        But it is no longer swallowed either. This one call was the ONLY place the
        campaign became visible, so a silent failure here was indistinguishable from the
        campaign being switched off — which is exactly how a correctly configured live
        campaign came to look broken. Reported to Sentry so it is a signal rather than a
        mystery, and the ref is reset so a re-render can try again.
      */
      Sentry.captureException(err, {
        tags: { feature: 'campaign', step: 'cart-auto-apply' },
        extra: { code: campaignStatus.couponCode, slug: campaignStatus.slug },
      });
      autoAppliedRef.current = false;
    });
  }, [campaignStatus?.eligible, campaignStatus?.couponCode, cart?.couponCode, cart?.items?.length, applyCoupon]);

  /*
    ── Dropping an offer that stopped being theirs ────────────────────────────

    A campaign coupon can be sitting on a cart from a previous visit and then cease to
    apply — the campaign was gated on activation, or switched off, or the customer used
    it on another order. The server refuses it on every re-quote, so without this the
    cart shows a permanent red error under the promo box for a code the customer never
    typed and cannot remove without noticing a link they have no reason to look for.

    Keyed on `couponErrorCode`, not on the message: only 'campaign' refusals are dropped.
    An ordinary coupon the customer chose themselves is left exactly where it is, error
    and all — they picked it, and silently deleting someone's coupon is worse than
    showing them why it did not work. Cart-shaped campaign refusals ("add more to
    unlock") are untagged by the server for the same reason.

    Cannot fight the auto-apply above: that one requires `eligible`, and every refusal
    tagged 'campaign' means this customer is not. The ref keeps a failed removal from
    retrying on every render.
  */
  // The code this effect has already acted on, rather than a bare "have I run" boolean.
  // A boolean cannot distinguish "already handled" from "a different coupon now needs
  // handling", and it is never cleared on failure: a removal that keeps failing must not
  // be retried on every render, since `removeCoupon` is a fresh identity on each provider
  // render and would spin.
  const staleCouponRef = useRef<string | null>(null);
  useEffect(() => {
    const code = cart?.couponCode;
    if (!code || staleCouponRef.current === code) return;
    /*
      Only act on a quote that priced THIS code.

      `quote` is retained across a coupon change (see `quotedCouponCode`), so during the
      debounce it still carries the previous code's refusal. Without this check, a
      customer who typed their own coupon immediately after a campaign coupon was refused
      would have their coupon silently deleted on the strength of the old response.
    */
    if (quotedCouponCode !== code) return;
    if (quote?.couponErrorCode !== 'campaign') return;

    staleCouponRef.current = code;
    removeCoupon().catch((err) => {
      // Reported rather than shown. The customer did not ask for this coupon and cannot
      // act on its removal failing; what matters is that WE find out, because the
      // visible symptom is an error they cannot clear.
      Sentry.captureException(err, {
        tags: { feature: 'campaign', step: 'cart-stale-coupon-removal' },
        extra: { code },
      });
    });
  }, [cart?.couponCode, quotedCouponCode, quote?.couponErrorCode, removeCoupon]);

  const handleApplyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code || couponBusy) return;
    setCouponBusy(true);
    setCouponError(null);
    try {
      await applyCoupon(code);
      setCouponInput('');
      toast.success(`${code} applied`);
    } catch (err: any) {
      setCouponError(err?.message || 'Could not apply this coupon');
    } finally {
      setCouponBusy(false);
    }
  };

  const handleRemoveCoupon = async () => {
    if (couponBusy) return;
    setCouponBusy(true);
    setCouponError(null);
    try {
      await removeCoupon();
    } catch (err: any) {
      setCouponError(err?.message || 'Could not remove this coupon');
    } finally {
      setCouponBusy(false);
    }
  };
  const { isAuthenticated } = useAuth();
  const { formatPrice } = useCurrency();
  const [updatingItem, setUpdatingItem] = useState<string | null>(null);
  const [recentChanges, setRecentChanges] = useState<any[]>([]);
  const [hasShownChanges, setHasShownChanges] = useState(false);

  useEffect(() => {
    const fetchCartWithStockCheck = async () => {
      try {
        const response: any = await apiClient.get(API_ENDPOINTS.CART);
        if (response.recentChanges?.length > 0) {
          setRecentChanges(response.recentChanges);
          if (!hasShownChanges) {
            response.recentChanges.forEach((change: any) => {
              if (change.type === 'REMOVED_OUT_OF_STOCK') toast.error(change.message, { icon: '❌', duration: 6000 });
              else if (change.type === 'QUANTITY_ADJUSTED') toast(change.message, { icon: '⚠️', style: { background: '#FFA726', color: '#fff' }, duration: 6000 });
            });
            setHasShownChanges(true);
            setTimeout(() => setHasShownChanges(false), 5000);
          }
        }
        if (response.stockMessages?.length > 0) {
          response.stockMessages.forEach((msg: string) => toast(msg, { icon: '⚠️', style: { background: '#FFA726', color: '#fff' } }));
        }
      } catch (error) {
        console.error('Failed to fetch cart:', error);
      }
    };
    if (isAuthenticated && !isLoading) fetchCartWithStockCheck();
  }, [isAuthenticated, isLoading]);

  // A line is identified by product + variant, so the same product under two
  // models tracks its spinner/updates independently.
  const lineKey = (productId: string, variantId?: string | null) =>
    productId + (variantId ? `:${variantId}` : '');

  const handleQuantityChange = async (productId: string, newQuantity: number, variantId?: string | null) => {
    if (newQuantity < 1) return;
    try {
      setUpdatingItem(lineKey(productId, variantId));
      await updateQuantity(productId, newQuantity, variantId);
      toast.success('Cart updated');
    } catch (error: any) {
      if (error.message?.includes('out of stock')) {
        toast.error('This item is now out of stock', { icon: '❌' });
        setTimeout(() => removeFromCart(productId, variantId), 2000);
      } else if (error.message?.includes('Only') && error.message?.includes('available')) {
        toast.error(error.message, { icon: '⚠️' });
        if (error.maxQuantity) setTimeout(async () => { await updateQuantity(productId, error.maxQuantity, variantId); }, 1500);
      } else {
        toast.error('Failed to update quantity');
      }
    } finally {
      setUpdatingItem(null);
    }
  };

  const handleRemoveItem = async (productId: string, variantId?: string | null) => {
    if (confirm('Remove this item from cart?')) {
      try {
        await removeFromCart(productId, variantId);
        toast.success('Item removed from cart');
      } catch {
        toast.error('Failed to remove item');
      }
    }
  };

  const handleClearCart = async () => {
    if (confirm('Clear all items from cart?')) {
      try {
        await clearCart();
        toast.success('Cart cleared');
      } catch {
        toast.error('Failed to clear cart');
      }
    }
  };

  const getFirstImageUrl = (images: ProductImage[] | string | undefined): string | null => {
    if (!images) return null;
    if (typeof images === 'string') return images;
    if (Array.isArray(images) && images.length > 0) {
      const first = images[0];
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object' && 'url' in first) return (first as ProductImage).url;
    }
    return null;
  };

  if (isLoading && !cart) return <SkeletonLoader type="cart-page" />;

  if (!cart || cart.items?.length === 0) {
    return (
      <div className="min-h-screen bg-obsidian-deep flex items-center justify-center">
        <div className="text-center py-12 px-6">
          <ShoppingBag className="mx-auto h-16 w-16 text-hairline mb-8" strokeWidth={1} />
          <Eyebrow className="mb-4">Your bag</Eyebrow>
          <h2 className="text-[clamp(32px,5vw,52px)] font-light leading-tight text-ink mb-4">Your cart is empty</h2>
          <p className="text-ink-muted font-display font-light mb-8">Nothing here yet — let&apos;s find something.</p>
          <Link
            href="/products"
            className="inline-flex items-center gap-2.5 bg-gold text-obsidian font-display text-[10px] font-semibold uppercase tracking-[0.2em] px-7 py-4 transition-opacity hover:opacity-90"
          >
            Browse Products
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-obsidian-deep py-8">
      {/* Fires once when a coupon lands, on its own state. Renders nothing the rest of
          the time, and never gates the checkout button behind being dismissed. */}
      <SavingsCelebration quote={quote} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <Reveal className="mb-10">
          <Eyebrow>Your bag</Eyebrow>
          <h1 className="mt-4 text-[clamp(34px,5vw,60px)] font-light leading-[0.95] tracking-[-0.01em] text-ink">Shopping Cart</h1>
          <p className="mt-3 font-display text-[13px] tracking-[0.04em] text-ink-muted">
            <span className="text-ink">{cart.items.length}</span> item{cart.items.length !== 1 ? 's' : ''} in your cart
          </p>
        </Reveal>

        {/* Stock change banner */}
        {recentChanges.length > 0 && (
          <div className="mb-6 bg-orange-500/10 border-l-4 border-orange-500 rounded-sm p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-6 w-6 text-orange-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-display font-bold text-orange-400 uppercase tracking-wide">Cart Updates Due to Stock Changes</h3>
                <ul className="mt-2 space-y-1">
                  {recentChanges.map((change, idx) => (
                    <li key={idx} className="text-sm text-orange-300 font-display flex items-start gap-2">
                      <span className="text-orange-400 mt-0.5">·</span>
                      <span>
                        {change.type === 'REMOVED_OUT_OF_STOCK' ? (
                          <strong>{change.productName}</strong>
                        ) : change.type === 'QUANTITY_ADJUSTED' ? (
                          <><strong>{change.productName}</strong>: qty {change.previousQuantity} → {change.newQuantity}</>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        <div className="lg:grid lg:grid-cols-12 lg:gap-8">
          {/* Cart Items */}
          <div className="lg:col-span-8">
            <div className="bg-obsidian border border-hairline rounded-lg">
              <div className="p-4 border-b border-hairline flex justify-between items-center">
                <h2 className="font-display font-light text-ink tracking-[-0.01em]">Cart Items</h2>
                <button onClick={handleClearCart} className="text-sm text-red-400 hover:text-red-300 font-display transition-colors">
                  Clear Cart
                </button>
              </div>

              <div className="divide-y divide-hairline">
                {cart.items.map((item, index) => {
                  const unitPrice = item.price ?? item.product.price;
                  const uid = lineKey(item.product._id, item.variantId);
                  return (
                  <div key={`${uid}-${index}`} className="p-6">
                    <div className="flex gap-4">
                      <Link
                        href={productUrl(item.product, '/products') || '/products'}
                        className="shrink-0 w-24 h-24 bg-obsidian-raised border border-hairline rounded-sm overflow-hidden"
                      >
                        <EnhancedImage
                          src={getFirstImageUrl(item.product.images)}
                          alt={item.product.name}
                          width={96}
                          height={96}
                          context="product"
                          className="object-cover w-full h-full"
                        />
                      </Link>

                      <div className="flex-1">
                        <div className="flex justify-between">
                          <div>
                            <Link
                              href={productUrl(item.product, '/products') || '/products'}
                              className="font-display font-light text-ink tracking-[-0.01em] hover:text-gold transition-colors"
                            >
                              {item.product.name}
                            </Link>
                            {item.variantLabel && (
                              <p className="text-[11px] uppercase tracking-[0.14em] text-gold mt-1">{item.variantLabel}</p>
                            )}
                            <p className="text-sm text-ink-muted font-display mt-1">{formatPrice(unitPrice)} each</p>
                            <CartLineDiscount
                              quote={quote}
                              productId={item.product._id}
                              variantId={item.variantId}
                            />
                          </div>
                          <button
                            onClick={() => handleRemoveItem(item.product._id, item.variantId)}
                            className="text-ink-muted hover:text-red-400 transition-colors"
                            title="Remove item"
                          >
                            <Trash2 className="h-5 w-5" />
                          </button>
                        </div>

                        <div className="mt-4 flex items-center justify-between">
                          <div className="flex items-center border border-hairline rounded-sm">
                            <button
                              onClick={() => handleQuantityChange(item.product._id, item.quantity - 1, item.variantId)}
                              disabled={item.quantity <= 1 || updatingItem === uid}
                              className="p-2 text-ink/70 hover:bg-obsidian-raised disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                            <span className="px-4 py-2 min-w-12 text-center text-ink font-display font-bold">
                              {item.quantity}
                            </span>
                            <button
                              onClick={() => handleQuantityChange(item.product._id, item.quantity + 1, item.variantId)}
                              disabled={item.product.stock === 'out' || updatingItem === uid}
                              className="p-2 text-ink/70 hover:bg-obsidian-raised disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                          <p className="text-lg font-display font-bold text-gold">
                            {formatPrice(unitPrice * item.quantity)}
                          </p>
                        </div>

                        {item.product.stock === 'out' ? (
                          <div className="mt-2 flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/30 px-3 py-2 rounded-sm">
                            <AlertTriangle className="h-4 w-4" />
                            <span className="text-sm font-display">This item is now out of stock</span>
                          </div>
                        ) : item.product.stock === 'low' ? (
                          <p className="text-sm text-orange-400 font-display mt-2">⚠ Low stock</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-6">
              <Link href="/products" className="inline-flex items-center gap-2 text-gold hover:text-ink font-display font-bold uppercase tracking-widest transition-colors">
                ← Continue Shopping
              </Link>
            </div>
          </div>

          {/* Order Summary */}
          <div className="lg:col-span-4 mt-8 lg:mt-0">
            <div className="bg-obsidian border border-hairline rounded-lg p-6 sticky top-20">
              <h2 className="text-lg font-display font-light text-ink tracking-[-0.01em] mb-4">Order Summary</h2>

              {/* Renders only for an eligible invited customer with a non-empty cart. */}
              <div className="mb-4">
                {/* The server's discount is only passed when the quote's applied coupon is
                    the CAMPAIGN's own — otherwise an unrelated coupon's discount would be
                    displayed under the campaign's label. */}
                <CampaignMeter
                  cartValue={cartSubtotal}
                  appliedDiscount={quote?.appliedCampaign ? quote.couponDiscount : null}
                />
              </div>

              {/*
                The offer, stated plainly, whether or not it has applied.

                A shopper cannot tell an offer that is working from one that is broken by
                looking at a total. Before this the cart said nothing at all: a signed-out
                visitor saw no discount and no reason for its absence, and had no way to
                know that signing in was worth anything.
              */}
              <CampaignCartNotice
                applied={Boolean(quote?.appliedCampaign)}
                discount={quote?.appliedCampaign ? quote.couponDiscount : 0}
                cartValue={cartSubtotal}
              />

              {quoteError && (
                /* The totals below are the browser's own fallback when the server's
                   pricing call fails — no tax, no discount. Saying so is the difference
                   between a wrong number and a known-unreliable one. */
                <p className="mb-4 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  We could not price your bag just now, so tax and any offer are not shown
                  here. Your final total is confirmed at checkout.
                </p>
              )}

              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-ink/70 font-display text-sm">
                  <span>Subtotal</span>
                  <span>{quote ? formatPrice(quote.subtotal) : '—'}</span>
                </div>
                {quote && quote.couponDiscount > 0 && (
                  /* Exact, because the lines above break this figure down: rounding the
                     total while the parts keep their paise leaves a shopper adding up
                     the bag and finding a rupee that is not there. */
                  <div className="flex justify-between text-gold font-display text-sm">
                    <span>Discount ({quote.appliedCoupon?.code})</span>
                    <span>−{formatPrice(quote.couponDiscount, { exact: true })}</span>
                  </div>
                )}
                {quote && quote.savings?.total > 0 && (
                  // The honest headline: what the catalogue already took off PLUS what
                  // the code added. Server-resolved; nothing here is summed in the browser.
                  <div className="flex justify-between text-emerald-500 font-display text-sm">
                    <span>You save</span>
                    <span>{formatPrice(quote.savings.total, { exact: true })}</span>
                  </div>
                )}
                <div className="flex justify-between text-ink/70 font-display text-sm">
                  <span>Tax (18% GST)</span>
                  {/* Never print a confident ₹0. Tax is inclusive and always non-zero on a
                      real basket, so a zero here means the quote did not load — which read
                      as "no tax charged" rather than "not calculated yet". */}
                  <span>{quote ? formatPrice(quote.tax) : '—'}</span>
                </div>
                <div className="border-t border-hairline pt-3 flex justify-between">
                  <span className="font-display font-light text-ink tracking-[-0.01em]">Total</span>
                  <span className="text-xl font-display font-bold text-gold">
                    {/*
                      Never the client's own total while the server's is in flight.

                      The fallback used to be `cart.total`, which is the UNDISCOUNTED sum —
                      so the page opened on the full price and dropped a second or two
                      later when the offer applied. A shopper reads that flicker as the
                      price changing under them, which on a money path is worse than a
                      brief "working it out".
                    */}
                    {quote
                      ? formatPrice(quote.totalAmount)
                      : awaitingPricing ? 'Working it out…' : '—'}
                  </span>
                </div>
              </div>

              <Link
                href="/checkout"
                className="w-full bg-gold text-obsidian font-display text-[11px] font-semibold uppercase tracking-[0.2em] py-4 transition-opacity hover:opacity-90 flex items-center justify-center gap-2.5"
              >
                Proceed to Checkout
                <ArrowRight className="h-4 w-4" />
              </Link>

              <div className="mt-4 text-center">
                <p className="text-xs text-ink-muted font-display">🔒 Secure Checkout · Safe Payment</p>
              </div>

              {/* Promo code */}
              <div className="mt-6 pt-6 border-t border-hairline">
                <p className="text-sm font-display font-bold text-ink/70 uppercase tracking-widest mb-2">Have a promo code?</p>

                {cart.couponCode ? (
                  <div className="flex items-center justify-between gap-2 bg-obsidian-raised border border-gold/40 rounded-sm px-3 py-2">
                    <span className="text-sm font-display font-bold text-gold">{cart.couponCode} applied</span>
                    <button
                      onClick={handleRemoveCoupon}
                      disabled={couponBusy}
                      className="text-ink-muted hover:text-red-400 transition-colors disabled:opacity-50"
                      title="Remove coupon"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleApplyCoupon(); }}
                      placeholder="Enter code"
                      className="flex-1 bg-obsidian-raised border border-hairline text-ink placeholder:text-ink-muted rounded-sm px-3 py-2 text-sm focus:outline-none focus:border-gold font-display"
                    />
                    <button
                      onClick={handleApplyCoupon}
                      disabled={!couponInput.trim() || couponBusy}
                      className="bg-obsidian-raised hover:bg-gold text-ink/70 hover:text-obsidian px-4 py-2 rounded-sm text-sm font-display font-bold uppercase tracking-widest transition-colors disabled:opacity-50 disabled:hover:bg-obsidian-raised disabled:hover:text-ink/70"
                    >
                      {couponBusy ? '…' : 'Apply'}
                    </button>
                  </div>
                )}

                {!cart.couponCode && availableCoupons.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {availableCoupons.map((c) => (
                      <button
                        key={c.code}
                        onClick={() => setCouponInput(c.code)}
                        title={c.description || ''}
                        className="text-xs font-display font-bold uppercase tracking-wide text-gold border border-gold/30 hover:border-gold rounded-sm px-2 py-1 transition-colors"
                      >
                        {c.code}
                      </button>
                    ))}
                  </div>
                )}

                {couponError && (
                  <p className="text-red-400 text-xs font-display mt-1.5">{couponError}</p>
                )}
                {/* A coupon valid at apply time can lapse (expiry, stock, cart edits). The
                    checkout re-quotes and order creation hard-fails on a now-invalid code. */}
                {cart.couponCode && quote?.couponError && (
                  <p className="text-red-400 text-xs font-display mt-1.5">{quote.couponError}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
