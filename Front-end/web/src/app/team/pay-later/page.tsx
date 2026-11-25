'use client';

import PayLaterList from '@/components/payments/payLater/PayLaterList';

/** Accounts and the GTM head: orders the admin let ship before payment. */
export default function TeamPayLaterPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">B2B / B2C and ship before payment</h1>
      <p className="mb-6 text-sm text-gray-500">Approve GTM orders as B2B or B2C with a note. Approved B2B orders can ship before payment; those customers pay by the Razorpay link sent at dispatch, or by bank transfer that accounts confirms.</p>
      <PayLaterList />
    </div>
  );
}
