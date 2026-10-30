'use client';

import { ReturnList } from '@/components/staff/returns/ReturnsBoard';

/** Accounts: returns that passed inspection and are waiting for the customer refund. */
export default function ReturnRefundsPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Return refunds</h1>
      <p className="mb-6 text-sm text-gray-500">
        Returns that passed inspection. The amount is worked out by the system from what the customer paid — send it once.
        Up to ₹25,000 any accounts member; above that the accounts head. Bank-transfer and cash orders are paid back by an admin.
      </p>
      <ReturnList queue="refund" showRefund />
    </div>
  );
}
