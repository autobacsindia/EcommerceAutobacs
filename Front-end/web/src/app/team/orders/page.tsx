'use client';

import SalesOrdersList from '@/components/staff/sales/SalesOrdersList';

/** Every paid order the teams handle — website and sales — with where it is up to. */
export default function PaidOrdersPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Paid orders</h1>
      <p className="mb-6 text-sm text-gray-500">Every paid order — from the website or taken by the sales team — with who sold it and where it is up to.</p>
      <SalesOrdersList mode="paid" />
    </div>
  );
}
