'use client';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { postForm } from '@/lib/postForm';
import { adminKeys } from '@/hooks/queries/keys';
import { compactRupees } from '@/lib/compactRupees';
import { formatCurrency } from '@/lib/utils';
import { errorMessage } from '@/components/staff/sales/types';
import {
  monthLabel,
  orderRef,
  type CompanyRevenueSummary,
  type RevenuePeriod,
  type SaleRow,
  type SaleSource,
  type ZohoImportResult,
  type ZohoInvoiceRow,
} from './types';
import UnbilledSection from './UnbilledSection';

const SOURCE_LABELS = { web: 'Website', woocommerce: 'Old website (WooCommerce)', offline: 'Sales panel' } as const;
const dateIN = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

/**
 * The company's whole revenue and orders fulfilled — what the admin header
 * tiles summarise — and the Zoho Books import behind the store / B2B part.
 * Every figure comes from the server; nothing here is computed from guesses.
 */
export default function CompanyRevenuePage() {
  const [period, setPeriod] = useState<RevenuePeriod>('fy');
  const summary = useQuery({
    queryKey: adminKeys.companyRevenue(period),
    queryFn: () => apiClient.get<{ summary: CompanyRevenueSummary }>(`/admin/revenue?period=${period}`),
    select: (d) => d.summary,
    staleTime: 30_000,
  });
  const s = summary.data;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="pn-title text-2xl text-gray-900">Company revenue</h1>
          <p className="text-sm text-gray-500">Every sale counted once: website, old website, sales panel and Zoho Books bills. Amounts include GST.</p>
        </div>
        <div role="group" aria-label="Period" className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
          {(['fy', 'all'] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
              className={`rounded-md px-3 py-1.5 font-medium ${period === p ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {p === 'fy' ? 'This financial year' : 'All time'}
            </button>
          ))}
        </div>
      </header>

      {summary.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(summary.error, 'Could not load the figures.')}</p>}
      {summary.isPending && <div className="h-40 animate-pulse rounded-2xl bg-gray-100" aria-label="Loading" />}

      {s && (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl bg-gradient-to-br from-green-700 to-emerald-600 p-5 text-white shadow-sm md:col-span-2">
              <p className="text-sm text-green-100">Revenue · {s.period.label} · incl. GST</p>
              <p className="mt-1 text-4xl font-bold tabular-nums" title={formatCurrency(s.revenue.total)}>{compactRupees(s.revenue.total)}</p>
              <p className="mt-2 text-sm text-green-50">
                Zoho Books bills {compactRupees(s.revenue.zoho.total)} · Website orders not yet in Zoho {compactRupees(s.revenue.website.total)}
              </p>
              <p className="mt-1 text-sm text-amber-100">
                <a href="#unbilled" className="underline decoration-amber-200/60 hover:decoration-amber-100">
                  Paid, no sale bill yet {compactRupees(s.revenue.unbilled.total)}
                </a>
                {s.revenue.unbilled.needsCheck.count > 0 && ` · ${s.revenue.unbilled.needsCheck.count.toLocaleString('en-IN')} to check, not counted`}
              </p>
            </div>
            <div className="rounded-2xl bg-gradient-to-br from-blue-700 to-indigo-600 p-5 text-white shadow-sm">
              <p className="text-sm text-blue-100">Sales · {s.period.label}</p>
              <p className="mt-1 text-4xl font-bold tabular-nums">{s.sales.total.toLocaleString('en-IN')}</p>
              <p className="mt-2 text-sm text-blue-50">
                {s.sales.zoho.toLocaleString('en-IN')} billed in Zoho · {s.sales.website.total.toLocaleString('en-IN')} website orders not yet in Zoho ({s.sales.website.delivered.toLocaleString('en-IN')} delivered, {(s.sales.website.shipped + s.sales.website.processing).toLocaleString('en-IN')} on the way)
                {s.sales.unbilled > 0 && ` · ${s.sales.unbilled.toLocaleString('en-IN')} paid, no sale bill yet`}
              </p>
              {s.sales.zohoCancelled > 0 && (
                <p className="mt-1 text-xs text-blue-100">{s.sales.zohoCancelled.toLocaleString('en-IN')} Zoho bill(s) cancelled by credit note — not counted</p>
              )}
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <h2 className="font-semibold text-gray-900">Website & sales-panel orders not yet in Zoho</h2>
              <dl className="mt-3 space-y-2 text-sm">
                {(Object.keys(SOURCE_LABELS) as (keyof typeof SOURCE_LABELS)[]).map((k) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-gray-600">{SOURCE_LABELS[k]} <span className="text-gray-400">({s.revenue.website.bySource[k].count.toLocaleString('en-IN')})</span></dt>
                    <dd className="tabular-nums">{formatCurrency(s.revenue.website.bySource[k].total)}</dd>
                  </div>
                ))}
                {s.revenue.website.extraCharges > 0 && (
                  <div className="flex justify-between gap-3"><dt className="text-gray-600">Extra charges paid</dt><dd className="tabular-nums">{formatCurrency(s.revenue.website.extraCharges)}</dd></div>
                )}
              </dl>
              <p className="mt-3 text-xs text-gray-500">Processing, shipped and delivered orders that no Zoho bill stands for. Cancelled, returned and refunded orders are left out.</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <h2 className="font-semibold text-gray-900">Zoho Books bills</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-gray-600">Bills after refunds ({s.revenue.zoho.count.toLocaleString('en-IN')})</dt><dd className="tabular-nums">{formatCurrency(s.revenue.zoho.total)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-gray-600">Refunds already taken off (credit notes)</dt><dd className="tabular-nums">{formatCurrency(s.revenue.zoho.creditNotes)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-gray-600">Same bills without GST</dt><dd className="tabular-nums">{formatCurrency(s.revenue.zoho.exGst)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-gray-600">Of which still unpaid</dt><dd className="tabular-nums">{formatCurrency(s.revenue.zoho.unpaid)}</dd></div>
                <div className="flex justify-between gap-3 text-gray-500"><dt>Of which bills for website orders (order not added again) ({s.zohoMatched.linked.count})</dt><dd className="tabular-nums">{formatCurrency(s.zohoMatched.linked.total)}</dd></div>
                <div className="flex justify-between gap-3 text-amber-700"><dt>Of which probably website orders — please check ({s.zohoMatched.needsCheck.count})</dt><dd className="tabular-nums">{formatCurrency(s.zohoMatched.needsCheck.total)}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-gray-500">
                {s.lastImport ? `Last Zoho upload ${dateIN(s.lastImport.at)}${s.lastImport.byName ? ` by ${s.lastImport.byName}` : ''}.` : 'No Zoho bills uploaded yet.'}{' '}
                Draft and void bills are never counted; a bill fully refunded by a credit note is not a sale.
              </p>
            </div>
          </section>

          <section className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="p-4 text-left font-semibold text-gray-900">Month by month</caption>
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left">Month</th>
                  <th scope="col" className="px-4 py-2 text-right">Website (not in Zoho)</th>
                  <th scope="col" className="px-4 py-2 text-right">Zoho bills</th>
                  <th scope="col" className="px-4 py-2 text-right">Paid, no bill yet</th>
                  <th scope="col" className="px-4 py-2 text-right">Total</th>
                  <th scope="col" className="px-4 py-2 text-right">Sales</th>
                  <th scope="col" className="px-4 py-2 text-right">To check</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {s.months.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500">No sales in this period.</td></tr>
                )}
                {s.months.map((m) => (
                  <tr key={m.month}>
                    <th scope="row" className="px-4 py-2 text-left font-medium text-gray-800">{monthLabel(m.month)}</th>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(m.website)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(m.zoho)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-amber-800">{m.unbilled ? formatCurrency(m.unbilled) : ''}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatCurrency(m.total)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{m.sales.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-amber-700">{m.needsCheck || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      <SalesList period={period} />
      <ZohoUpload />
      <NeedsCheck />
      <UnbilledSection period={period} />
    </div>
  );
}

function useRefreshFigures() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: adminKeys.companyRevenueAll() }),
    qc.invalidateQueries({ queryKey: adminKeys.zohoInvoicesAll() }),
    qc.invalidateQueries({ queryKey: adminKeys.stats() }),
  ]);
}

const IMPORT_LABELS = { invoices: 'Bills', credit_notes: 'Credit notes', payments: 'Payments with no bill', paid_sales: 'Paid sales without bill' } as const;

function ZohoUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ZohoImportResult | null>(null);
  const [error, setError] = useState('');
  const refresh = useRefreshFigures();
  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData();
      if (file) form.append('file', file);
      return postForm<{ result: ZohoImportResult }>('/admin/revenue/zoho-import', form);
    },
    onMutate: () => { setError(''); setResult(null); },
    onSuccess: async (d) => { setResult(d.result); await refresh(); },
    onError: (e) => setError(errorMessage(e, 'Could not read the file.')),
  });

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="font-semibold text-gray-900">Upload Zoho Books bills</h2>
      <p className="mt-1 text-sm text-gray-600">
        In Zoho Books export <strong>Sales → Invoices</strong>, <strong>Sales → Credit Notes</strong> and{' '}
        <strong>Payments Received → Export → Invoice Payments</strong> (CSV) and upload each file here.
        Zoho exports at most 6 months at a time. Uploading the same file again updates it — nothing is counted twice.
        From the payments file only money <em>not yet on any bill</em> is added, as &ldquo;Paid, no sale bill yet&rdquo;.
        You can also upload our own <strong>paid-sales sheet</strong> (money seen only in ClickUp or the bank) with the columns{' '}
        <code className="rounded bg-gray-100 px-1 text-xs">Sale Reference, Customer, Amount Received, Date Received, Mode, Proof, Note</code>{' '}
        — each Sale Reference is counted once, and uploading the sheet again updates it.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="Zoho CSV file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        <button
          type="button"
          disabled={!file || upload.isPending}
          onClick={() => upload.mutate()}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {upload.isPending ? 'Uploading…' : 'Upload'}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {result && (
        <div role="status" className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">
          {IMPORT_LABELS[result.kind]}: {result.inserted} new, {result.updated} updated. Left out: {result.skipped.draft} draft, {result.skipped.void} void.
          {result.kind === 'payments' && !!result.billed && ` ${result.billed} now on a bill in Zoho — no longer counted here.`}
          {result.creditsUnmatched > 0 && ` ${result.creditsUnmatched} credit note(s) wait for their bill to be uploaded.`}
          {result.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-amber-800">{result.errors.slice(0, 20).map((e) => <li key={e}>{e}</li>)}</ul>
          )}
        </div>
      )}
    </section>
  );
}

function NeedsCheck() {
  const refresh = useRefreshFigures();
  const list = useInfiniteQuery({
    queryKey: adminKeys.zohoInvoices('needs_check'),
    queryFn: ({ pageParam }) => apiClient.get<{ invoices: ZohoInvoiceRow[]; nextCursor: string | null }>(
      `/admin/revenue/zoho-invoices?state=needs_check${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`
    ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'same' | 'different' }) =>
      apiClient.patch(`/admin/revenue/zoho-invoices/${encodeURIComponent(id)}`, { decision }),
    onSuccess: () => refresh(),
  });
  const rows = list.data?.pages.flatMap((p) => p.invoices) ?? [];
  if (!list.isPending && rows.length === 0) return null;

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5">
      <h2 className="font-semibold text-gray-900">Zoho bills to check</h2>
      <p className="mt-1 text-sm text-gray-600">
        Each of these Zoho bills is probably the website order shown, so that order is <strong>not added again</strong> — the sale counts once.
        If it is really a separate sale, press &ldquo;Separate sale&rdquo; and both will count.
      </p>
      {decide.isError && <p role="alert" className="mt-2 text-sm text-red-700">{errorMessage(decide.error, 'Could not save that.')}</p>}
      <ul className="mt-3 divide-y divide-amber-100">
        {rows.map((inv) => {
          const o = inv.match.order;
          return (
            <li key={inv._id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">
                  Zoho {inv.invoiceNumber} · {dateIN(inv.invoiceDate)} · {inv.customerName || '—'} · {formatCurrency(inv.total)}
                </p>
                {o && (
                  <p className="text-gray-600">
                    Looks like {orderRef(o._id)} · {dateIN(o.createdAt)} · {o.shippingAddress?.fullName || '—'} · {formatCurrency(o.totalAmount)}
                  </p>
                )}
                {inv.match.reason && <p className="text-xs text-gray-500">{inv.match.reason}</p>}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={decide.isPending || !o}
                  onClick={() => decide.mutate({ id: inv._id, decision: 'same' })}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  Same sale
                </button>
                <button
                  type="button"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: inv._id, decision: 'different' })}
                  className="rounded-lg bg-gray-900 px-3 py-1.5 font-medium text-white disabled:opacity-50"
                >
                  Separate sale — count both
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {list.hasNextPage && (
        <button type="button" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage} className="mt-3 text-sm font-medium text-blue-700">
          {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </section>
  );
}

const SALE_SOURCE_LABELS: Record<SaleSource, string> = {
  web: 'Website', woocommerce: 'Old website', offline: 'Sales panel', zoho: 'Zoho (store & B2B)',
};
const STATUS_LABELS: Record<string, string> = {
  delivered: 'Delivered', shipped: 'Shipped', processing: 'Processing', confirmed: 'Processing',
  closed: 'Paid', overdue: 'Unpaid', sent: 'Unpaid', partially_paid: 'Part paid', paid: 'Paid',
  cancelled_by_credit_note: 'Cancelled (credit note)',
};

/** Every sale behind the figures, newest first — panel orders and Zoho bills together. */
function SalesList({ period }: { period: RevenuePeriod }) {
  const [source, setSource] = useState<SaleSource | ''>('');
  const list = useInfiniteQuery({
    queryKey: adminKeys.companySales(period, source),
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ period });
      if (source) q.set('source', source);
      if (pageParam) q.set('cursor', pageParam);
      return apiClient.get<{ sales: SaleRow[]; nextCursor: string | null }>(`/admin/revenue/sales?${q.toString()}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.sales) ?? [];

  return (
    <section id="sales" className="scroll-mt-20 rounded-2xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <h2 className="font-semibold text-gray-900">Every sale</h2>
        <div role="group" aria-label="Source" className="flex flex-wrap gap-1.5 text-xs">
          {(['', 'web', 'woocommerce', 'offline', 'zoho'] as const).map((k) => (
            <button
              key={k || 'all'}
              type="button"
              aria-pressed={source === k}
              onClick={() => setSource(k)}
              className={`rounded-full px-3 py-1 font-medium ${source === k ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {k ? SALE_SOURCE_LABELS[k] : 'All'}
            </button>
          ))}
        </div>
      </div>
      {list.isError && <p role="alert" className="px-4 pb-4 text-sm text-red-700">{errorMessage(list.error, 'Could not load the sales.')}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th scope="col" className="px-4 py-2 text-left">Date</th>
              <th scope="col" className="px-4 py-2 text-left">Sale</th>
              <th scope="col" className="px-4 py-2 text-left">Customer</th>
              <th scope="col" className="px-4 py-2 text-left">Source</th>
              <th scope="col" className="px-4 py-2 text-left">Status</th>
              <th scope="col" className="px-4 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {list.isPending && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">Loading…</td></tr>}
            {!list.isPending && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">No sales.</td></tr>}
            {rows.map((r) => (
              <tr key={`${r.kind}-${r._id}`} className={r.status === 'cancelled_by_credit_note' ? 'text-gray-400' : ''}>
                <td className="whitespace-nowrap px-4 py-2">{dateIN(r.date)}</td>
                <td className="px-4 py-2">
                  {r.kind === 'order'
                    ? <a href={`/admin/orders/${r._id}`} className="font-medium text-blue-700 hover:underline">{orderRef(r._id)}</a>
                    : <span className="font-medium">{r.number}</span>}
                </td>
                <td className="px-4 py-2">{r.name || '—'}</td>
                <td className="px-4 py-2">{SALE_SOURCE_LABELS[r.source] ?? r.source}</td>
                <td className="px-4 py-2">{STATUS_LABELS[r.status] ?? r.status}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatCurrency(r.amount)}
                  {!!r.credited && <span className="block text-xs text-gray-500">of {formatCurrency(r.gross ?? 0)}, {formatCurrency(r.credited)} refunded</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.hasNextPage && (
        <div className="p-4">
          <button type="button" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage} className="text-sm font-medium text-blue-700">
            {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
          </button>
        </div>
      )}
    </section>
  );
}
