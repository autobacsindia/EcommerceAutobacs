import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ShoppingCart, SlidersHorizontal, Gift } from 'lucide-react';
import { toast } from 'react-hot-toast';
import apiClient from '@/lib/api';
import { useCart } from '@/context/CartContext';
import { getStockStatus } from '@/lib/stock';
import {
  useCampaignProductRates,
  campaignSavingLabel,
  formatSavingInr,
  lineSavings,
} from '@/hooks/queries/useCampaignProductRates';
import { useCampaignBadgeVisible } from '@/hooks/queries/useCampaign';
import { useAddedToCartToast } from '@/hooks/useAddedToCartToast';
import ProductRail, { RAIL_CONTAINER, RAIL_ITEM, RAIL_IMAGE_SIZES, RAIL_LIMIT } from './ProductRail';

interface Product {
  _id: string;
  name: string;
  slug: string;
  price: number;
  originalPrice?: number;
  images?: Array<{ url: string; alt?: string }> | string[];
  averageRating?: number;
  totalReviews?: number;
  brand?: string;
  categories?: Array<{ name: string; slug: string }>;
  productType?: 'simple' | 'variable' | 'grouped';
  priceMin?: number | null;
  priceMax?: number | null;
  stock?: number;
}

interface ComplementaryProductsSectionProps {
  productId: string;
  isDark?: boolean;
}

