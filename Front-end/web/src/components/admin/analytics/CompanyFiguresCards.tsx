'use client';

/**
 * Whole-company Revenue and Sales for the financial year (Zoho bills after
 * refunds + panel orders not billed in Zoho). Admin only — the stats API
 * refuses everyone else.
 *
 * These lived in the admin header until the owner asked for them to sit in
 * Analytics instead: they are a business figure, not something every admin
 * page needs in view. Hover shows the breakdown; click opens the Company
 * revenue page with every sale.
 */
import Link from 'next/link';
import { useAdminStats } from '@/hooks/queries/useAdminStats';
import { formatCurrency } from '@/lib/utils';
import { compactRupees } from '@/lib/compactRupees';

const n = (x: number) => x.toLocaleString('en-IN');

export default function CompanyFiguresCards() {
  const { stats, isError } = useAdminStats();
  const company = stats.companyRevenue;
  const sales = stats.sales;

  const revenueTitle = company
    ? [
        `Revenue ${company.period.label}: ${formatCurrency(company.total)} incl. GST`,
        `• Zoho Books bills after refunds: ${formatCurrency(company.zoho)} (${formatCurrency(company.zohoExGst)} without GST)`,
        `   refunds taken off (credit notes): ${formatCurrency(company.creditNotes)}`,
        `• Website & sales-panel orders not yet billed in Zoho: ${formatCurrency(company.panelNotInZoho)}`,
        'Each sale counted once; cancelled, refunded, draft and void are left out.',
        ...(company.needsCheck.count ? [`${n(company.needsCheck.count)} Zoho bill(s) are probably website orders — counted once; please confirm on the page.`] : []),
        'Click for every sale.',
      ].join('\n')
    : 'Realised revenue since the start of the financial year — excludes cancelled, returned and abandoned orders';
  const salesTitle = sales
    ? [
        `Sales ${sales.fyLabel}: ${n(sales.total)}`,
        `• Billed in Zoho Books: ${n(sales.zoho)}`,
        `• Website orders not yet in Zoho: ${n(sales.website.total)} — delivered ${n(sales.website.delivered)}, shipped ${n(sales.website.shipped)}, processing ${n(sales.website.processing)}`,
        `Not counted: ${n(sales.zohoCancelled)} Zoho bill(s) cancelled by credit note, and cancelled / returned / refunded orders.`,
        'Click for every sale.',
      ].join('\n')
    : '';

  const periodLabel = company?.period.label ?? stats.revenuePeriod?.label;

  return (
    <section aria-label="Company figures" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Link
        href="/admin/revenue"
        title={revenueTitle}
        className="block rounded-lg bg-white p-5 shadow transition-colors hover:bg-gray-50"
      >
        <p className="text-sm text-gray-500">Company revenue{periodLabel ? ` (${periodLabel})` : ''}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-green-700">
          {isError ? '—' : company ? compactRupees(company.total) : formatCurrency(stats.totalRevenue)}
        </p>
        {company && !isError && <p className="mt-1 text-xs text-gray-400">incl. GST · all sales · whole financial year</p>}
      </Link>
      <Link
        href="/admin/revenue#sales"
        title={salesTitle}
        className="block rounded-lg bg-white p-5 shadow transition-colors hover:bg-gray-50"
      >
        <p className="text-sm text-gray-500">Company sales{sales ? ` (${sales.fyLabel})` : ''}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-blue-700">{isError || !sales ? '—' : n(sales.total)}</p>
        {sales && !isError && (
          <p className="mt-1 text-xs text-gray-400">{n(sales.website.shipped + sales.website.processing)} on the way</p>
        )}
      </Link>
    </section>
  );
}
