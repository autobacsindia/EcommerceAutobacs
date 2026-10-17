'use client';

import PaymentRequestList from '@/components/payments/PaymentRequestList';

/**
 * Admin: every payment request from every team. Approve or decline what is
 * waiting; follow what accounts has paid. Each request carries its bills,
 * screenshots, history and a downloadable slip / receipt.
 */
export default function AdminPaymentsPage() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
        <p className="text-sm text-gray-600">Supplier payments and team expenses. You approve; accounts pays and records it.</p>
      </div>
      <PaymentRequestList
        initial="to_pay"
        teams={[
          { value: 'procurement', label: 'Procurement' },
          { value: 'operations', label: 'Operations' },
          { value: 'marketing', label: 'Marketing' },
        ]}
        /* The admin opens on what they must PAY — accounts has already approved
           it and nothing moves until the money goes out. "Waiting for accounts"
           is there to look at, not to act on. */
        filters={[
          { value: 'to_pay', label: 'To pay' },
          { value: 'to_approve', label: 'Waiting for accounts' },
          { value: 'paid', label: 'Paid' },
          { value: 'declined', label: 'Declined' },
          { value: 'all', label: 'All' },
        ]}
      />
    </div>
  );
}
