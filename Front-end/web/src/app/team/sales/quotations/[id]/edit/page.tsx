'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import NewSalesOrderForm from '@/components/staff/sales/NewSalesOrderForm';
import { errorMessage, type Quotation } from '@/components/staff/sales/types';

/**
 * Edit an open (or expired) quotation — saving makes a new version with re-checked
 * prices. An accepted one can be edited while nothing is paid (the server re-checks).
 */
export default function EditQuotationPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: staffKeys.quotation(id),
    queryFn: () => apiClient.get<{ quotation: Quotation }>(`/staff/sales/quotations/${encodeURIComponent(id)}`),
  });
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Edit quotation {q.data?.quotation.number || ''}</h1>
      <p className="mb-6 text-sm text-gray-500">Saving creates a new version and restarts its validity. Prices and stock are re-checked.</p>
      {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {q.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load this quotation.')}</p>}
      {q.data && (['open', 'expired'].includes(q.data.quotation.status) || q.data.quotation.editAfterAccept?.allowed
        ? <NewSalesOrderForm key={q.data.quotation.updatedAt} quotation={q.data.quotation} />
        : <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            {q.data.quotation.editAfterAccept?.reason || `This quotation is ${q.data.quotation.status} and can no longer be edited.`}
          </p>)}
    </div>
  );
}
