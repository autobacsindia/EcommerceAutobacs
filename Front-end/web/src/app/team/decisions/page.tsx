'use client';

import WorkQueueList from '@/components/staff/work/WorkQueueList';

export default function Page() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Customer decisions</h1>
      <p className="mb-6 text-sm text-gray-500">Items procurement could not get. Call the customer: will they wait for stock, or do they want a refund?</p>
      <WorkQueueList queue="decisions" />
    </div>
  );
}
