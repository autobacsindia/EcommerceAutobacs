'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import SalesOrdersList from '@/components/staff/sales/SalesOrdersList';

/** Sales: the orders this member raised (the head sees the whole team's). */
export default function SalesOrdersPage() {
  const { user } = useAuth();
  const isHead = !!user?.staff?.isHead;
  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{isHead ? 'Team orders' : 'My orders'}</h1>
          <p className="text-sm text-gray-500">Payment status updates on its own when the customer pays.</p>
        </div>
        <Link href="/team/sales/new" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> New order
        </Link>
      </div>
      <SalesOrdersList mode="sales" />
    </div>
  );
}
