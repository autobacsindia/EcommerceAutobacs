'use client';

import { Suspense } from 'react';
import TeamLeadsList from '@/components/staff/leads/TeamLeadsList';

/**
 * The GTM leads sheet: everyone in GTM sees every lead and who is following up on
 * it; the GTM head and leads press "Follow up" to take one (first click wins).
 */
export default function TeamLeadsPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Website leads</h1>
      <p className="mb-6 text-sm text-gray-500">People who almost bought, or asked us for help. Press <strong>Follow up</strong> to make a lead yours — everyone then sees that you have it.</p>
      {/* The view, search and filters live in the address (useSearchParams). */}
      <Suspense fallback={null}>
        <TeamLeadsList />
      </Suspense>
    </div>
  );
}
