'use client';

import { lazy, Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { getCounts, partnerKeys } from './api';

/**
 * Autobacs Partner — procurement's screen (team panel /team/partners, admin
 * /admin/supplier-partners). The tab and the open record live in the address
 * (?tab=&id=), so a link to one supplier or product opens it directly.
 */
export type Area = 'team' | 'admin';
type Tab = 'suppliers' | 'products' | 'prices' | 'margins';

const Accounts = lazy(() => import('./Accounts'));
const Listings = lazy(() => import('./Listings'));
const PriceReviews = lazy(() => import('./PriceReviews'));
const MarginRules = lazy(() => import('./MarginRules'));

const TABS: { key: Tab; label: string; count?: 'accounts' | 'listings' | 'priceReviews' }[] = [
  { key: 'suppliers', label: 'Supplier partners', count: 'accounts' },
  { key: 'products', label: 'Supplier products', count: 'listings' },
  { key: 'prices', label: 'Price reviews', count: 'priceReviews' },
  { key: 'margins', label: 'Margin rules' },
];
const INTRO: Record<Tab, string> = {
  suppliers: 'Suppliers who signed up in the Autobacs Partner app. Check their GST and bank documents, then approve them — link to a supplier we already buy from, or add them as new.',
  products: 'Products suppliers listed with their own price. Edit how each shows on our website, set our selling price, and approve. Customers only ever see our price.',
  prices: 'A supplier changed their price on a product that is already live. Our website price only changes when you decide here.',
  margins: 'How much margin we aim for, and the lowest we sell at without a reason.',
};

export default function PartnersScreen({ area }: { area: Area }) {
  return <Suspense fallback={null}><Partners area={area} /></Suspense>;
}

function Partners({ area }: { area: Area }) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const allowed = user?.role === 'admin' || user?.staff?.team === 'procurement';
  const counts = useQuery({ queryKey: partnerKeys.counts(), queryFn: getCounts, enabled: !!allowed, refetchInterval: 60_000 });
  const raw = params.get('tab');
  const tab: Tab = TABS.some((t) => t.key === raw) ? (raw as Tab) : 'suppliers';
  const id = params.get('id') ?? '';
  const go = (t: Tab, openId = '') => {
    const qs = new URLSearchParams({ ...(t !== 'suppliers' ? { tab: t } : {}), ...(openId ? { id: openId } : {}) }).toString();
    router.push(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: !openId });
  };

  if (user && !allowed) return <p className="text-sm text-gray-600">Supplier partners are handled by the procurement team.</p>;
  return (
    <div className={`${area === 'admin' ? 'p-4 md:p-6' : ''} max-w-6xl space-y-4`}>
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Autobacs Partner</h1>
        <p className="text-sm text-gray-500">{INTRO[tab]}</p>
      </div>
      <nav aria-label="Partner sections" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {TABS.map((t) => {
          const n = t.count ? counts.data?.[t.count] ?? 0 : 0;
          return (
            <button key={t.key} type="button" aria-current={tab === t.key ? 'page' : undefined} onClick={() => go(t.key)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
              {t.label}{n > 0 && <span className={`ml-1.5 rounded-full px-1.5 text-xs ${tab === t.key ? 'bg-white/20' : 'bg-red-100 text-red-700'}`}>{n}</span>}
            </button>
          );
        })}
      </nav>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-gray-100" aria-busy="true" />}>
        {tab === 'suppliers' && <Accounts openId={id} onOpen={(x) => go('suppliers', x)} />}
        {tab === 'products' && <Listings openId={id} onOpen={(x) => go('products', x)} />}
        {tab === 'prices' && <PriceReviews />}
        {tab === 'margins' && <MarginRules />}
      </Suspense>
    </div>
  );
}
