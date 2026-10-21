'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import PaymentRequestForm from '@/components/payments/PaymentRequestForm';
import PaymentRequestList from '@/components/payments/PaymentRequestList';
import { paymentKeys } from '@/components/payments/api';
import { STAFF_TEAM_OPTIONS } from '@/lib/staffTeams';

// Accounts filters by team — the shared list, so a new team appears at once.

/**
 * Payments in the team panel.
 *   every team  — raise expenses (fuel, travel, food, a purchase) and follow them
 *   procurement — also follows supplier payments (raised from each order)
 *   accounts    — approves or declines everything, and sees every team;
 *                 the admin then pays
 */
export default function TeamPaymentsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const team = user?.staff?.team;
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  /*
    Any active staff member may claim an expense — the API is the authority
    (EXPENSE_TEAMS in paymentRequestService), this only decides whether to show
    the button. Admins use the admin panel, not this page.
  */
  const raisesExpenses = !!team;
  const isAccounts = team === 'accounts';

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
          <p className="text-sm text-gray-500">
            {isAccounts
              ? 'Approve or decline every request — from any team. The admin pays what you approve, and records the reference and screenshot.'
              : 'Every request goes to accounts to approve, then to the admin to pay. Download the slip or receipt at any stage.'}
          </p>
        </div>
        {raisesExpenses && !adding && (
          <button type="button" onClick={() => { setAdding(true); setNotice(''); }} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" /> New expense
          </button>
        )}
      </div>

      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {adding && (
        <PaymentRequestForm
          onCancel={() => setAdding(false)}
          onDone={(r) => {
            setAdding(false);
            setNotice(`${r.number} sent for approval. You will see it move here and in team chat.`);
            qc.invalidateQueries({ queryKey: [...paymentKeys.all, 'list'] });
          }}
        />
      )}

      <PaymentRequestList
        initial={isAccounts ? 'to_approve' : 'open'}
        teams={isAccounts ? STAFF_TEAM_OPTIONS : undefined}
        /* Accounts opens on its own job — the requests waiting for a decision.
           "With admin to pay" is the handover it can watch but not act on. */
        filters={isAccounts
          ? [{ value: 'to_approve', label: 'To approve' }, { value: 'to_pay', label: 'With admin to pay' }, { value: 'paid', label: 'Paid' }, { value: 'all', label: 'All' }]
          : [{ value: 'open', label: 'In progress' }, { value: 'paid', label: 'Paid' }, { value: 'all', label: 'All' }]}
      />
    </div>
  );
}
