'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { MARKETING_BASE } from '@/lib/usePanel';
import apiClient from '@/lib/api';
import { formatDateTimeIST } from '@/lib/datetime';
import { useListParams } from '@/lib/hooks/useListParams';
import { ListClear, ListDateRange, ListSearch, ListSelect } from '@/components/panel/ListControls';

/**
 * "Website errors" — what went wrong for CUSTOMERS on the website: page crashes,
 * script errors, failed checkouts and payments, failed careers uploads. One row per
 * DIFFERENT error, with how often it happened (the backend groups repeats).
 *
 * The same page serves three panels; the API decides what each sees:
 *   - Admin and the Developer (DevOps) team: every feature, and Mark resolved.
 *   - Marketing: payments, checkout and careers, read only.
 * Filters live in the page address, so a link to a filtered list can be shared.
 */

export type ClientErrorFeature = 'page-crash' | 'script' | 'checkout' | 'payment' | 'careers';

interface Sample {
  at: string;
  url?: string;
  message?: string;
  stack?: string;
  browser?: string;
  os?: string;
  device?: string;
  release?: string;
  user?: { _id: string; name?: string; email?: string } | null;
  orderId?: string | null;
  context?: Record<string, string>;
}

export interface ClientErrorRow {
  _id: string;
  feature: ClientErrorFeature;
  step: string;
  level: 'error' | 'warning';
  name: string;
  message: string;
  path: string;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastRelease?: string;
  status: 'open' | 'resolved';
  resolvedAt?: string | null;
  resolvedNote?: string;
  resolvedBy?: { name?: string } | null;
  reopenedAt?: string | null;
  samples?: Sample[];
}

interface ListResponse {
  errors: ClientErrorRow[];
  nextCursor: string | null;
  features: ClientErrorFeature[];
  canResolve: boolean;
}

export const FEATURE_LABELS: Record<ClientErrorFeature, string> = {
  'page-crash': 'Page crash',
  script: 'Script error',
  checkout: 'Checkout',
  payment: 'Payment',
  careers: 'Careers',
};

/** Plain words for each step the storefront reports. Unknown steps show as sent. */
const STEP_LABELS: Record<string, string> = {
  'route-error': 'Error page shown',
  'root-crash': 'Whole page crashed',
  'root-chunk-load': 'Page files failed to download',
  'optional-chunk': 'Optional page part failed to download',
  uncaught: 'Uncaught error',
  'unhandled-rejection': 'Unhandled promise',
  'page-crash': 'Checkout page crashed',
  'component-crash': 'Part of the page crashed',
  'place-order': 'Placing the order failed',
  'gateway-load': 'Razorpay did not load',
  open: 'Could not open payment',
  'payment-failed': 'Payment failed',
  dismissed: 'Customer closed payment window',
  verify: 'Payment check failed',
  prepare: 'Preparing the form',
  'upload-signature': 'Could not start the upload',
  'file-upload': 'A file failed to upload',
  submit: 'Saving the application failed',
};
const stepLabel = (step: string) => STEP_LABELS[step] || step || '—';

const STATUS_TABS = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: '', label: 'All' },
];

export default function WebsiteErrorsPage({ intro }: { intro?: string }) {
  return (
    <Suspense>
      <WebsiteErrors intro={intro} />
    </Suspense>
  );
}

