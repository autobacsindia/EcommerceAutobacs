'use client';

// Recharts wrappers. This module is loaded lazily (next/dynamic, ssr:false) from the
// analytics page so recharts stays out of the initial admin bundle.
import React from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { CHART_COLORS } from './primitives';

type MoneyFmt = (n: number) => string;

const shortDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const compact = (n: number) => {
  if (Math.abs(n) >= 1_00_000) return `${(n / 1_00_000).toFixed(1)}L`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

/** Revenue (area, left axis) + orders (line, right axis) over time. */
export function RevenueTrendChart({
  data,
  formatMoney,
}: {
  data: { bucket: string; revenue: number; orders: number }[];
  formatMoney: MoneyFmt;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="bucket" tickFormatter={shortDate} fontSize={12} />
        <YAxis yAxisId="left" tickFormatter={compact} fontSize={12} width={48} />
        <YAxis yAxisId="right" orientation="right" allowDecimals={false} fontSize={12} width={32} />
        <Tooltip
          labelFormatter={shortDate}
          formatter={(value: number, name: string) =>
            name === 'Revenue' ? [formatMoney(value), name] : [value, name]
          }
        />
        <Legend />
        <Area
          yAxisId="left"
          type="monotone"
          dataKey="revenue"
          name="Revenue"
          stroke={CHART_COLORS[0]}
          fill={CHART_COLORS[0]}
          fillOpacity={0.15}
        />
        <Line yAxisId="right" type="monotone" dataKey="orders" name="Orders" stroke={CHART_COLORS[1]} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bar of a money/units value per labelled category (top-N breakdowns). */
export function HorizontalBarChart({
  data,
  labelKey,
  valueKey,
  formatValue,
  color = CHART_COLORS[0],
}: {
  data: any[];
  labelKey: string;
  valueKey: string;
  formatValue?: MoneyFmt;
  color?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 34 + 24)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tickFormatter={compact} fontSize={12} />
        <YAxis type="category" dataKey={labelKey} width={120} fontSize={12} />
        <Tooltip formatter={(value: number) => (formatValue ? formatValue(value) : value)} />
        <Bar dataKey={valueKey} fill={color} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Vertical bar (cohorts, state counts). */
export function VerticalBarChart({
  data,
  labelKey,
  valueKey,
  tickAsDate = false,
  color = CHART_COLORS[3],
}: {
  data: any[];
  labelKey: string;
  valueKey: string;
  tickAsDate?: boolean;
  color?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={labelKey} tickFormatter={tickAsDate ? (v) => shortDate(String(v)) : undefined} fontSize={12} />
        <YAxis allowDecimals={false} fontSize={12} width={40} />
        <Tooltip labelFormatter={tickAsDate ? (v) => shortDate(String(v)) : undefined} />
        <Bar dataKey={valueKey} fill={color} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Donut for a small set of named slices (payment methods, return reasons, stock mix). */
export function DonutChart({
  data,
  nameKey,
  valueKey,
  formatValue,
}: {
  data: any[];
  nameKey: string;
  valueKey: string;
  formatValue?: MoneyFmt;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={90}
          paddingAngle={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value: number) => (formatValue ? formatValue(value) : value)} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
