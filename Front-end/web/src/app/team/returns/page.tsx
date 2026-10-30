import { Suspense } from 'react';
import ReturnsBoard from '@/components/staff/returns/ReturnsBoard';
import { fetchMe } from '../staffSession';

/**
 * Returns, by the step each team owns (owner-approved workflow, 2026-10-30). The tabs
 * follow the signed-in person's team; the API re-checks every list and action.
 */
export default async function ReturnsPage() {
  const me = await fetchMe();
  const staff = me?.user?.staff;
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Returns</h1>
      <p className="mb-6 text-sm text-gray-500">
        Check the customer&apos;s photos, arrange the pickup, inspect the item, and chase the supplier. The customer refund is
        sent by accounts and never waits for the supplier.
      </p>
      <Suspense>
        <ReturnsBoard
          team={staff?.team || ''}
          isHead={!!staff?.isHead}
          canSell={staff?.canSell ?? staff?.team === 'sales'}
          isAdmin={false}
        />
      </Suspense>
    </div>
  );
}
