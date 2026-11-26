'use client';

import PayLaterList from '@/components/payments/payLater/PayLaterList';

/** Admin: orders let ship before payment, and whether the customers have paid. */
export default function AdminPayLaterPage() {
  return (
    <div className="max-w-4xl p-4 md:p-6">
      <h1 className="text-2xl font-bold text-gray-900">B2B / B2C and ship before payment</h1>
      <p className="mb-6 text-sm text-gray-500">Approve GTM orders as B2B or B2C, let approved B2B orders ship before payment, and see whether those customers have paid. An order is marked paid only when the customer pays the Razorpay link or accounts confirms a bank transfer.</p>
      <PayLaterList orderHref={(id) => `/admin/orders/${encodeURIComponent(id)}`} />
    </div>
  );
}
