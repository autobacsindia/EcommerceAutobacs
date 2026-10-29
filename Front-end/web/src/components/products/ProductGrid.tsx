'use client';

import type { StockStatus } from '@/lib/stock';
import type { Product as StoreProduct } from '@/lib/types';
import { ProductGridSkeleton } from '@/components/skeletons/ProductCardSkeleton';
import { useCampaignProductRates } from '@/hooks/queries/useCampaignProductRates';
import { useCampaignBadgeVisible } from '@/hooks/queries/useCampaign';
import StoreProductCard from './redesign/StoreProductCard';

/**
 * How many leading cards load their photo eagerly at high priority. Four is the
 * first row at the widest breakpoint (xl:grid-cols-4) and the first two rows on a
 * phone — the cards on screen before any scroll. One of them is the page's Largest
 * Contentful Paint; left lazy, it was not even requested until layout had run, which
 * Lighthouse measured as ~7 s of "resource load delay" on a throttled phone.
 * Everything after stays lazy so a long grid does not compete with its own first row.
 */
export const GRID_PRIORITY_IMAGES = 4;

interface ProductGridImage {
  url: string;
  alt?: string;
  isPrimary?: boolean;
  _id?: string;
}

interface Product {
  _id: string;
  name: string;
  price: number;
  originalPrice?: number;
  images: ProductGridImage[] | string;
  category?: {
    name: string;
  } | string;
  categories?: Array<{
    _id: string;
    name: string;
    slug: string;
  }>;
  stock: StockStatus;
  averageRating: number;
  isFeatured?: boolean;
  isNew?: boolean;
  __v?: number;
}

interface ProductGridProps {
  products: Product[];
  loading?: boolean;
}

export default function ProductGrid({ products, loading }: ProductGridProps) {
  // One request for the whole grid — see `useCampaignProductRates` — rather than one
  // per card. Hooks run unconditionally, ahead of the loading early-return.
  const { data: campaignData } = useCampaignProductRates(products.map((p) => p._id));
  const badgeVisible = useCampaignBadgeVisible();

  if (loading) {
    return <ProductGridSkeleton count={8} />;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
      {products.map((product, index) => (
        <StoreProductCard
          key={product._id}
          priority={index < GRID_PRIORITY_IMAGES}
          product={product as unknown as StoreProduct}
          featured={product.isFeatured}
          campaignRate={badgeVisible ? campaignData?.rates?.[product._id] : null}
        />
      ))}
    </div>
  );
}
