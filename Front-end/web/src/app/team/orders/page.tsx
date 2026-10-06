'use client';

import SalesOrdersList from '@/components/staff/sales/SalesOrdersList';

/** Accounts / Procurement (and the sales head): sales-team orders the customer has paid. */
export default function PaidOrdersPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Paid orders</h1>
      <p className="mb-6 text-sm text-gray-500">Orders the sales team took by phone or WhatsApp, once the customer has paid.</p>
      <SalesOrdersList mode="paid" />
    </div>
  );
}
