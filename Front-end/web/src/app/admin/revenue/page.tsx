'use client';

import CompanyRevenuePage from '@/components/admin/revenue/CompanyRevenuePage';

/** Admin: the whole company's revenue and orders fulfilled, and the Zoho Books import behind them. */
export default function AdminRevenuePage() {
  return (
    <div className="p-4 md:p-6">
      <CompanyRevenuePage />
    </div>
  );
}
