'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingBag, Zap, Heart, Shield, Truck, RotateCcw, CreditCard, HeadphonesIcon } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { StockStatus } from '@/lib/stock';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useAuth } from '@/context/AuthContext';
import { useCurrency } from '@/context/CurrencyContext';
import { TRUST_BADGES, type TrustIcon } from '@/lib/storePolicies';
import Eyebrow from '@/components/ui/Eyebrow';
import SaleCountdown, { useSaleCountdown } from '@/components/products/SaleCountdown';
import EmiOptions from '@/components/products/redesign/EmiOptions';

const TRUST_ICONS: Record<TrustIcon, typeof Shield> = { CreditCard, Shield, Truck, RotateCcw };
const MAX_QTY = 99;

export interface ProductVariant {
  _id: string;
  label: string;
  price: number;
  originalPrice?: number | null;
  stock: StockStatus;
  sku?: string;
}

interface BuyBoxProduct {
  _id: string;
  name: string;
  price: number;
  originalPrice?: number;
  saleEndsAt?: string | null;
  stock: StockStatus;
  sku?: string;
  category?: { name: string } | string;
  averageRating: number;
  totalReviews: number;
  shortDescription?: string;
  // Variable-product fields (absent/simple for the vast majority).
  productType?: 'simple' | 'variable' | 'grouped';
  variants?: ProductVariant[];
  priceMin?: number;
  priceMax?: number;
}

/**
 * PDP purchase panel (obsidian + gold), modelled on the Treato's reference:
 * category eyebrow → title → rating → price → quantity → CTAs → trust badges.
 *
 * Uses only real signals (rating, review count, stock, verified policies) — we
 * never fabricate "N people bought this" social proof (see storePolicies.ts).
 */
