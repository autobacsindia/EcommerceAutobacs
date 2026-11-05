'use client';

/**
 * Accounts' one Refunds page (owner-approved, 2026-11-05): two kinds of refund that
 * used to be two menu items people mixed up.
 *
 *   Cancelled orders — the customer cancelled before delivery; accounts approves.
 *   Returned items   — the return passed inspection; accounts pays the customer back.
 *
 * Each tab is the list that page always showed, unchanged — same component, same
 * API, same money code. Only the navigation moved. The tab lives in the address
 * (?tab=returns) so the bell, emails and the old /team/return-refunds link land on
 * the right one. The counts come from the bell's own summary (same query key, so no
 * extra request) — the number on a tab is the number on the bell.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import WorkQueueList from '@/components/staff/work/WorkQueueList';
import { ReturnList } from '@/components/staff/returns/ReturnsBoard';
import { useWaitingWork } from '@/hooks/queries/useNotifications';

export type RefundTab = 'cancelled' | 'returns';

const TABS: { key: RefundTab; label: string; countKey: string }[] = [
  { key: 'cancelled', label: 'Cancelled orders', countKey: 'refunds_to_send' },
  { key: 'returns', label: 'Returned items', countKey: 'returns_refund' },
];

/** Anything unknown (no tab, an old or mistyped link) opens the first tab. */
export function tabFrom(value: string | null): RefundTab {
  return TABS.some((t) => t.key === value) ? (value as RefundTab) : 'cancelled';
}

export default function RefundsTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const tab = tabFrom(useSearchParams().get('tab'));
  const { data } = useWaitingWork();
  const countOf = (key: string) => data?.items.find((i) => i.key === key)?.count;

  // A new tab starts clean: the two lists use different filters, so one tab's
  // search words or sort must not leak into the other.
  const open = (key: RefundTab) => router.replace(`${pathname}?tab=${key}`, { scroll: false });

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Which refunds" className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const count = countOf(t.countKey);
          const selected = tab === t.key;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={selected} onClick={() => open(t.key)}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${selected ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
              {t.label}
              {count !== undefined && (
                <span aria-label={`${count} waiting`}
                  className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${selected ? 'bg-white text-gray-900' : count > 0 ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'cancelled' ? (
        <section aria-label="Cancelled orders">
          <p className="mb-4 text-sm text-gray-500">
            The customer cancelled before delivery. Once you approve, the item is cancelled and an admin pays the refund.
          </p>
          <WorkQueueList queue="refunds" />
        </section>
      ) : (
        <section aria-label="Returned items">
          <p className="mb-4 text-sm text-gray-500">
            Returns that passed inspection. The amount is worked out by the system from what the customer paid — send it once.
            Up to ₹25,000 any accounts member; above that the accounts head. Bank-transfer and cash orders are paid back by an admin.
          </p>
          <ReturnList queue="refund" showRefund />
        </section>
      )}
    </div>
  );
}
