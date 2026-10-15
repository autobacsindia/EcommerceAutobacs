'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import PaymentRequestForm from '@/components/payments/PaymentRequestForm';
import PaymentRequestList from '@/components/payments/PaymentRequestList';
import { paymentKeys } from '@/components/payments/api';

const TEAMS = [
  { value: 'procurement', label: 'Procurement' },
  { value: 'operations', label: 'Operations' },
  { value: 'marketing', label: 'Marketing' },
];

/**
 * Payments in the team panel.
 *   operations / marketing — raise expenses and follow them
 *   procurement           — follow supplier payments (raised from each order)
 *   accounts              — pay what the admin has approved; see every team
 */
export default function TeamPaymentsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const team = user?.staff?.team;
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  const raisesExpenses = team === 'operations' || team === 'marketing';
  const isAccounts = team === 'accounts';

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
          <p className="text-sm text-gray-500">
            {isAccounts
              ? 'Pay what the admin has approved, then record the payment with its reference and screenshot.'
              : 'Each request goes to the admin for approval, then accounts pays it. Download the slip or receipt at any stage.'}
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
        initial={isAccounts ? 'to_pay' : 'open'}
        teams={isAccounts ? TEAMS : undefined}
        filters={isAccounts
          ? [{ value: 'to_pay', label: 'To pay' }, { value: 'submitted', label: 'Waiting for admin' }, { value: 'paid', label: 'Paid' }, { value: 'all', label: 'All' }]
          : [{ value: 'open', label: 'In progress' }, { value: 'paid', label: 'Paid' }, { value: 'all', label: 'All' }]}
      />
    </div>
  );
}
