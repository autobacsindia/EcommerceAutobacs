import { Suspense } from 'react';
import ReturnsBoard from '@/components/staff/returns/ReturnsBoard';

/**
 * The team panel's return workflow, for an admin (who has no /team access): every tab,
 * including the decisions only admin takes — installer-damage approvals, refunds above
 * the accounts limit and supplier money. Bank-transfer / cash refunds are recorded on
 * Admin → Returns, which has the offline payout form.
 */
export default function AdminReturnsWorkflowPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Returns workflow</h1>
      <p className="mb-6 text-sm text-gray-500">What each team is doing with returns, and the steps that need an admin.</p>
      <Suspense>
        <ReturnsBoard team="" isHead canSell={false} isAdmin />
      </Suspense>
    </div>
  );
}
