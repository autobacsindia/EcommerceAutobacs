'use client';

import NewSalesOrderForm from '@/components/staff/sales/NewSalesOrderForm';

/**
 * GTM: a customer who wants to pay straight away, without a quotation first.
 * Pick the products (priced exactly as a quotation), create the order, then add
 * how they pay — bank transfer, GPay / UPI QR, or another way — and share it.
 */
export default function PayFirstPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Payment first</h1>
      <p className="mb-6 text-sm text-gray-500">For a customer ready to pay now. Choose the products, create the order, then share the bank details or GPay QR. Accounts confirms the payment as usual.</p>
      <NewSalesOrderForm payFirst />
    </div>
  );
}
