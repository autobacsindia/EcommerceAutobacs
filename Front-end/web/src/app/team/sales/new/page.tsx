'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import NewSalesOrderForm from '@/components/staff/sales/NewSalesOrderForm';

/** `?from=<orderId>` starts the form with that order's customer and address. */
function Form() {
  return <NewSalesOrderForm fromOrderId={useSearchParams().get('from')} />;
}

/**
 * GTM: a quotation for a phone / WhatsApp customer. It is shared first; when the
 * customer agrees it becomes the order and payment is requested on it.
 */
export default function NewSalesOrderPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">New quotation</h1>
      <p className="mb-6 text-sm text-gray-500">For a customer who called or messaged. Share the quotation PDF; when they agree, create the order and share how to pay.</p>
      <Suspense fallback={null}>
        <Form />
      </Suspense>
    </div>
  );
}
