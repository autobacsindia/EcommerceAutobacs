'use client';

import React from 'react';

// Small presentational primitives shared across the analytics sections. Kept free of any
// charting import so they stay in the initial bundle while recharts is lazy-loaded.

export function SectionCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-start justify-between mb-4 gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  deltaPct,
  invertDelta = false,
}: {
  label: string;
  value: string;
  deltaPct?: number | null;
  /** When true, a negative delta is "good" (e.g. return rate) and shown green. */
  invertDelta?: boolean;
}) {
  return (
    <div className="bg-white rounded-lg shadow p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      <DeltaBadge deltaPct={deltaPct} invert={invertDelta} />
    </div>
  );
}

export function DeltaBadge({ deltaPct, invert = false }: { deltaPct?: number | null; invert?: boolean }) {
  if (deltaPct === null || deltaPct === undefined) {
    return <p className="text-xs text-gray-400 mt-1">no prior data</p>;
  }
  const positive = invert ? deltaPct < 0 : deltaPct > 0;
  const neutral = deltaPct === 0;
  const color = neutral ? 'text-gray-500' : positive ? 'text-green-600' : 'text-red-600';
  const arrow = neutral ? '→' : deltaPct > 0 ? '▲' : '▼';
  return (
    <p className={`text-xs mt-1 font-medium ${color}`}>
      {arrow} {Math.abs(deltaPct)}% vs previous period
    </p>
  );
}

export function EmptyState({ message = 'No data for this period' }: { message?: string }) {
  return (
    <div className="flex items-center justify-center h-48 text-sm text-gray-400 border border-dashed border-gray-200 rounded">
      {message}
    </div>
  );
}

export function ChartSkeleton({ height = 256 }: { height?: number }) {
  return (
    <div className="animate-pulse bg-gray-100 rounded" style={{ height }} aria-hidden="true" />
  );
}

// Stable, colour-blind-friendly palette for category/brand/donut slices.
export const CHART_COLORS = [
  '#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0891b2',
  '#db2777', '#ca8a04', '#4f46e5', '#059669', '#dc2626',
];

export function SimpleTable<T>({
  columns,
  rows,
  emptyMessage,
}: {
  columns: { key: keyof T; label: string; align?: 'left' | 'right'; render?: (row: T) => React.ReactNode }[];
  rows: T[];
  emptyMessage?: string;
}) {
  if (!rows.length) return <EmptyState message={emptyMessage} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b">
            {columns.map((c) => (
              <th key={String(c.key)} className={`pb-2 font-medium ${c.align === 'right' ? 'text-right' : ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
              {columns.map((c) => (
                <td key={String(c.key)} className={`py-2 ${c.align === 'right' ? 'text-right' : ''}`}>
                  {c.render ? c.render(row) : String(row[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
