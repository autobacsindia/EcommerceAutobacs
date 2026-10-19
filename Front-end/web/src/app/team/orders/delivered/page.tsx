'use client';

import SalesOrdersList from '@/components/staff/sales/SalesOrdersList';

/**
 * Orders that have been handed over. Split out of Order processing so the teams
 * can see at a glance what is finished and what is still moving.
 */
export default function DeliveredOrdersPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Delivered</h1>
      <p className="mb-6 text-sm text-gray-500">
        Orders that reached the customer. They stay here for the record — nothing further is needed.
      </p>
      <SalesOrdersList mode="paid" stage="delivered" />
    </div>
  );
}
