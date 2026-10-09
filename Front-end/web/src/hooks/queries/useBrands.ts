'use client';

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { brandKeys } from './keys';

export interface BrandItem {
  name: string;
  slug: string;
  productCount: number;
}

async function fetchBrands(): Promise<BrandItem[]> {
  const res = await apiClient.get<{ brands?: { name?: string; slug?: string; productCount?: number }[] }>('/products/brands');
  return (res?.brands ?? [])
    .filter((b): b is { name: string; slug: string; productCount?: number } => !!b?.name && !!b?.slug)
    .map((b) => ({ name: b.name, slug: b.slug, productCount: b.productCount ?? 0 }));
}

/** Every brand (name, slug, product count). The list barely changes — 1h staleTime. */
export function useBrands(enabled = true) {
  return useQuery({
    queryKey: brandKeys.list(),
    queryFn: fetchBrands,
    staleTime: 60 * 60 * 1000,
    enabled,
  });
}
