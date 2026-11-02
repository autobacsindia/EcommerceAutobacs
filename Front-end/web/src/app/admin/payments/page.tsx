'use client';

import { Suspense } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import PaymentRequestList from '@/components/payments/PaymentRequestList';
import SupplierPayQueue from '@/components/payments/SupplierPayQueue';
import SubscriptionList from '@/components/payments/subscriptions/SubscriptionList';
import { STAFF_TEAM_OPTIONS } from '@/lib/staffTeams';
import { useListParams } from '@/lib/hooks/useListParams';

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
      {/* The view and the list's search / filters live in the address (useSearchParams). */}
      <Suspense fallback={null}>
        <PaymentsViews />
      </Suspense>
    </div>
  );
}

function PaymentsViews() {
  const { values } = useListParams({ view: 'suppliers' });
  const router = useRouter();
  const pathname = usePathname();
  const view = values.view === 'all' || values.view === 'subs' ? values.view : 'suppliers';
  // Each view has its own search and filters; switching starts the other one clean
  // (a search typed in one is not silently applied to the other).
  const show = (v: 'suppliers' | 'all' | 'subs') => router.replace(`${pathname}${v === 'suppliers' ? '' : `?view=${v}`}`, { scroll: false });
  return (
    <>
      <div role="tablist" aria-label="Payments view" className="flex flex-wrap gap-2">
        {([['suppliers', 'Supplier payments — by supplier'], ['all', 'All requests'], ['subs', 'Subscriptions & dues']] as const).map(([v, text]) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => { if (v !== view) show(v); }}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${view === v ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
            {text}
          </button>
        ))}
      </div>
      {view === 'suppliers' ? <SupplierPayQueue canPay /> : view === 'subs' ? (
        <SubscriptionList teams={STAFF_TEAM_OPTIONS} intro="Every team's tools, subscriptions and bills, soonest due first. Accounts verifies them; you can verify, reject, edit or delete any." />
      ) : (
        <PaymentRequestList
          initial="to_pay"
          teams={STAFF_TEAM_OPTIONS}
          /* The admin opens on what they must PAY — accounts has already approved
             it and nothing moves until the money goes out. "Waiting for accounts"
             is there to look at, not to act on. */
          filters={[
            { value: 'to_pay', label: 'To pay' },
            { value: 'to_approve', label: 'Waiting for accounts' },
            { value: 'on_hold', label: 'On hold' },
            { value: 'paid', label: 'Paid' },
            { value: 'declined', label: 'Declined' },
            { value: 'all', label: 'All' },
          ]}
        />
      )}
    </>
  );
}
