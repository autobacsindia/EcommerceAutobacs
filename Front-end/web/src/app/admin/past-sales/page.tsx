'use client';

import PastSalesPage from '@/components/staff/pastSales/PastSalesPage';

/** Admin: every salesman's past (offline) sales — correct, delete, restore, undo an upload. */
export default function AdminPastSalesPage() {
  return (
    <div className="p-4 md:p-6">
      <PastSalesPage />
    </div>
  );
}
