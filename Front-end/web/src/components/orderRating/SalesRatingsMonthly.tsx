'use client';

/**
 * Panel, read only: each salesperson's customer rating for one India-time month
 * (by the day the rating was first given). Admins see everyone; a team head sees
 * their own team. The incentive engine applies its own rules (e.g. a minimum
 * number of ratings) — this screen just shows the numbers.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import apiClient from '@/lib/api';
import { orderRatingKeys } from '@/hooks/queries/keys';

interface Row {
  salesperson: { id: string; name: string; team: string };
  count: number;
  average: number;
  low: number;
  flagged: number;
}

/** 'YYYY-MM' for the current month in India. */
export function currentIstMonth(now = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default function SalesRatingsMonthly() {
  const [month, setMonth] = useState(currentIstMonth);
  const q = useQuery({
    queryKey: orderRatingKeys.monthly(month),
    queryFn: () => apiClient.get<{ month: string; rows: Row[] }>(`/order-ratings/panel/monthly?month=${encodeURIComponent(month)}`),
    enabled: /^\d{4}-\d{2}$/.test(month),
  });

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Service ratings</h1>
        <p className="mt-1 text-sm text-gray-600">
          How customers rated our team after delivery, per salesperson. Ratings can be changed for 7 days, then they are locked. “To check” = rated from the same internet connection the salesperson made the WhatsApp link on.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        Month
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
      </label>

      {q.isPending ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : q.isError ? (
        <p role="alert" className="text-sm text-red-600">{q.error instanceof Error ? q.error.message : 'Could not load ratings.'}</p>
      ) : q.data.rows.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500">No ratings this month yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Salesperson</th>
                <th className="px-4 py-2.5 font-medium">Average</th>
                <th className="px-4 py-2.5 font-medium">Ratings</th>
                <th className="px-4 py-2.5 font-medium">1–2 stars</th>
                <th className="px-4 py-2.5 font-medium" title="Rated from the same internet connection the salesperson made the link on">To check</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {q.data.rows.map((r) => (
                <tr key={r.salesperson.id}>
                  <td className="px-4 py-2.5 font-medium text-gray-900">{r.salesperson.name}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1">
                      <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden />
                      {r.average.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">{r.count}</td>
                  <td className="px-4 py-2.5 text-gray-700">{r.low}</td>
                  <td className={`px-4 py-2.5 ${r.flagged ? 'font-medium text-amber-700' : 'text-gray-700'}`}>{r.flagged}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
