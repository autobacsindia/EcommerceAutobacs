'use client';

import Link from 'next/link';
import { Heart, ShoppingBag } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import ProductImage from '@/components/products/ProductImage';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { useAuth } from '@/context/AuthContext';
import { useCurrency } from '@/context/CurrencyContext';
import { Product, productUrl } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Storefront product card (obsidian + gold). Self-contained client island —
 * owns wishlist + add-to-cart directly so the whole card is on-theme. Adopts the
 * MLC reference pattern (favourite heart, status badge, price + gold add button)
 * reskinned to the home design's hover vocabulary (image scale, gold accents).
 */
export default function StoreProductCard({
  product,
  featured = false,
  className,
}: {
  product: Product;
  featured?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const url = productUrl(product);
  const { addToCart } = useCart();
  const { isAuthenticated } = useAuth();
  const { isInWishlist, addToWishlist, removeFromWishlist } = useWishlist();
  const { formatPrice } = useCurrency();

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

  const onSale = !!product.originalPrice && product.originalPrice > product.price;
  const discount = onSale
    ? Math.round(((product.originalPrice! - product.price) / product.originalPrice!) * 100)
    : 0;
  const outOfStock = product.stock === 'out';
  const wished = isInWishlist(product._id);

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
    try {
      await addToCart(product._id, 1);
      toast.success('Added to cart');
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
          {outOfStock && (
            <span className="bg-obsidian-deep/85 px-2.5 py-1 text-[9px] uppercase tracking-[0.22em] text-ink-muted backdrop-blur">
              Sold out
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
      <div className="flex flex-1 flex-col p-5">
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
        <div className="mt-auto flex items-end justify-between pt-2">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-[18px] font-medium text-ink">{formatPrice(product.price)}</span>
            {onSale && (
              <span className="font-display text-[12px] text-ink-muted line-through">
                {formatPrice(product.originalPrice!)}
              </span>
            )}
          </div>
          <button
            onClick={add}
            disabled={outOfStock}
            aria-label="Add to cart"
            className={cn(
              'grid h-10 w-10 place-items-center rounded-full transition-all duration-300',
              outOfStock
                ? 'cursor-not-allowed border border-hairline text-ink-muted'
                : 'bg-gold text-obsidian hover:scale-105'
            )}
          >
            <ShoppingBag className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );

  const shell = cn(
    'group relative flex flex-col overflow-hidden border border-hairline bg-obsidian transition-colors duration-300 hover:border-gold/40',
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
