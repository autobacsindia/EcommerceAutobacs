'use client';

import NewSalesOrderForm from '@/components/staff/sales/NewSalesOrderForm';

/** Sales: raise an order for a phone / WhatsApp customer and send them a payment link. */
export default function NewSalesOrderPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">New order</h1>
      <p className="mb-6 text-sm text-gray-500">For a customer who called or messaged. They pay with the Razorpay link or QR you send.</p>
      <NewSalesOrderForm />
    </div>
  );
}
