'use client';

import PaymentRequestList from '@/components/payments/PaymentRequestList';
import { STAFF_TEAM_OPTIONS } from '@/lib/staffTeams';

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
        <p className="text-sm text-gray-600">Supplier payments and team expenses, from every team. Accounts approves them; you pay and record the reference and screenshot.</p>
      </div>
      <PaymentRequestList
        initial="to_pay"
        teams={STAFF_TEAM_OPTIONS}
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
