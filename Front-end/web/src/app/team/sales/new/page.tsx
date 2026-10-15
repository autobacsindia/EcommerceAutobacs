'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import NewSalesOrderForm from '@/components/staff/sales/NewSalesOrderForm';

/** `?from=<orderId>` starts the form with that order's customer and address. */
function Form() {
  return <NewSalesOrderForm fromOrderId={useSearchParams().get('from')} />;
}

/** Sales: raise an order for a phone / WhatsApp customer and send them a payment link. */
export default function NewSalesOrderPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">New order</h1>
      <p className="mb-6 text-sm text-gray-500">For a customer who called or messaged. They pay with the Razorpay link or QR you send.</p>
      <Suspense fallback={null}>
        <Form />
      </Suspense>
    </div>
  );
}
