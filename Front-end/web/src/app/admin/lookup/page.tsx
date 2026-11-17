'use client';

import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import LinkLookup from '@/components/payments/LinkLookup';

/**
 * Admin: find everything linked to a project ID, an order number or another ID
 * (`?q=` keeps the search in the address, so it can be shared and reloaded).
 */
export default function AdminLookupPage() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Find by ID</h1>
        <p className="text-sm text-gray-600">A project’s tasks, payments and orders — or an order’s tasks, payments and projects — in one place.</p>
      </div>
      <Suspense fallback={null}>
        <Lookup />
      </Suspense>
    </div>
  );
}

function Lookup() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  return (
    <LinkLookup
      initial={params.get('q') || ''}
      onSearch={(q) => router.replace(q ? `${pathname}?q=${encodeURIComponent(q)}` : pathname, { scroll: false })}
    />
  );
}
