'use client';

import MarginsPage from '@/components/admin/margins/MarginsPage';

/** Admin: what we make on what procurement buys — per order line, per product, and the below-margin exceptions. */
export default function AdminMarginsPage() {
  return (
    <div className="p-4 md:p-6">
      <MarginsPage />
    </div>
  );
}
