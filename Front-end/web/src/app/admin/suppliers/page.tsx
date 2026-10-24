'use client';

import SupplierDirectory from '@/components/payments/SupplierDirectory';

/** Admin: the supplier directory procurement keeps — add, edit, deactivate. */
export default function AdminSuppliersPage() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Suppliers</h1>
        <p className="text-sm text-gray-600">The suppliers procurement picks from when raising a supplier payment. Bank details are copied onto each payment when it is raised.</p>
      </div>
      <SupplierDirectory canEdit />
    </div>
  );
}
