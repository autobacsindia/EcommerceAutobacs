'use client';

import ExtraChargesList from '@/components/payments/extras/ExtraChargesList';

/** Admin: every extra charge, and the ones the customer is owed back. */
export default function AdminExtraChargesPage() {
  return (
    <div className="max-w-4xl p-4 md:p-6">
      <h1 className="text-2xl font-bold text-gray-900">Extra charges</h1>
      <p className="mb-6 text-sm text-gray-500">Extra amounts agreed on orders already paid. The original order stays as it was; each extra has its own approval, payment and receipt.</p>
      <ExtraChargesList orderBase="/admin/orders" />
    </div>
  );
}
