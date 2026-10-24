'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import SalesOrderPayment from '@/components/staff/sales/SalesOrderPayment';

function Payment() {
  const { id } = useParams<{ id: string }>();
  // `?pay=details`: straight from "Payment first" — open the payment details form.
  const startWithDetails = useSearchParams().get('pay') === 'details';
  return <SalesOrderPayment id={id} startWithDetails={startWithDetails} />;
}

/** A GTM order and its payment: bank / GPay QR / other details, or Razorpay links. */
export default function SalesOrderPaymentPage() {
  return (
    <div className="max-w-4xl">
      <Suspense fallback={null}>
        <Payment />
      </Suspense>
    </div>
  );
}
