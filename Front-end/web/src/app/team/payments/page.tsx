'use client';

import { Suspense, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import PaymentRequestForm from '@/components/payments/PaymentRequestForm';
import PaymentRequestList from '@/components/payments/PaymentRequestList';
import { paymentKeys } from '@/components/payments/api';
import SubscriptionList from '@/components/payments/subscriptions/SubscriptionList';
import SupplierCreditTab from '@/components/payments/SupplierCredit';
import { STAFF_TEAM_OPTIONS } from '@/lib/staffTeams';
import { useListParams } from '@/lib/hooks/useListParams';

// Accounts filters by team — the shared list, so a new team appears at once.

/**
 * Payments in the team panel.
 *   every team  — raise expenses (each team's own options, from the server) and follow them
 *   procurement — also follows supplier payments (raised from each order)
 *   accounts    — approves or declines everything, and sees every team;
 *                 the admin then pays
 * and, on its own tab, Subscriptions & dues: each team's tools and bills,
 * checked by accounts (who sees every team's).
 */
export default function TeamPaymentsPage() {
  // The tab lives in the address (useSearchParams): inside Suspense.
  return (
    <Suspense fallback={null}>
      <TeamPayments />
    </Suspense>
  );
}

function TeamPayments() {
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
  const { values } = useListParams({ tab: 'requests' });
  const router = useRouter();
  const pathname = usePathname();
  // Supplier credit (what suppliers owe us): accounts approves, procurement proposes.
  const seesCredit = isAccounts || team === 'procurement';
  const tab = values.tab === 'subs' ? 'subs' : values.tab === 'credit' && seesCredit ? 'credit' : 'requests';
  // Each tab has its own search and filters; switching starts the other one clean.
  const show = (t: 'requests' | 'subs' | 'credit') => router.replace(`${pathname}${t === 'requests' ? '' : `?tab=${t}`}`, { scroll: false });
  const tabs = [['requests', 'Requests'], ['subs', 'Subscriptions & dues'], ...(seesCredit ? [['credit', 'Supplier credit']] : [])] as ['requests' | 'subs' | 'credit', string][];

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
          <p className="text-sm text-gray-500">
            {tab === 'subs'
              ? 'Tools, subscriptions and bills, and when each is next due.'
              : tab === 'credit'
              ? 'What suppliers owe us — refunds for cancelled orders, less what they paid back or we used on their next payment.'
              : isAccounts
              ? 'Approve or decline every request — from any team. The admin pays what you approve, and records the reference and screenshot.'
              : 'Every request goes to accounts to approve, then to the admin to pay. Download the slip or receipt at any stage.'}
          </p>
        </div>
        {tab === 'requests' && raisesExpenses && !adding && (
          <button type="button" onClick={() => { setAdding(true); setNotice(''); }} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" /> New expense
          </button>
        )}
      </div>

      <div role="tablist" aria-label="Payments view" className="flex flex-wrap gap-2">
        {tabs.map(([t, text]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => { if (t !== tab) { setAdding(false); setNotice(''); show(t); } }}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === t ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
            {text}
          </button>
        ))}
      </div>

      {tab === 'subs' && (
        <SubscriptionList
          teams={isAccounts ? STAFF_TEAM_OPTIONS : undefined}
          intro={isAccounts
            ? 'Every team’s tools, subscriptions and bills, soonest due first. Check each one: verify it, or reject it with a reason the team sees.'
            : undefined}
        />
      )}

      {tab === 'credit' && <SupplierCreditTab />}

      {tab === 'requests' && notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {tab === 'requests' && adding && (
        <PaymentRequestForm
          onCancel={() => setAdding(false)}
          onDone={(r) => {
            setAdding(false);
            setNotice(`${r.number} sent for approval. You will see it move here and in team chat.`);
            qc.invalidateQueries({ queryKey: [...paymentKeys.all, 'list'] });
          }}
        />
      )}

      {/* The list keeps its search and filters in the address (useSearchParams). */}
      {tab === 'requests' && (
        <PaymentRequestList
          initial={isAccounts ? 'to_approve' : 'open'}
          teams={isAccounts ? STAFF_TEAM_OPTIONS : undefined}
          /* Accounts opens on its own job — the requests waiting for a decision.
             "With admin to pay" is the handover it can watch but not act on. */
          filters={isAccounts
            ? [
              { value: 'to_approve', label: 'To approve' }, { value: 'to_pay', label: 'With admin to pay' },
              { value: 'on_hold', label: 'On hold' }, { value: 'paid', label: 'Paid' },
              { value: 'declined', label: 'Declined' }, { value: 'all', label: 'All' },
            ]
            : [{ value: 'open', label: 'In progress' }, { value: 'paid', label: 'Paid' }, { value: 'declined', label: 'Declined' }, { value: 'all', label: 'All' }]}
        />
      )}
    </div>
  );
}
