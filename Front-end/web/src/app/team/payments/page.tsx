'use client';

import { Suspense, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import PaymentRequestForm, { type StockDraft } from '@/components/payments/PaymentRequestForm';
import PaymentRequestList from '@/components/payments/PaymentRequestList';
import { paymentKeys } from '@/components/payments/api';
import SubscriptionList from '@/components/payments/subscriptions/SubscriptionList';
import ReimbursementReport from '@/components/payments/ReimbursementReport';
import SupplierCreditTab from '@/components/payments/SupplierCredit';
import SupplierBillsTab from '@/components/payments/SupplierBills';
import { STAFF_TEAM_OPTIONS } from '@/lib/staffTeams';
import { useListParams } from '@/lib/hooks/useListParams';

// Accounts filters by team — the shared list, so a new team appears at once.

/**
 * Payments in the team panel.
 *   every team  — raise expenses (each team's own options, from the server) and follow them
 *   every team  — also "Pay a supplier": goods bought from a supplier, not for one
 *                 order, so they go under that supplier instead of in as an expense
 *   procurement — also pays suppliers from each order's item, and the bills we owe
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
  // Which form is open: an expense, or a supplier payment not for one order.
  const [adding, setAddingMode] = useState<false | 'expense' | 'supplier'>(false);
  const setAdding = (open: boolean) => { setAddingMode(open ? 'expense' : false); setDraft(undefined); };
  // What an expense form carried over when switched to a supplier payment.
  const [draft, setDraft] = useState<StockDraft | undefined>(undefined);
  const [notice, setNotice] = useState('');
  /*
    Any active staff member may claim an expense — the API is the authority
    (EXPENSE_TEAMS in paymentRequestService), this only decides whether to show
    the button. Admins use the admin panel, not this page.
  */
  const raisesExpenses = !!team;
  const isAccounts = team === 'accounts';
  // "Pay a supplier" (not for one order): everyone who raises expenses (owner,
  // 2026-11-25) — the server allows the same. Bills we owe stay procurement's.
  const paysSuppliers = raisesExpenses;
  const paysBills = team === 'procurement';
  const { values } = useListParams({ tab: 'requests' });
  const router = useRouter();
  const pathname = usePathname();
  // Supplier credit (what suppliers owe us): accounts approves, procurement proposes.
  const seesCredit = isAccounts || team === 'procurement';
  const tab = values.tab === 'subs' ? 'subs' : values.tab === 'credit' && seesCredit ? 'credit' : values.tab === 'owe' && seesCredit ? 'owe' : values.tab === 'reimb' && isAccounts ? 'reimb' : 'requests';
  // Each tab has its own search and filters; switching starts the other one clean.
  const show = (t: 'requests' | 'subs' | 'credit' | 'owe' | 'reimb') => router.replace(`${pathname}${t === 'requests' ? '' : `?tab=${t}`}`, { scroll: false });
  const tabs = [
    ['requests', 'Requests'], ['subs', 'Subscriptions & dues'],
    // What we owe suppliers (bills we pay later) beside what suppliers owe us.
    ...(seesCredit ? [['owe', 'We owe suppliers'], ['credit', 'Supplier credit']] : []),
    // Accounts sees each month's reimbursements per person and per task (the admin also sets the fuel rate).
    ...(isAccounts ? [['reimb', 'Reimbursements']] : []),
  ] as ['requests' | 'subs' | 'credit' | 'owe' | 'reimb', string][];

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
          <p className="text-sm text-gray-500">
            {tab === 'subs'
              ? 'Tools, subscriptions and bills, and when each is next due.'
              : tab === 'reimb'
              ? 'Each month’s reimbursements: what each person claimed and was paid, and what each task cost.'
              : tab === 'owe'
              ? 'Supplier bills we pay later: what we owe each supplier, when it is due, and what is overdue.'
              : tab === 'credit'
              ? 'What suppliers owe us — refunds for cancelled orders, less what they paid back or we used on their next payment.'
              : isAccounts
              ? 'Approve or decline every request — from any team. The admin pays what you approve, and records the reference and screenshot.'
              : 'Every request goes to accounts to approve, then to the admin to pay. Download the slip or receipt at any stage.'}
          </p>
        </div>
        {tab === 'requests' && raisesExpenses && !adding && (
          <div className="flex flex-wrap gap-2">
            {paysSuppliers && (
              <button type="button" onClick={() => { setAddingMode('supplier'); setDraft(undefined); setNotice(''); }} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                <Plus className="h-4 w-4" /> Pay a supplier
              </button>
            )}
            <button type="button" onClick={() => { setAdding(true); setNotice(''); }}
              className={paysSuppliers
                ? 'inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50'
                : 'inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700'}>
              <Plus className="h-4 w-4" /> New expense
            </button>
          </div>
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

      {tab === 'owe' && <SupplierBillsTab canAdd={paysBills} />}
      {tab === 'credit' && <SupplierCreditTab />}
      {tab === 'reimb' && <ReimbursementReport canSetRate={false} />}

      {tab === 'requests' && notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {tab === 'requests' && adding && (
        <PaymentRequestForm
          // A new form (fresh one-time submit key) when switching between the two.
          key={String(adding)}
          stock={adding === 'supplier'}
          initial={adding === 'supplier' ? draft : undefined}
          onSwitchToSupplier={paysSuppliers ? (d) => { setDraft(d); setAddingMode('supplier'); } : undefined}
          onCancel={() => setAdding(false)}
          onDone={(r) => {
            setAdding(false);
            setNotice(r.status === 'paid'
              ? `${r.number} is paid fully from supplier credit — nothing to transfer. It is recorded under Paid.`
              : r.paidByCredit
              ? `${r.number} sent to accounts. Supplier credit pays all of it, so nothing is transferred — approving it closes it.`
              : `${r.number} sent for approval. You will see it move here and in team chat.`);
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
