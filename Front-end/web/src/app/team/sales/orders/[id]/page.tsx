'use client';

import { useParams } from 'next/navigation';
import SalesOrderPayment from '@/components/staff/sales/SalesOrderPayment';

/** A GTM order and its payment: request it (in parts if needed) and send the links. */
export default function SalesOrderPaymentPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="max-w-4xl">
      <SalesOrderPayment id={id} />
    </div>
  );
}
