'use client';

import WorkQueueList from '@/components/staff/work/WorkQueueList';

export default function Page() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Stock & shipping</h1>
      <p className="mb-6 text-sm text-gray-500">Check stock for each paid order, record the supplier, and upload the supplier&apos;s photo once it is dispatched.</p>
      <WorkQueueList queue="procurement" />
    </div>
  );
}
