'use client';

import WorkQueueList from '@/components/staff/work/WorkQueueList';

export default function Page() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Refund approvals</h1>
      <p className="mb-6 text-sm text-gray-500">Refunds the customer asked for. Once you approve, the item is cancelled and an admin pays the refund.</p>
      <WorkQueueList queue="refunds" />
    </div>
  );
}
