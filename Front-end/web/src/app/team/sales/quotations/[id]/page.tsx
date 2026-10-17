'use client';

import { useParams } from 'next/navigation';
import QuotationDetail from '@/components/staff/sales/QuotationDetail';

export default function QuotationPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="max-w-4xl">
      <QuotationDetail id={id} />
    </div>
  );
}
