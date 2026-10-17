'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import QuotationsList from '@/components/staff/sales/QuotationsList';

/** GTM: quotations shared with customers, before they become orders. */
export default function QuotationsPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quotations</h1>
          <p className="text-sm text-gray-500">Share a quotation first; when the client agrees, it becomes the order and you send the payment link.</p>
        </div>
        <Link href="/team/sales/new" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> New quotation
        </Link>
      </div>
      <QuotationsList />
    </div>
  );
}
