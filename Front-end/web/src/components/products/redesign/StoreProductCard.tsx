'use client';

import Link from 'next/link';
import { Heart, ShoppingBag, HeadphonesIcon, SlidersHorizontal, Gift } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import ProductImage from '@/components/products/ProductImage';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useAuth } from '@/context/AuthContext';
import { useCurrency } from '@/context/CurrencyContext';
import { Product, productUrl } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useAddedToCartToast } from '@/hooks/useAddedToCartToast';
import {
  campaignSavingLabel,
  lineSavings,
  type ProductRate,
} from '@/hooks/queries/useCampaignProductRates';

/**
 * Storefront product card (obsidian + gold). Self-contained client island —
 * owns wishlist + add-to-cart directly so the whole card is on-theme. Adopts the
 * MLC reference pattern (favourite heart, status badge, price + gold add button)
 * reskinned to the home design's hover vocabulary (image scale, gold accents).
 */
export default function StoreProductCard({
  product,
  featured = false,
  fitmentBadge,
  campaignRate,
  className,
}: {
  product: Product;
  featured?: boolean;
  /** When set (vehicle pages), shows a green "Fits <vehicle>" compatibility pill. */
  fitmentBadge?: string;
  /**
   * This product's rate under the running campaign, batch-fetched by the
   * caller (one request for the whole grid via `useCampaignProductRates`) rather than
   * per-card — see `ProductGrid`. `null`/`undefined` renders no badge, same as "no
   * campaign running" or "this user can no longer claim it".
   */
  campaignRate?: ProductRate | null;
  className?: string;
}) {
  const router = useRouter();
  const url = productUrl(product);
  const { addToCart } = useCart();
  const { isAuthenticated } = useAuth();
  const { isInWishlist, addToWishlist, removeFromWishlist } = useWishlist();
  const { formatPrice } = useCurrency();
  // Reads the same cached eligibility answer as the badge/banner, so a whole grid of
  // these shares one entry — see `useAddedToCartToast`.
  const notifyAdded = useAddedToCartToast();

  const firstImage =
    Array.isArray(product.images) && product.images.length > 0
      ? product.images[0].url
      : typeof product.images === 'string'
        ? product.images
        : '';

  const categoryName =
    product.categories?.[0]?.name ??
    (typeof product.category === 'object' && product.category ? (product.category as { name?: string }).name : undefined) ??
    (typeof product.category === 'string' ? product.category : undefined);

  // A variable product can't be quick-added from a card (a model must be picked on
  // the PDP), so it shows a "From" price and a Select affordance that opens the PDP.
  const isVariable = product.productType === 'variable';
  const priceMin = product.priceMin ?? product.price;
  const priceMax = product.priceMax ?? product.price;
  const showsRange = isVariable && priceMax > priceMin;

  const onSale = !isVariable && !!product.originalPrice && product.originalPrice > product.price;
  const discount = onSale
    ? Math.round(((product.originalPrice! - product.price) / product.originalPrice!) * 100)
    : 0;
  const outOfStock = product.stock === 'out';
  const backorder = product.stock === 'backorder';
  const wished = isInWishlist(product._id);
  // Sold-out items still earn a rate, but advertising a discount nobody can check out
  // with is a broken promise dressed as marketing. Card-specific: unlike the PDP badge
  // (which a shopper reaches deliberately and which only gates on variant selection),
  // a card is a discovery surface sitting right next to an explicit "Sold out" badge —
  // showing both reads as a mixed message the PDP doesn't have to worry about.
  const campaignPercent = !outOfStock && campaignRate && campaignRate.percent > 0 ? campaignRate.percent : 0;
  /*
    The offer as MONEY, not as a rate.

    A percentage on a card is a sum the shopper has to do before they know whether the
    offer is worth anything — and 8% reads identically on a ₹900 mat and a ₹8 lakh body
    kit, which is precisely the comparison a discovery surface exists to make easy.

    Computed from the price this card is DISPLAYING (a variable product shows its cheapest
    variant), so the badge and the price beneath it always describe the same unit. Both
    inputs are server-published and `lineSavings` floors paise exactly as the server does,
    so the figure here cannot drift from what the cart charges.
  */
  const campaignSaving = campaignSavingLabel({
    saving: lineSavings({
      price: isVariable ? priceMin : product.price,
      quantity: 1,
      percent: campaignPercent,
    }).campaign,
    // Exact: rounding ₹29.97 up to "₹30 off" is a promise the cart then breaks.
    formatPrice: (v) => formatPrice(v, { exact: true }),
    from: showsRange,
  });

  const toggleWish = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated) return router.push('/login');
    try {
      wished ? await removeFromWishlist(product._id) : await addToWishlist(product._id);
      toast.success(wished ? 'Removed from wishlist' : 'Added to wishlist');
    } catch {
      toast.error('Failed to update wishlist');
    }
  };

  const add = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (outOfStock) return;
    // Variable products need a model chosen on the PDP — the server rejects an
    // add without a variant, so send the shopper there instead of quick-adding.
    if (isVariable) {
      if (url) router.push(url);
      return;
    }
    // Backorder is enquiry-only — route to the consultation flow with the
    // product name prefilled instead of adding to cart.
    if (backorder) {
      router.push(`/consultation?product=${encodeURIComponent(product.name)}`);
      return;
    }
    // Optimistic: the cart badge and this toast fire on tap; addToCart rolls the
    // count back and the catch surfaces an error toast if the server rejects.
    notifyAdded({
      price: product.price,
      originalPrice: product.originalPrice,
      campaignPercent,
    });
    try {
      await addToCart(product._id, 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add to cart');
    }
  };

  const CardInner = (
    <>
      {/* Image */}
      <div className="relative aspect-[4/5] overflow-hidden bg-obsidian-raised">
        {firstImage ? (
          <ProductImage
            src={firstImage}
            alt={product.name}
            className="h-full w-full object-cover brightness-[0.92] transition-transform duration-[900ms] ease-lux group-hover:scale-[1.06]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[11px] uppercase tracking-[0.2em] text-ink-muted">
            No image
          </div>
        )}

        {/* Badges */}
        <div className="absolute left-4 top-4 flex flex-col items-start gap-1.5">
          {fitmentBadge && (
            <span className="bg-emerald-500 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-obsidian">
              ✓ Fits {fitmentBadge}
            </span>
          )}
          {outOfStock && (
            <span className="bg-obsidian-deep/85 px-2.5 py-1 text-[9px] uppercase tracking-[0.22em] text-ink-muted backdrop-blur">
              Sold out
            </span>
          )}
          {product.stock === 'backorder' && (
            <span className="bg-obsidian-deep/85 px-2.5 py-1 text-[9px] uppercase tracking-[0.22em] text-gold backdrop-blur">
              Backorder
            </span>
          )}
          {onSale && !outOfStock && (
            <span className="bg-gold px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-obsidian">
              -{discount}%
            </span>
          )}
          {featured && !onSale && !outOfStock && (
            <span className="bg-gold px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-obsidian">
              ★ Top pick
            </span>
          )}
          {campaignSaving && (
            <span className="flex items-center gap-1 border border-gold/50 bg-obsidian-deep/85 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-gold backdrop-blur">
              <Gift size={10} className="shrink-0" aria-hidden />
              {campaignSaving}
            </span>
          )}
        </div>

        {/* Wishlist */}
        <button
          onClick={toggleWish}
          aria-label={wished ? 'Remove from wishlist' : 'Add to wishlist'}
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-obsidian-deep/70 backdrop-blur transition-colors hover:bg-obsidian-deep"
        >
          <Heart className={cn('h-4 w-4 transition-colors', wished ? 'fill-gold text-gold' : 'text-ink-muted')} />
        </button>
      </div>

      {/* Body */}
      {/* Padding steps down on phones. In a 2-up grid a card is ~165px wide, so
          `p-5` spends a quarter of it on whitespace — width the price and the
          add button then have to fight over. */}
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        {categoryName && (
          <p className="mb-2 font-display text-[9px] uppercase tracking-[0.26em] text-gold">{categoryName}</p>
        )}
        <h3 className="mb-2 line-clamp-2 font-display text-[15px] font-normal leading-snug text-ink transition-colors group-hover:text-gold">
          {product.name}
        </h3>

        {product.averageRating > 0 && (
          <div className="mb-3 flex items-center gap-1.5">
            <span className="text-[12px] tracking-[1px] text-gold" aria-hidden>
              {'★'.repeat(Math.round(product.averageRating))}
              <span className="text-hairline">{'★'.repeat(5 - Math.round(product.averageRating))}</span>
            </span>
            <span className="font-display text-[11px] text-ink-muted">{product.averageRating.toFixed(1)}</span>
          </div>
        )}

        {/* Price + add */}
        {/*
          The add button MUST NOT shrink, and the price MUST NOT be able to push it.

          Both are flex items, and a flex item's default `min-width: auto` means it
          cannot shrink below its min-content width. A price is one unbreakable token,
          so the price block never yields — which left the button as the only thing in
          the row that could absorb a deficit. On a ~165px phone card it duly collapsed
          from 40px to the 16px of its icon and then spilled past the card edge, where
          the shell's `overflow-hidden` cut it off. Measured on prod at 390px: every
          discounted card lost its add button, and at 360px so did 15 of 20 cards,
          discounted or not. This is the primary conversion control on the primary
          discovery surface, so it wins the row outright:

            - `shrink-0` on the button — its 40px is reserved before anything else.
            - `min-w-0` + `flex-wrap` on the price block — the compare-at price drops
              to a second line rather than shoving, since MRP is the secondary figure.
            - a smaller type step below `sm` — at 18px the widest live price (₹4,95,000,
              89.5px) did not fit the 85px a phone card can offer even with no MRP
              beside it, so `shrink-0` alone would only have moved the clipping onto
              the price.

          Verified in a real browser against the live grid at 360/390/430px, including
          a forced 7-figure price: button 40px and fully inside the card in every case.
          jsdom has no layout, so the tests below can only pin the classes.
        */}
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            {showsRange && (
              <span className="font-display text-[10px] uppercase tracking-[0.14em] text-ink-muted">From</span>
            )}
            <span className="font-display text-[16px] font-medium text-ink sm:text-[18px]">
              {formatPrice(isVariable ? priceMin : product.price)}
            </span>
            {onSale && (
              <span className="font-display text-[11px] text-ink-muted line-through sm:text-[12px]">
                {formatPrice(product.originalPrice!)}
              </span>
            )}
          </div>
          <button
            onClick={add}
            disabled={outOfStock}
            aria-label={isVariable ? 'Select a model' : backorder ? 'Enquire about this product' : 'Add to cart'}
            title={isVariable ? 'Choose a model on the product page' : backorder ? 'On backorder — click to enquire' : undefined}
            className={cn(
              'grid h-10 w-10 shrink-0 place-items-center rounded-full transition-all duration-300',
              outOfStock
                ? 'cursor-not-allowed border border-hairline text-ink-muted'
                : 'bg-gold text-obsidian hover:scale-105'
            )}
          >
            {isVariable ? <SlidersHorizontal className="h-4 w-4" /> : backorder ? <HeadphonesIcon className="h-4 w-4" /> : <ShoppingBag className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </>
  );

  const shell = cn(
    'group relative flex flex-col overflow-hidden border border-hairline bg-obsidian font-display transition-colors duration-300 hover:border-gold/40',
    className
  );

  return url ? (
    <Link href={url} className={shell}>
      {CardInner}
    </Link>
  ) : (
    <div className={shell}>{CardInner}</div>
  );
}
