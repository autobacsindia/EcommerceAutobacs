'use client';

import ApprovalsInbox from '@/components/payments/ApprovalsInbox';

/** Admin: the same list accounts works from — the admin may decide anything, own entries included. */
export default function AdminApprovalsPage() {
  return (
    <div className="max-w-4xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Waiting for approval</h1>
        <p className="text-sm text-gray-500">
          What accounts decides, across orders: payments and expenses, supplier refunds and credit, supplier changes. Each order keeps who proposed, who decided, when and why.
        </p>
      </div>
      <ApprovalsInbox />
    </div>
  );
}
