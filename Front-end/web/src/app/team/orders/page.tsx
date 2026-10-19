'use client';

import SalesOrdersList from '@/components/staff/sales/SalesOrdersList';

/**
 * Paid orders still being worked — website and GTM alike — with where each one
 * is up to. Delivered orders move to /team/orders/delivered so this list stays
 * the day's work rather than the whole history.
 */
export default function OrderProcessingPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Order processing</h1>
      <p className="mb-6 text-sm text-gray-500">
        Every paid order being worked on — from the website or taken by the GTM team — with who sold it and
        where it is up to. Once every parcel is delivered it moves to Delivered.
      </p>
      <SalesOrdersList mode="paid" stage="processing" />
    </div>
  );
}
