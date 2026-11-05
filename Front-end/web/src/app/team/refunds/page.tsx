import { Suspense } from 'react';
import RefundsTabs from './RefundsTabs';

/** Accounts: every refund waiting on them — cancelled orders and returned items. */
export default function RefundsPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Refunds</h1>
      <p className="mb-6 text-sm text-gray-500">Money going back to customers, in two lists.</p>
      <Suspense>
        <RefundsTabs />
      </Suspense>
    </div>
  );
}
