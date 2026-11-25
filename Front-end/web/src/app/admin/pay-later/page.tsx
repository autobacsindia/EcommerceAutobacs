'use client';

import PayLaterList from '@/components/payments/payLater/PayLaterList';

/** Admin: orders let ship before payment, and whether the customers have paid. */
export default function AdminPayLaterPage() {
  return (
    <div className="max-w-4xl p-4 md:p-6">
      <h1 className="text-2xl font-bold text-gray-900">Shipped – payment due</h1>
      <p className="mb-6 text-sm text-gray-500">Orders you let ship before payment. Each is marked paid only when the customer pays the Razorpay link or accounts confirms a bank transfer.</p>
      <PayLaterList orderHref={(id) => `/admin/orders/${encodeURIComponent(id)}`} />
    </div>
  );
}
