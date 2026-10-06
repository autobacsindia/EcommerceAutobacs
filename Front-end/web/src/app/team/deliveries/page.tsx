'use client';

import WorkQueueList from '@/components/staff/work/WorkQueueList';

export default function Page() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Deliveries</h1>
      <p className="mb-6 text-sm text-gray-500">Parcels on their way. Follow up with the courier and mark each one delivered when it arrives.</p>
      <WorkQueueList queue="deliveries" />
    </div>
  );
}
