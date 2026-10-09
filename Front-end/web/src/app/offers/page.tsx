'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import ProductGrid from '@/components/products/ProductGrid';
import StorePageHeader from '@/components/store/StorePageHeader';
import Pagination from '@/components/layout/Pagination';
import { useOfferProducts } from '@/hooks/queries/useOfferProducts';

function OffersPageInner() {
  const searchParams = useSearchParams();
  const currentPage = Math.max(1, Number(searchParams.get('page')) || 1);

  const { data, isPending, isError } = useOfferProducts(currentPage);
  const products = data?.products ?? [];
  const pagination = data?.pagination ?? {};

  const total = (pagination as { total?: number }).total;

  return (
    <div className="sp sh-theme">
      <StorePageHeader
        crumbs={[{ label: "Today's Deals" }]}
        title={<>Today&apos;s Deals <span className="ml-2 inline-block rounded-md bg-[#cc0c39] px-2 py-0.5 align-middle text-[13px] font-bold text-white">Limited time</span></>}
        subtitle="Genuine price drops on parts and accessories — the M.R.P. is shown on every deal."
        aside={!isPending && !isError && typeof total === 'number' ? `${total.toLocaleString('en-IN')} deals` : undefined}
      />

      <div className="sp-wrap pt-6">
        {isPending && (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="overflow-hidden rounded-xl border border-hairline bg-white">
                <div className="aspect-square animate-pulse bg-obsidian-deep" />
                <div className="space-y-3 p-4">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-obsidian-deep" />
                  <div className="h-5 w-1/2 animate-pulse rounded bg-obsidian-deep" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isPending && isError && (
          <div className="sp-card sp-empty" role="alert">
            <p className="sp-empty-title">We couldn&apos;t load today&apos;s deals</p>
            <p>Please check your connection and try again.</p>
            <button type="button" onClick={() => window.location.reload()} className="sh-btn sh-btn-primary">Try again</button>
          </div>
        )}

        {!isPending && !isError && products.length > 0 && (
          <>
            <ProductGrid products={products} />
            <div className="mt-10">
              <Pagination
                pagination={pagination}
                currentPage={currentPage}
                basePath="/offers"
                searchParams={new URLSearchParams(searchParams.toString())}
              />
            </div>
          </>
        )}

        {!isPending && !isError && products.length === 0 && (
          <div className="sp-card sp-empty">
            <p className="sp-empty-title">No deals running right now</p>
            <p>New deals go live regularly — meanwhile, browse the full catalogue.</p>
            <Link href="/products" className="sh-btn sh-btn-primary">Browse all products</Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function OffersPage() {
  return (
    <Suspense fallback={<div className="sp sh-theme" />}>
      <OffersPageInner />
    </Suspense>
  );
}
