'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, Clock3, Lock, Loader2, SearchX, Inbox } from 'lucide-react';
import { describeHrError, type HrErrorKind } from '@/lib/hr/errors';

const ICONS: Record<HrErrorKind, typeof AlertTriangle> = {
  signin: Lock, forbidden: Lock, notFound: SearchX, comingSoon: Clock3, conflict: AlertTriangle, invalid: AlertTriangle, other: AlertTriangle,
};

/** One friendly box for any HR API failure (403, 404, not-built-yet, network). */
export function HrErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const view = describeHrError(error);
  const Icon = ICONS[view.kind];
  const calm = view.kind === 'comingSoon';
  return (
    <div
      role={calm ? 'status' : 'alert'}
      data-kind={view.kind}
      className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${calm ? 'border-sky-200 bg-sky-50 text-sky-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{view.title}</p>
        <p className="mt-0.5">{view.message}</p>
        {onRetry && (view.kind === 'other' || view.kind === 'conflict') && (
          <button type="button" onClick={onRetry} className="mt-2 rounded-lg border border-current px-3 py-1 text-xs font-semibold">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function HrEmpty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-600">
      <Inbox className="mx-auto mb-2 h-6 w-6 text-gray-400" aria-hidden="true" />
      <p className="font-semibold text-gray-800">{title}</p>
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}

export function HrLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="flex items-center gap-2 p-4 text-sm text-gray-500">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {label}
    </p>
  );
}

/** Keyset "load more": shown only while the server says there is a next page. */
export function HrLoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center p-3">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
      >
        {loading ? 'Loading…' : 'Load more'}
      </button>
    </div>
  );
}

/** Page title row: heading on the left, actions on the right. */
export function HrPageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-gray-900 md:text-2xl">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-gray-500">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export const hrCard = 'rounded-xl border border-gray-200 bg-white';
export const hrTable = 'w-full min-w-[640px] text-left text-sm';
export const hrTh = 'border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500';
export const hrTd = 'border-b border-gray-100 px-3 py-2.5 align-middle text-gray-800';
export const hrBtn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60';
export const hrBtnPrimary = `${hrBtn} bg-emerald-700 text-white hover:bg-emerald-800`;
export const hrBtnGhost = `${hrBtn} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`;
export const hrBtnDanger = `${hrBtn} border border-red-300 bg-white text-red-700 hover:bg-red-50`;
export const hrInput = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100';
