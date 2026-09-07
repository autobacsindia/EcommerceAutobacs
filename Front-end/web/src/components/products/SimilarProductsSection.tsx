import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Gift } from 'lucide-react';
import apiClient from '@/lib/api';
import ProductRail, { RAIL_CONTAINER, RAIL_ITEM, RAIL_IMAGE_SIZES, RAIL_LIMIT } from './ProductRail';
import { useCurrency } from '@/context/CurrencyContext';
import { useCampaignBadgeVisible } from '@/hooks/queries/useCampaign';
import {
  useCampaignProductRates,
  campaignSavingLabel,
  lineSavings,
} from '@/hooks/queries/useCampaignProductRates';

interface Product {
  _id: string;
  name: string;
  slug: string;
  price: number;
  originalPrice?: number;
  /* Needed only to tell a flat price from a "cheapest variant" one — see the badge. */
  productType?: string;
  priceMin?: number;
  priceMax?: number;
  /** Returned by /similar; read only to keep the campaign badge off sold-out items. */
  stock?: string;
  images?: Array<{ url: string; alt?: string }> | string[];
  averageRating?: number;
  totalReviews?: number;
  brand?: string;
  categories?: Array<{ name: string; slug: string }>;
}

interface SimilarProductsSectionProps {
  productId: string;
}

