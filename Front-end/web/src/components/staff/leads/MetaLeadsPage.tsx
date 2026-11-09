'use client';

import { Suspense } from 'react';
import MetaLeadsList from './MetaLeadsList';

/** One screen for the team panel and the admin panel. */
export default function MetaLeadsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Meta leads</h1>
      <p className="mb-6 text-sm text-gray-500">Enquiries from the sales lead sheet. New rows arrive here automatically every few minutes.</p>
      {/* The tab filter and search live in the address (useSearchParams). */}
      <Suspense fallback={null}>
        <MetaLeadsList />
      </Suspense>
    </div>
  );
}
