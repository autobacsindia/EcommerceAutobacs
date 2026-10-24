'use client';

import { useAuth } from '@/context/AuthContext';
import SupplierDirectory from '@/components/payments/SupplierDirectory';

/**
 * Suppliers in the team panel: procurement keeps the list (picked from when a
 * supplier payment is raised); accounts reads it. The API enforces both.
 */
export default function TeamSuppliersPage() {
  const { user } = useAuth();
  const team = user?.staff?.team;
  if (team !== 'procurement' && team !== 'accounts') {
    return <p className="text-sm text-gray-600">Suppliers are kept by procurement.</p>;
  }
  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Suppliers</h1>
        <p className="text-sm text-gray-500">Save a supplier once, then pick them from the list when you request a supplier payment.</p>
      </div>
      <SupplierDirectory canEdit={team === 'procurement'} />
    </div>
  );
}
