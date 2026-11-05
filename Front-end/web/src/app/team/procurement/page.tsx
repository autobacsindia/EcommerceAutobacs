'use client';

import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import WorkQueueList from '@/components/staff/work/WorkQueueList';
import SalesOrdersList from '@/components/staff/sales/SalesOrdersList';

/**
 * Procurement's one "Orders" page (it had two menu items: Orders and Order
 * processing). "To do" is procurement's own work queue — stock checks, suppliers,
 * dispatch photos. "All in progress" is every paid order still being worked, with
 * where it is up to (the list other teams see as "Order processing"). Delivered
 * orders stay on their own page.
 */
export default function Page() {
  // The tab lives in the address (useSearchParams): inside Suspense.
  return <Suspense fallback={null}><ProcurementOrders /></Suspense>;
}

const TABS = [
  ['todo', 'To do'],
  ['all', 'All in progress'],
] as const;

function ProcurementOrders() {
  const router = useRouter();
  const pathname = usePathname();
  const tab = useSearchParams().get('list') === 'all' ? 'all' : 'todo';
  // Each tab keeps its own search and filters; switching starts the other one clean.
  const show = (t: 'todo' | 'all') => router.replace(`${pathname}${t === 'all' ? '?list=all' : ''}`, { scroll: false });

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
        <p className="text-sm text-gray-500">
          {tab === 'todo'
            ? 'Check stock for each paid order, record the supplier, and upload the supplier’s photo once it is dispatched.'
            : 'Every paid order being worked on — from the website or taken by the GTM team — with who sold it and where it is up to. Once every parcel is delivered it moves to Delivered.'}
        </p>
      </div>
      <div role="tablist" aria-label="Which orders" className="flex flex-wrap gap-2">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => { if (key !== tab) show(key); }}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === key ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'todo' ? <WorkQueueList queue="procurement" /> : <SalesOrdersList mode="paid" stage="processing" />}
    </div>
  );
}