function WebsiteErrors({ intro }: { intro?: string }) {
  const { values: v, set, clear } = useListParams({ status: 'open', feature: '', q: '', from: '', to: '' });
  const status = STATUS_TABS.some((t) => t.value === v.status) ? v.status : 'open';
  const filtered = Boolean(v.feature || v.q || v.from || v.to);
  const [rows, setRows] = useState<ClientErrorRow[]>([]);
  const [features, setFeatures] = useState<ClientErrorFeature[]>([]);
  const [canResolve, setCanResolve] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  // Only the latest request may paint: a filter change can answer after a later one.
  const latestLoad = useRef(0);
  const load = useCallback(async () => {
    const mine = ++latestLoad.current;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (v.feature) params.set('feature', v.feature);
      if (v.q) params.set('q', v.q);
      if (v.from) params.set('from', v.from);
      if (v.to) params.set('to', v.to);
      if (cursor) params.set('cursor', cursor);
      const res = await apiClient.get<ListResponse>(`/client-errors?${params}`);
      if (mine !== latestLoad.current) return;
      setRows(res.errors || []);
      setNextCursor(res.nextCursor);
      setFeatures(res.features || []);
      setCanResolve(Boolean(res.canResolve));
      setError(null);
    } catch (err) {
      if (mine !== latestLoad.current) return;
      setError(err instanceof Error ? err.message : 'Could not load website errors');
    } finally {
      if (mine === latestLoad.current) setLoading(false);
    }
  }, [cursor, status, v.feature, v.q, v.from, v.to]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setCursor(null); setCursorStack([]); }, [status, v.feature, v.q, v.from, v.to]);

  const featureOptions = features.map((f) => ({ value: f, label: FEATURE_LABELS[f] || f }));

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-gray-600">
        {intro || 'Problems customers hit on the website: crashed pages, failed payments, failed careers uploads. Each row is one kind of error, with how many times it happened. Staff pages and staff logins are not counted.'}
      </p>

      <div role="tablist" aria-label="Error status" className="flex flex-wrap gap-2">
        {STATUS_TABS.map((t) => (
          <button key={t.value || 'all'} type="button" role="tab" aria-selected={status === t.value} onClick={() => set({ status: t.value })}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${status === t.value ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div role="search" aria-label="Filter website errors" className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ListSearch value={v.q} onChange={(text) => set({ q: text.trim() })} label="Search errors" placeholder="Search message, page or step" />
          {featureOptions.length > 1 && (
            <ListSelect label="Feature" value={v.feature} onChange={(x) => set({ feature: x })} options={featureOptions} allLabel="Every feature" />
          )}
        </div>
        <ListDateRange label="Last happened" from={v.from} to={v.to} onChange={(from, to) => set({ from, to })}>
          <span>Last happened</span>
        </ListDateRange>
        {filtered && <div className="flex justify-end"><ListClear onClear={() => clear(['status'])} /></div>}
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Feature</th>
              <th className="px-3 py-2">What happened</th>
              <th className="px-3 py-2">Page</th>
              <th className="px-3 py-2 text-right">Times</th>
              <th className="px-3 py-2">Last seen</th>
              <th className="px-3 py-2">First seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">
                {status === 'open' ? 'No open errors. Customers are not hitting any problems we know of.' : 'Nothing matches these filters.'}
              </td></tr>
            )}
            {rows.map((r) => (
              <tr key={r._id} className="cursor-pointer align-top hover:bg-gray-50" onClick={() => setOpenId(r._id)}>
                <td className="px-3 py-2">
                  <FeatureBadge feature={r.feature} level={r.level} />
                  {r.status === 'resolved' && <span className="ml-1 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">Resolved</span>}
                  {r.reopenedAt && r.status === 'open' && <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">Back again</span>}
                </td>
                <td className="max-w-md px-3 py-2">
                  <button type="button" className="text-left" onClick={(e) => { e.stopPropagation(); setOpenId(r._id); }}>
                    <span className="block font-medium text-gray-900">{stepLabel(r.step)}</span>
                    <span className="block break-words text-gray-600">{r.message}</span>
                  </button>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-gray-600">{r.path || '—'}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">{r.count.toLocaleString('en-IN')}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{formatDateTimeIST(r.lastSeenAt)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{formatDateTimeIST(r.firstSeenAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <button type="button" disabled={!cursorStack.length || loading}
          onClick={() => { const prev = [...cursorStack]; const c = prev.pop() ?? null; setCursorStack(prev); setCursor(c || null); }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm disabled:opacity-40">
          ← Newer
        </button>
        <button type="button" disabled={!nextCursor || loading}
          onClick={() => { setCursorStack((s) => [...s, cursor || '']); setCursor(nextCursor); }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm disabled:opacity-40">
          Older →
        </button>
      </div>

      {openId && (
        <ErrorDetail id={openId} canResolve={canResolve} onClose={() => setOpenId(null)} onChanged={load} />
      )}
    </div>
  );
}

function FeatureBadge({ feature, level }: { feature: ClientErrorFeature; level: 'error' | 'warning' }) {
  const tone = level === 'warning'
    ? 'bg-amber-100 text-amber-800'
    : feature === 'payment' || feature === 'checkout' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800';
  return <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${tone}`}>{FEATURE_LABELS[feature] || feature}</span>;
}

function ErrorDetail({ id, canResolve, onClose, onChanged }: {
  id: string; canResolve: boolean; onClose: () => void; onChanged: () => void;
}) {
  const [row, setRow] = useState<ClientErrorRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  // Where an order opens depends on the panel: admin and marketing have an order
  // screen; the developer team has none, so it sees the id only.
  const pathname = usePathname() ?? '';
  const orderHref = (orderId: string) => (pathname.startsWith('/admin')
    ? `/admin/orders/${orderId}`
    : pathname.startsWith(`${MARKETING_BASE}/`) ? `${MARKETING_BASE}/orders/${orderId}` : null);

  const fetchOne = useCallback(async () => {
    try {
      const res = await apiClient.get<{ error: ClientErrorRow }>(`/client-errors/${id}`);
      setRow(res.error);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this error');
    }
  }, [id]);
  useEffect(() => { fetchOne(); }, [fetchOne]);

  // Status is never flipped optimistically: the row shows what the server saved.
  const setStatus = async (status: 'open' | 'resolved') => {
    setBusy(true);
    try {
      await apiClient.patch(`/client-errors/${id}/status`, { status, note });
      setNote('');
      await fetchOne();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Error details" className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900">{row ? stepLabel(row.step) : 'Error details'}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>
        {error && <p role="alert" className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        {!row && !error && <p className="text-sm text-gray-500">Loading…</p>}
        {row && (
          <div className="space-y-5 text-sm">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-gray-500">Feature</dt><dd><FeatureBadge feature={row.feature} level={row.level} /> <span className="text-gray-600">{row.step}</span></dd>
              <dt className="text-gray-500">Error</dt><dd className="break-words font-medium text-gray-900">{row.name}: {row.message}</dd>
              <dt className="text-gray-500">Page</dt><dd className="font-mono text-xs">{row.path || '—'}</dd>
              <dt className="text-gray-500">Times</dt><dd>{row.count.toLocaleString('en-IN')}</dd>
              <dt className="text-gray-500">First seen</dt><dd>{formatDateTimeIST(row.firstSeenAt)}</dd>
              <dt className="text-gray-500">Last seen</dt><dd>{formatDateTimeIST(row.lastSeenAt)}</dd>
              <dt className="text-gray-500">Deploy</dt><dd className="font-mono text-xs">{row.lastRelease || '—'}</dd>
              <dt className="text-gray-500">Status</dt>
              <dd>
                {row.status === 'resolved'
                  ? `Resolved ${formatDateTimeIST(row.resolvedAt)}${row.resolvedBy?.name ? ` by ${row.resolvedBy.name}` : ''}${row.resolvedNote ? ` — ${row.resolvedNote}` : ''}`
                  : row.reopenedAt ? `Open — came back ${formatDateTimeIST(row.reopenedAt)} after being resolved` : 'Open'}
              </dd>
            </dl>

            {canResolve && (
              <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                {row.status === 'open' ? (
                  <>
                    <label className="block text-xs font-medium text-gray-700" htmlFor="resolve-note">Note (optional) — what fixed it, e.g. a PR number</label>
                    <input id="resolve-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)}
                      className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
                    <button type="button" disabled={busy} onClick={() => setStatus('resolved')}
                      className="rounded-lg bg-green-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                      {busy ? 'Saving…' : 'Mark resolved'}
                    </button>
                    <p className="text-xs text-gray-500">If it happens again it reopens by itself.</p>
                  </>
                ) : (
                  <button type="button" disabled={busy} onClick={() => setStatus('open')}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50">
                    {busy ? 'Saving…' : 'Reopen'}
                  </button>
                )}
              </div>
            )}

            <div>
              <h3 className="mb-2 font-semibold text-gray-900">Latest examples</h3>
              {(row.samples || []).length === 0 && <p className="text-gray-500">No examples kept.</p>}
              <ol className="space-y-3">
                {[...(row.samples || [])].reverse().map((s, i) => (
                  <li key={`${s.at}-${i}`} className="rounded-lg border border-gray-200 p-3">
                    <p className="font-medium text-gray-900">{formatDateTimeIST(s.at)}</p>
                    <p className="text-gray-600">
                      {[s.browser, s.os, s.device].filter(Boolean).join(' · ') || 'Unknown browser'}
                      {s.release ? ` · deploy ${s.release}` : ''}
                    </p>
                    <p className="font-mono text-xs text-gray-600">{s.url}</p>
                    <p className="mt-1 text-gray-700">
                      Customer: {s.user ? `${s.user.name || 'Signed-in customer'}${s.user.email ? ` (${s.user.email})` : ''}` : 'Not signed in'}
                      {s.orderId && (orderHref(s.orderId)
                        ? <> · Order <a className="text-blue-700 underline" href={orderHref(s.orderId)!}>{s.orderId.slice(-8)}</a></>
                        : <> · Order <span className="font-mono">{s.orderId}</span></>)}
                    </p>
                    {s.message && s.message !== row.message && <p className="mt-1 break-words text-gray-800">{s.message}</p>}
                    {s.context && Object.keys(s.context).length > 0 && (
                      <p className="mt-1 text-xs text-gray-600">
                        {Object.entries(s.context).map(([k, val]) => `${k}: ${val}`).join(' · ')}
                      </p>
                    )}
                    {s.stack && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-gray-500">Stack trace</summary>
                        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-700">{s.stack}</pre>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