export default function ComplementaryProductsSection({ productId, isDark = true }: ComplementaryProductsSectionProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { addToCart } = useCart();
  // This rail fetches its own products, so unlike the sticky bar its ids differ from
  // the PDP's — one extra batched request (identity-free, shared cache, 10min stale)
  // rather than one per card. A cross-sell rail is exactly where the campaign should
  // be visible: "add this too and save X%" is the whole pitch.
  const { data: campaignData } = useCampaignProductRates(products.map((p) => p._id));
  const campaignBadgeVisible = useCampaignBadgeVisible();
  const notifyAdded = useAddedToCartToast();

  /**
   * This product's campaign rate, or 0. Mirrors the badge's own gate below so the
   * toast can never claim a saving the card above it declined to advertise — a
   * sold-out item still earns a rate but cannot be checked out with.
   */
  const campaignRateFor = (product: Product) =>
    campaignBadgeVisible && getStockStatus(product) !== 'out'
      ? campaignData?.rates?.[product._id]?.percent ?? 0
      : 0;

  /**
   * The same rate stated as MONEY, for the badge. Shares `campaignSavingLabel` with
   * StoreProductCard so this rail — which draws its own card rather than reusing that
   * one — cannot drift into a second way of writing the same offer.
   */
  const campaignSavingFor = (product: Product) =>
    campaignSavingLabel({
      saving: lineSavings({
        price: product.price,
        quantity: 1,
        percent: campaignRateFor(product),
      }).campaign,
      formatPrice: formatSavingInr,
      /* "From" only when the card itself shows a range — the same test `showsFrom`
         applies below. A variable product whose variants all cost the same prices
         flatly, and labelling its saving as a floor would be gratuitously vague. */
      from: product.productType === 'variable'
        && product.priceMin != null && product.priceMax != null
        && product.priceMax > product.priceMin,
    });

  const handleAddToCart = async (e: React.MouseEvent, product: Product) => {
    // The card is a Link — stop the click from navigating to the PDP.
    e.preventDefault();
    e.stopPropagation();
    if (addingId) return;
    setAddingId(product._id);
    try {
      // Normalize images to the ProductImage[] the optimistic line expects.
      const images = (product.images ?? []).map((img) =>
        typeof img === 'string' ? { url: img } : img
      );
      await addToCart(product._id, 1, {
        name: product.name,
        price: product.price,
        images,
        stock: getStockStatus(product),
      });
      notifyAdded({
        price: product.price,
        originalPrice: product.originalPrice,
        campaignPercent: campaignRateFor(product),
      });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add to cart');
    } finally {
      setAddingId(null);
    }
  };

  useEffect(() => {
    const fetchComplementaryProducts = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response: any = await apiClient.get(`/products/${productId}/complementary?limit=${RAIL_LIMIT}`);
        
        console.log('[ComplementaryProductsSection] API Response:', response);
        console.log('[ComplementaryProductsSection] Response.success:', response.success);
        console.log('[ComplementaryProductsSection] Response.products:', response.products);
        console.log('[ComplementaryProductsSection] Response.products.length:', response.products?.length);
        
        if (response.success && Array.isArray(response.products)) {
          console.log('[ComplementaryProductsSection] Setting products:', response.products.length);
          setProducts(response.products);
        } else {
          console.log('[ComplementaryProductsSection] Invalid response format');
        }
      } catch (err) {
        console.error('[ComplementaryProductsSection] Fetch error:', err);
        setError('Failed to load complementary products');
      } finally {
        setLoading(false);
      }
    };

    if (productId) {
      fetchComplementaryProducts();
    }
  }, [productId]);

  if (loading) {
    return (
      <section 
        aria-labelledby="complementary-products-heading"
        className="mt-16"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 
            id="complementary-products-heading"
            className={`text-2xl font-bold mb-6 ${isDark ? 'text-ink' : 'text-ink'}`}
          >
            Frequently Bought Together
          </h2>
          
          <div className={RAIL_CONTAINER}>
            {[...Array(RAIL_LIMIT)].map((_, i) => (
              <div key={i} className={`${RAIL_ITEM} ${isDark ? 'bg-obsidian-raised' : 'bg-obsidian'} rounded-lg shadow-sm overflow-hidden animate-pulse`}>
                <div className={`aspect-square ${isDark ? 'bg-obsidian-raised' : 'bg-obsidian-raised'}`} />
                <div className="p-4 space-y-3">
                  <div className={`h-4 ${isDark ? 'bg-obsidian-raised' : 'bg-obsidian-raised'} rounded w-3/4`} />
                  <div className={`h-3 ${isDark ? 'bg-obsidian-raised' : 'bg-obsidian-raised'} rounded w-1/2`} />
                  <div className={`h-5 ${isDark ? 'bg-obsidian-raised' : 'bg-obsidian-raised'} rounded w-1/3`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (error || products.length === 0) {
    return null;
  }

  return (
    <section 
      aria-labelledby="complementary-products-heading"
      className={`mt-16 py-12 ${isDark ? 'bg-obsidian-deep' : 'bg-linear-to-br from-gold to-gold'}`}
      ref={containerRef}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 
              id="complementary-products-heading"
              className={`text-2xl font-bold ${isDark ? 'text-ink' : 'text-ink'}`}
              aria-live="polite"
            >
              Frequently Bought Together
            </h2>
            <p className={`text-sm mt-1 ${isDark ? 'text-ink-muted' : 'text-ink-muted'}`}>
              Complete your purchase with these complementary items
            </p>
          </div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${isDark ? 'bg-green-900/50 text-green-300' : 'bg-green-100 text-green-800'}`}>
            💡 Recommended
          </span>
        </div>
        
        <ProductRail label="Frequently bought together">
          {products.map((product) => {
            const getImageUrl = () => {
              if (!product.images || product.images.length === 0) {
                return '/placeholder-product.jpg';
              }
              
              const firstImage = product.images[0];
              return typeof firstImage === 'string' 
                ? firstImage 
                : firstImage?.url || '/placeholder-product.jpg';
            };

            const getImageAlt = () => {
              if (!product.images || product.images.length === 0) {
                return product.name;
              }
              
              const firstImage = product.images[0];
              return typeof firstImage === 'string' 
                ? product.name 
                : firstImage?.alt || product.name;
            };

            const discount = product.originalPrice && product.originalPrice > product.price
              ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
              : null;

            const isVariable = product.productType === 'variable';
            const isOut = getStockStatus(product) === 'out';
            // Variable price = cheapest variant (priceMin); show it as a "From" range.
            const showsFrom = isVariable
              && product.priceMin != null && product.priceMax != null
              && product.priceMax > product.priceMin;

            return (
              <article
                key={product._id}
                // flex-col + mt-auto on the action row keeps the CTA bottom-aligned
                // now that cards stretch to a common height in both layouts.
                className={`${RAIL_ITEM} flex flex-col ${isDark ? 'bg-obsidian-raised hover:bg-obsidian-raised' : 'bg-obsidian hover:bg-obsidian-deep'} rounded-lg shadow-sm overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 focus-within:ring-2 focus-within:ring-gold focus-within:ring-offset-2`}
                tabIndex={0}
                role="link"
                aria-label={`View ${product.name} - ₹${product.price}`}
              >
                <Link href={`/products/${product.slug}`} className="block">
                  <div className={`relative aspect-square ${isDark ? 'bg-obsidian-raised' : 'bg-obsidian-deep'} overflow-hidden`}>
                    <Image
                      src={getImageUrl()}
                      alt={getImageAlt()}
                      fill
                      sizes={RAIL_IMAGE_SIZES}
                      className="object-contain p-4 transition-transform duration-300 hover:scale-105"
                      loading="lazy"
                    />
                    {discount && (
                      <div className="absolute top-2 left-2 bg-red-500 text-ink px-2 py-1 rounded text-xs font-bold">
                        {discount}% OFF
                      </div>
                    )}
                    {campaignSavingFor(product) && (
                      <div className="absolute top-2 right-2 flex items-center gap-1 rounded border border-gold/50 bg-obsidian-deep/85 px-2 py-1 text-xs font-bold text-gold backdrop-blur">
                        <Gift className="h-3 w-3 shrink-0" aria-hidden />
                        {campaignSavingFor(product)}
                      </div>
                    )}
                  </div>
                  
                  <div className="p-4">
                    <h3 className={`font-semibold text-sm line-clamp-2 mb-2 ${isDark ? 'text-ink hover:text-gold' : 'text-ink hover:text-gold'} transition-colors`}>
                      {product.name}
                    </h3>
                    
                    <div className="flex items-baseline gap-2 mb-2">
                      {showsFrom && (
                        <span className="text-[10px] uppercase tracking-wider text-ink-muted">From</span>
                      )}
                      <span className={`text-lg font-bold ${isDark ? 'text-ink' : 'text-ink'}`}>
                        ₹{product.price.toLocaleString('en-IN')}
                      </span>
                      {!isVariable && product.originalPrice != null && product.originalPrice > product.price && (
                        <span className={`text-sm ${isDark ? 'text-ink-muted' : 'text-ink-muted'} line-through`}>
                          ₹{product.originalPrice.toLocaleString('en-IN')}
                        </span>
                      )}
                    </div>
                    
                    {product.averageRating != null && product.averageRating > 0 && (
                      <div className="flex items-center gap-1 mb-2">
                        <svg className="w-4 h-4 text-yellow-400 fill-current" viewBox="0 0 20 20">
                          <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
                        </svg>
                        <span className={`text-sm ${isDark ? 'text-ink-muted' : 'text-ink-muted'}`}>
                          {product.averageRating.toFixed(1)} ({product.totalReviews || 0})
                        </span>
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between mt-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${isDark ? 'bg-gold/50 text-gold' : 'bg-gold/10 text-gold'}`}>
                        {product.brand || 'Autobacs'}
                      </span>
                      <span className={`text-xs ${isDark ? 'text-ink-muted' : 'text-ink-muted'}`}>
                        {product.categories?.[0]?.name || 'Auto Parts'}
                      </span>
                    </div>
                  </div>
                </Link>

                {/* Action row — sibling of the Link (interactive controls can't nest
                    inside an <a>). Variable products can't be quick-added: a model
                    must be chosen on the PDP, so they get a "Select options" link. */}
                <div className="mt-auto px-4 pb-4">
                  {isVariable ? (
                    <Link
                      href={`/products/${product.slug}`}
                      className="flex items-center justify-center gap-2 w-full bg-gold text-obsidian px-4 py-2 rounded-md hover:opacity-90 transition-opacity font-semibold text-sm"
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      Select options
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => handleAddToCart(e, product)}
                      disabled={isOut || addingId === product._id}
                      className="flex items-center justify-center gap-2 w-full bg-gold text-obsidian px-4 py-2 rounded-md hover:opacity-90 transition-opacity font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ShoppingCart className="h-4 w-4" />
                      {isOut ? 'Out of stock' : addingId === product._id ? 'Adding…' : 'Add to cart'}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </ProductRail>

        <div className="mt-8 text-center">
          <Link 
            href="/products"
            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-obsidian bg-gold hover:opacity-90 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gold"
          >
            Browse All Products
          </Link>
        </div>
      </div>
    </section>
  );
}
