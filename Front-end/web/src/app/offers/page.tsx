'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import ProductGrid from '@/components/products/ProductGrid';
import Pagination from '@/components/layout/Pagination';
import { useOfferProducts } from '@/hooks/queries/useOfferProducts';

function OffersPageInner() {
  const searchParams = useSearchParams();
  const currentPage = Math.max(1, Number(searchParams.get('page')) || 1);

  const { data, isPending, isError } = useOfferProducts(currentPage);
  const products = data?.products ?? [];
  const pagination = data?.pagination ?? {};

  return (
    <div className="min-h-screen bg-obsidian-deep">
      <div className="bg-obsidian border-b border-hairline py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold mb-2">Limited Time</p>
          <h1 className="text-4xl font-display font-light text-ink tracking-[-0.01em] mb-3">Offers</h1>
          <p className="text-ink/70 font-display">Your Dream Upgrades, Now More Affordable!</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {isPending && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-obsidian border border-hairline rounded-sm overflow-hidden animate-pulse">
                <div className="h-48 bg-obsidian-raised" />
                <div className="p-4">
                  <div className="h-4 bg-obsidian-raised rounded-sm mb-2" />
                  <div className="h-4 bg-obsidian-raised rounded-sm w-2/3 mb-4" />
                  <div className="h-6 bg-obsidian-raised rounded-sm w-1/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isPending && isError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-sm p-6 text-center">
            <p className="text-red-400 font-display">Failed to load offers</p>
          </div>
        )}

        {!isPending && !isError && products.length > 0 && (
          <>
            <ProductGrid products={products} />
            <Pagination
              pagination={pagination}
              currentPage={currentPage}
              basePath="/offers"
              searchParams={new URLSearchParams(searchParams.toString())}
            />
          </>
        )}

        {!isPending && !isError && products.length === 0 && (
          <div className="text-center py-12">
            <p className="text-ink-muted font-display">No offers available right now. Please check back later.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function OffersPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-obsidian-deep" />}>
      <OffersPageInner />
    </Suspense>
  );
}
