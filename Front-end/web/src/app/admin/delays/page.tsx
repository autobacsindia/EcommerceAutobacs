'use client';

import DelayRanking from '@/components/delays/DelayRanking';

/**
 * Delays by person — every owner ranked by late steps, then office time late.
 * Click a person to see their list. Live data (open orders, parcels, tasks, projects).
 */
export default function AdminDelaysPage() {
  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Delays by person</h1>
        <p className="text-sm text-gray-500">
          Who is holding late work right now. A step belongs to whoever moved it into its stage; if that person has left or it
          was the system, the team head. Office hours only (Mon–Sat, 9:30–6:30).
        </p>
      </div>
      <DelayRanking mode="admin" />
    </div>
  );
}
