'use client';

import ApprovalsInbox from '@/components/payments/ApprovalsInbox';

/**
 * Accounts: everything waiting for a decision, across orders — supplier payments
 * and expenses, supplier refunds / credit, and supplier changes. Procurement records;
 * accounts approves or rejects (with a reason). The API decides who may.
 */
export default function TeamApprovalsPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Waiting for your approval</h1>
      <p className="mb-6 text-sm text-gray-500">
        Procurement deals with suppliers and records every change; you approve or reject it. Rejecting needs a reason — procurement sees it.
      </p>
      <ApprovalsInbox />
    </div>
  );
}