export default function BuyBox({
  product,
  selectedVariantId,
  onSelectVariant,
}: {
  product: BuyBoxProduct;
  selectedVariantId?: string | null;
  onSelectVariant?: (variantId: string) => void;
}) {
  const router = useRouter();
  const { addToCart } = useCart();
  const { isAuthenticated } = useAuth();
  const { isInWishlist, addToWishlist, removeFromWishlist } = useWishlist();
  const { formatPrice } = useCurrency();

  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [buying, setBuying] = useState(false);

  // ── Variable-product resolution ────────────────────────────────────────────
  // For a variable product the buyable unit is the SELECTED variant, which
  // carries its own price + stock. Until one is picked we show a price RANGE and
  // keep Add/Buy disabled. Simple products fall through to their own fields.
  const isVariable = product.productType === 'variable' && (product.variants?.length ?? 0) > 0;
  const variants = product.variants ?? [];
  const selectedVariant = isVariable ? variants.find((v) => v._id === selectedVariantId) ?? null : null;
  const needsSelection = isVariable && !selectedVariant;

  const activePrice = selectedVariant ? selectedVariant.price : product.price;
  const activeOriginal = selectedVariant ? selectedVariant.originalPrice ?? undefined : product.originalPrice;
  // With no selection yet, treat stock as unknown so CTAs stay gated on selection.
  const activeStock: StockStatus | undefined = selectedVariant ? selectedVariant.stock : isVariable ? undefined : product.stock;
  const priceMin = product.priceMin ?? product.price;
  const priceMax = product.priceMax ?? product.price;

  const { live: saleLive } = useSaleCountdown(product.saleEndsAt);
  const onSale =
    !!activeOriginal &&
    activeOriginal > activePrice &&
    // The time-boxed countdown only applies to simple-product sales; variant
    // "was" prices are static badges.
    (isVariable || !product.saleEndsAt || saleLive);
  const discount = onSale
    ? Math.round(((activeOriginal! - activePrice) / activeOriginal!) * 100)
    : 0;
  const outOfStock = activeStock === 'out';
  const backorder = activeStock === 'backorder';
  const wished = isInWishlist(product._id);

  // Backorder items are enquiry-only — routed to the consultation flow with the
  // product name prefilled, instead of Add to cart / Buy now.
  const enquire = () =>
    router.push(`/consultation?product=${encodeURIComponent(product.name)}`);
  const categoryName =
    typeof product.category === 'object' ? product.category?.name : product.category;

  // Optimistic snapshot for the cart line (variant-aware).
  const snapshot = () => ({
    name: product.name,
    price: activePrice,
    images: [] as [],
    stock: activeStock ?? ('in' as StockStatus),
    variantLabel: selectedVariant?.label ?? null,
  });

  const add = async () => {
    if (needsSelection) { toast.error('Please select a model first'); return; }
    setAdding(true);
    // Optimistic: badge + toast fire on tap; a server rejection rolls the count
    // back (in addToCart) and the catch surfaces an error toast.
    toast.success(`Added ${qty} to cart`);
    try {
      await addToCart(product._id, qty, snapshot(), selectedVariant?._id ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add to cart');
    } finally {
      setAdding(false);
    }
  };

  const buyNow = async () => {
    if (needsSelection) { toast.error('Please select a model first'); return; }
    setBuying(true);
    try {
      await addToCart(product._id, qty, snapshot(), selectedVariant?._id ?? null);
      router.push('/checkout');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add to cart');
      setBuying(false);
    }
  };

  const toggleWish = async () => {
    if (!isAuthenticated) return router.push('/login');
    try {
      wished ? await removeFromWishlist(product._id) : await addToWishlist(product._id);
      toast.success(wished ? 'Removed from wishlist' : 'Added to wishlist');
    } catch {
      toast.error('Failed to update wishlist');
    }
  };

  const rounded = Math.round(product.averageRating);

  return (
    <div className="font-display">
      {categoryName && <Eyebrow>{categoryName}</Eyebrow>}

      <h1 className="mt-4 text-[clamp(30px,3.6vw,48px)] font-light leading-[1.05] tracking-[-0.01em] text-ink">
        {product.name}
      </h1>

      {/* Rating */}
      {product.averageRating > 0 && (
        <div className="mt-4 flex items-center gap-2.5">
          <span className="text-[15px] tracking-[2px] text-gold" aria-hidden>
            {'★'.repeat(rounded)}
            <span className="text-hairline">{'★'.repeat(5 - rounded)}</span>
          </span>
          <span className="text-[13px] text-ink">{product.averageRating.toFixed(1)}</span>
          {product.totalReviews > 0 && (
            <a href="#reviews" className="text-[12px] text-ink-muted underline-offset-4 hover:text-gold hover:underline">
              ({product.totalReviews} {product.totalReviews === 1 ? 'review' : 'reviews'})
            </a>
          )}
        </div>
      )}

      {/* Price — a range until a model is picked, then the exact variant price */}
      <div className="mt-7 flex flex-wrap items-baseline gap-3">
        {needsSelection ? (
          <span className="text-[40px] font-light leading-none text-ink">
            {priceMin === priceMax ? formatPrice(priceMin) : `${formatPrice(priceMin)} – ${formatPrice(priceMax)}`}
          </span>
        ) : (
          <span className="text-[40px] font-light leading-none text-ink">{formatPrice(activePrice)}</span>
        )}
        {onSale && (
          <>
            <span className="text-[16px] text-ink-muted line-through">{formatPrice(activeOriginal!)}</span>
            <span className="bg-gold px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-obsidian">
              -{discount}%
            </span>
          </>
        )}
      </div>
      <p className="mt-2 text-[12px] text-ink-muted">
        {needsSelection ? 'Select a model to see its price · ' : ''}Inclusive of all taxes · shipping at checkout
      </p>
      {onSale && !isVariable && <SaleCountdown saleEndsAt={product.saleEndsAt} className="mt-3" />}

      {/* Variant (model) selector — variable products only */}
      {isVariable && (
        <div className="mt-7">
          <label htmlFor="variant-select" className="block text-[10px] uppercase tracking-[0.24em] text-ink-muted">
            Select model
          </label>
          <select
            id="variant-select"
            value={selectedVariant?._id ?? ''}
            onChange={(e) => onSelectVariant?.(e.target.value)}
            className="mt-3 w-full appearance-none border border-hairline bg-obsidian-deep px-4 py-3.5 text-[14px] text-ink outline-none transition-colors focus:border-gold"
          >
            <option value="" disabled>
              Choose a model…
            </option>
            {variants.map((v) => (
              <option key={v._id} value={v._id} disabled={v.stock === 'out'}>
                {v.label}
                {v.stock === 'out' ? ' — Sold out' : ` — ${formatPrice(v.price)}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {product.shortDescription && (
        <p className="mt-6 max-w-prose text-[14px] font-light leading-[1.8] text-ink-muted">
          {product.shortDescription}
        </p>
      )}

      {/* Quantity — hidden for enquiry-only (backorder) items */}
      <div className="mt-8 flex items-center gap-5">
        {!backorder && (
          <>
            <span className="text-[10px] uppercase tracking-[0.24em] text-ink-muted">Quantity</span>
            <div className="flex items-center border border-hairline">
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                disabled={qty <= 1}
                className="grid h-11 w-11 place-items-center text-ink transition-colors hover:text-gold disabled:opacity-30"
                aria-label="Decrease quantity"
              >
                −
              </button>
              <span className="grid h-11 w-12 place-items-center border-x border-hairline text-[14px] text-ink">{qty}</span>
              <button
                onClick={() => setQty((q) => Math.min(MAX_QTY, q + 1))}
                disabled={qty >= MAX_QTY}
                className="grid h-11 w-11 place-items-center text-ink transition-colors hover:text-gold disabled:opacity-30"
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>
          </>
        )}
        {activeStock === 'low' && (
          <span className="text-[11px] uppercase tracking-[0.16em] text-gold">Low stock</span>
        )}
        {backorder && (
          <span className="text-[11px] uppercase tracking-[0.16em] text-gold">On backorder — enquire for availability</span>
        )}
        {outOfStock && (
          <span className="text-[11px] uppercase tracking-[0.16em] text-ink-muted">Sold out</span>
        )}
      </div>

      {/* EMI / affordability options (Razorpay) — mirrors the WooCommerce widget.
          Hidden until a model is chosen so it never advertises the range min. */}
      {!backorder && !needsSelection && <EmiOptions price={activePrice} className="mt-7" />}

      {/* CTAs */}
      <div className="mt-7 flex flex-col gap-3">
        {backorder ? (
          <div className="flex gap-3">
            <button
              onClick={enquire}
              className="flex flex-1 items-center justify-center gap-3 bg-gold py-4 font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-obsidian transition-opacity hover:opacity-90"
            >
              <HeadphonesIcon className="h-4 w-4" />
              Click to enquire
            </button>
            <button
              onClick={toggleWish}
              aria-label={wished ? 'Remove from wishlist' : 'Add to wishlist'}
              className="grid w-14 place-items-center border border-hairline transition-colors hover:border-gold"
            >
              <Heart className={`h-4 w-4 ${wished ? 'fill-gold text-gold' : 'text-ink-muted'}`} />
            </button>
          </div>
        ) : (
          <>
            {needsSelection && (
              <p className="text-[11px] uppercase tracking-[0.16em] text-gold">Select a model to continue</p>
            )}
            <button
              onClick={add}
              disabled={needsSelection || outOfStock || adding}
              className="flex items-center justify-center gap-3 bg-gold py-4 font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-obsidian transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ShoppingBag className="h-4 w-4" />
              {adding ? 'Adding…' : 'Add to cart'}
            </button>
            <div className="flex gap-3">
              <button
                onClick={buyNow}
                disabled={needsSelection || outOfStock || buying}
                className="flex flex-1 items-center justify-center gap-2.5 border border-gold py-4 font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-gold transition-colors hover:bg-gold hover:text-obsidian disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Zap className="h-4 w-4" />
                {buying ? 'Processing…' : 'Buy now'}
              </button>
              <button
                onClick={toggleWish}
                aria-label={wished ? 'Remove from wishlist' : 'Add to wishlist'}
                className="grid w-14 place-items-center border border-hairline transition-colors hover:border-gold"
              >
                <Heart className={`h-4 w-4 ${wished ? 'fill-gold text-gold' : 'text-ink-muted'}`} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Trust badges */}
      <div className="mt-9 grid grid-cols-3 gap-4 border-t border-hairline pt-7">
        {TRUST_BADGES.map(({ icon, label }) => {
          const Icon = TRUST_ICONS[icon];
          return (
            <div key={label} className="flex flex-col items-center gap-2.5 text-center">
              <Icon className="h-5 w-5 text-gold" />
              <span className="text-[10px] uppercase tracking-[0.14em] text-ink-muted">{label}</span>
            </div>
          );
        })}
      </div>

      {product.sku && (
        <p className="mt-6 text-[11px] uppercase tracking-[0.18em] text-ink-muted">SKU · {product.sku}</p>
      )}
    </div>
  );
}
