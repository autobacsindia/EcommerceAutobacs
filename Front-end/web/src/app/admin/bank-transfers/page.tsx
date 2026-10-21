'use client';

import BankTransfersList from '@/components/payments/BankTransfersList';

/** Admin: every bank transfer GTM recorded. Confirm once the money is in the bank. */
export default function AdminBankTransfersPage() {
  return (
    <div className="max-w-4xl p-4 md:p-6">
      <h1 className="text-2xl font-bold text-gray-900">Bank transfers</h1>
      <p className="mb-6 text-sm text-gray-500">Sales customers who paid by bank transfer. The order becomes paid only when you or accounts confirm the money is in the bank.</p>
      <BankTransfersList />
    </div>
  );
}
