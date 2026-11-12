'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import SalesOrderPayment from '@/components/staff/sales/SalesOrderPayment';
import PanelOrderRating from '@/components/orderRating/PanelOrderRating';

function Payment() {
  const { id } = useParams<{ id: string }>();
  // `?pay=details`: straight from "Payment first" — open the payment details form.
  const startWithDetails = useSearchParams().get('pay') === 'details';
  return (
    <div className="space-y-5">
      <SalesOrderPayment id={id} startWithDetails={startWithDetails} />
      {/* Offline orders: the seller sends the rating link here; heads also see the rating. */}
      <PanelOrderRating orderId={id} />
    </div>
  );
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
