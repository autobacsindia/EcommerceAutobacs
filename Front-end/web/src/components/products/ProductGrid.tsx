'use client';

import type { StockStatus } from '@/lib/stock';
import type { Product as StoreProduct } from '@/lib/types';
import { ProductGridSkeleton } from '@/components/skeletons/ProductCardSkeleton';
import { useCampaignProductRates } from '@/hooks/queries/useCampaignProductRates';
import { useCampaignBadgeVisible } from '@/hooks/queries/useCampaign';
import StoreProductCard from './redesign/StoreProductCard';

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
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:gap-6">
      {products.map((product) => (
        <StoreProductCard
          key={product._id}
          product={product as unknown as StoreProduct}
          featured={product.isFeatured}
          campaignRate={badgeVisible ? campaignData?.rates?.[product._id] : null}
        />
      ))}
    </div>
  );
}
