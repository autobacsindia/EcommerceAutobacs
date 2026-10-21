'use client';

import BankTransfersList from '@/components/payments/BankTransfersList';

/**
 * Customers who paid a sales order by bank transfer. Accounts checks the bank and
 * confirms (the order is then paid) or rejects; the GTM head follows them all, a
 * GTM lead their own.
 */
export default function TeamBankTransfersPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Bank transfers</h1>
      <p className="mb-6 text-sm text-gray-500">Customers who paid by bank transfer instead of the payment link. An order is paid only after accounts finds the money in the bank and confirms it here.</p>
      <BankTransfersList />
    </div>
  );
}