export default function SimilarProductsSection({ productId }: SimilarProductsSectionProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { formatPrice } = useCurrency();

  /*
    This rail was the one PDP surface the campaign never reached: the buy box, the
    cross-sell rail and every listing card announced the offer, and then the row directly
    beneath them priced the alternatives as if no offer existed. A shopper comparing two
    products across that boundary is comparing a discounted price with an undiscounted one.

    One batched, identity-free request for the whole rail — the same shared cache entry the
    rest of the page already holds.
  */
  const { data: campaignData } = useCampaignProductRates(products.map((p) => p._id));
  const campaignBadgeVisible = useCampaignBadgeVisible();

  /**
   * This product's campaign saving, or null.
   *
   * Sold-out items are excluded, mirroring `StoreProductCard` and the cross-sell rail:
   * they still earn a rate, but advertising a discount nobody can check out with is a
   * broken promise dressed as marketing. The gate lives on every card surface rather
   * than in the rates hook because the PDP badge deliberately does NOT apply it — there
   * the shopper arrived on purpose and the rate explains the price they are looking at.
   */
  const campaignSavingFor = (product: Product) =>
    campaignSavingLabel({
      saving: lineSavings({
        price: product.price,
        quantity: 1,
        percent:
          campaignBadgeVisible && product.stock !== 'out'
            ? campaignData?.rates?.[product._id]?.percent ?? 0
            : 0,
      }).campaign,
      /* The BADGE has to speak the same currency as the PRICE beside it.
         `formatSavingInr` hard-codes ₹, so once the price moved to
         CurrencyContext a USD shopper read "$3,228.92" with "+₹1,840 off"
         underneath it — a discount in a currency the price is not quoted in.
         Same injected formatter as `StoreProductCard`; `exact` keeps the paise,
         because a saving is a figure the shopper can check against the cart and
         rounding ₹29.97 up to "₹30 off" is a promise the cart then breaks. */
      formatPrice: (v) => formatPrice(v, { exact: true }),
      /* `product.price` on a variable product is its CHEAPEST variant, so the saving is a
         floor. Say so rather than state a figure that is wrong for every model but one. */
      from: product.productType === 'variable'
        && product.priceMin != null && product.priceMax != null
        && product.priceMax > product.priceMin,
    });

  useEffect(() => {
    const fetchSimilarProducts = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response: any = await apiClient.get(`/products/${productId}/similar?limit=${RAIL_LIMIT}`);
        
        if (response.success && Array.isArray(response.products)) {
          setProducts(response.products);
        } else {
          setError('No similar products found');
        }
      } catch (err) {
        console.error('[SimilarProductsSection] Fetch error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load similar products');
      } finally {
        setLoading(false);
      }
    };

    fetchSimilarProducts();
  }, [productId]);

  // Handle keyboard navigation for accessibility
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && containerRef.current) {
        containerRef.current.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (loading) {
    return (
      <section className="py-8 bg-obsidian-deep">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold mb-6 text-ink">Similar Products</h2>
          <div className={RAIL_CONTAINER}>
            {[...Array(RAIL_LIMIT)].map((_, i) => (
              <div key={i} className={`${RAIL_ITEM} bg-obsidian-raised rounded-lg shadow-sm overflow-hidden animate-pulse`}>
                <div className="h-48 bg-obsidian-raised" />
                <div className="p-4">
                  <div className="h-4 bg-obsidian-raised rounded w-3/4 mb-2" />
                  <div className="h-4 bg-obsidian-raised rounded w-1/2 mb-3" />
                  <div className="h-6 bg-obsidian-raised rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (error || products.length === 0) {
    return null; // Hide section if no similar products or error
  }

  return (
    <section 
      ref={containerRef}
      aria-labelledby="similar-products-heading"
      className="py-8 bg-obsidian-deep"
      tabIndex={-1}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 
          id="similar-products-heading"
          className="text-2xl font-bold mb-6 text-ink"
          aria-live="polite"
        >
          Similar Products
        </h2>
        
        <ProductRail label="Similar products">
          {products.map((product) => (
            <article
              key={product._id}
              className={`${RAIL_ITEM} bg-obsidian-raised hover:bg-obsidian-raised rounded-lg shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md focus-within:ring-2 focus-within:ring-gold focus-within:ring-offset-2`}
              tabIndex={0}
            >
              <Link 
                href={`/products/${product.slug}`}
                className="block"
                prefetch={true}
              >
                <div className="relative overflow-hidden aspect-square">
                  {product.images && product.images.length > 0 ? (
                    <Image
                      src={typeof product.images[0] === 'string' 
                        ? product.images[0] 
                        : product.images[0].url || '/placeholder.jpg'}
                      alt={product.name || 'Product image'}
                      fill
                      sizes={RAIL_IMAGE_SIZES}
                      className="object-cover transition-transform duration-500 hover:scale-105"
                      priority={false}
                    />
                  ) : (
                    <div className="w-full h-full bg-obsidian-raised flex items-center justify-center">
                      <span className="text-ink-muted text-sm">No image</span>
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
                  <h3 className="font-semibold line-clamp-2 mb-1 text-ink">
                    {product.name}
                  </h3>
                  
                  {/* Money goes through CurrencyContext, never a local
                      `₹` + `toLocaleString()`. Hand-rolled, this rail took the
                      runtime's locale (en-US on Vercel and outside India) and
                      grouped in thousands — "₹283,000" beneath a buy box reading
                      "₹2,68,000" — and it ignored the currency switch, so a USD
                      shopper got dollars on the listing and rupees here. Both
                      failures are invisible on cheap stock: five digits group
                      identically in every locale. */}
                  <div className="flex items-center mb-2">
                    <span className="text-lg font-bold text-ink">
                      {formatPrice(product.price)}
                    </span>
                    {product.originalPrice && product.originalPrice > product.price && (
                      <span className="ml-2 text-sm line-through text-ink-muted">
                        {formatPrice(product.originalPrice)}
                      </span>
                    )}
                  </div>
                  
                  {product.averageRating ? (
                    <div className="flex items-center mb-2">
                      <span className="text-yellow-400 mr-1">★</span>
                      <span className="text-sm text-ink-muted">
                        {product.averageRating.toFixed(1)} ({product.totalReviews || 0})
                      </span>
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between mt-3">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gold/50 text-gold">
                      {product.brand || 'Autobacs'}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {product.categories?.[0]?.name || 'Auto Parts'}
                    </span>
                  </div>
                </div>
              </Link>
            </article>
          ))}
        </ProductRail>
      </div>
    </section>
  );
}