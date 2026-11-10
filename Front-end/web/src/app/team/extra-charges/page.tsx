'use client';

import ExtraChargesList from '@/components/payments/extras/ExtraChargesList';

/** Extra amounts agreed with customers on orders they already paid. */
export default function TeamExtraChargesPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Extra charges</h1>
      <p className="mb-6 text-sm text-gray-500">An extra amount a customer agreed to pay on an order they already paid. Accounts approves it, then the customer pays.</p>
      <ExtraChargesList />
    </div>
  );
}
