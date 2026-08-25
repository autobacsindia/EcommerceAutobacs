'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatDateTimeIST } from '@/lib/datetime';
import type { SpinWinner } from '@/types/spin';

/**
 * Admin — goodies that still need putting in a parcel.
 *
 * This screen is the actual answer to "make sure the team doesn't miss it". A banner on
 * an order can be scrolled past; a queue that never empties on its own cannot. Everything
 * else (the chip on the orders list, the banner on the order) is a convenience — this is
 * the backstop.
 *
 * Only PHYSICAL, GRANTED, UNPACKED rewards appear. Coupons and karma need no human, and a
 * voided reward (order cancelled or refunded) is explicitly a do-not-pack.
 */
export default function SpinWinnersPage() {
  const [winners, setWinners] = useState<SpinWinner[]>([]);
  const [unfulfilledCount, setUnfulfilledCount] = useState(0);
  const [showPacked, setShowPacked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{
        success: boolean; winners: SpinWinner[]; unfulfilledCount: number;
      }>(`${API_ENDPOINTS.SPIN_WINNERS}?fulfilled=${showPacked}`);
      setWinners(res.winners ?? []);
      setUnfulfilledCount(res.unfulfilledCount ?? 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load winners');
    } finally {
      setLoading(false);
    }
  }, [showPacked]);

  useEffect(() => { void load(); }, [load]);

  const markPacked = async (w: SpinWinner) => {
    setBusyId(w._id);
    setError(null);
    try {
      await apiClient.patch(API_ENDPOINTS.SPIN_WINNER_FULFIL(w._id), {});
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to mark packed');
    } finally {
      setBusyId(null);
    }
  };

  const orderOf = (w: SpinWinner) => (typeof w.order === 'string' ? null : w.order);

  return (
    <div className="p-6">
      <Link href="/admin/spin" className="text-sm text-blue-600 hover:underline">← Campaigns</Link>

      <div className="mt-2 mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">🎁 Goodies to pack</h1>
          <p className="mt-1 text-sm text-gray-600">
            Every physical prize a customer won that hasn&apos;t been put in a parcel yet.
          </p>
        </div>
        {unfulfilledCount > 0 && (
          <div className="rounded-xl bg-amber-100 px-5 py-3 text-center">
            <div className="text-3xl font-bold text-amber-900">{unfulfilledCount}</div>
            <div className="text-xs font-medium text-amber-800">waiting to be packed</div>
          </div>
        )}
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="mb-4 flex gap-2">
        <button onClick={() => setShowPacked(false)}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${!showPacked ? 'bg-blue-600 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}>
          To pack {unfulfilledCount > 0 && `(${unfulfilledCount})`}
        </button>
        <button onClick={() => setShowPacked(true)}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${showPacked ? 'bg-blue-600 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}>
          Already packed
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-3">Goodie</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Won</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500">Loading…</td></tr>}
            {!loading && winners.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                {showPacked ? 'Nothing packed yet.' : '🎉 Nothing waiting — every goodie has been packed.'}
              </td></tr>
            )}
            {winners.map((w) => {
              const order = orderOf(w);
              const orderId = typeof w.order === 'string' ? w.order : w.order._id;
              return (
                <tr key={w._id} className="border-t border-gray-100">
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900">{w.prizeSnapshot.name}</span>
                  </td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-800">
                      {w.prizeSnapshot.sku || '—'}
                    </code>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/orders/${orderId}`} className="text-blue-600 hover:underline">
                      #{orderId.slice(-8)}
                    </Link>
                    {order?.status && <div className="text-xs text-gray-500">{order.status}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {order?.shippingAddress?.fullName || '—'}
                    {order?.shippingAddress?.city && (
                      <div className="text-xs text-gray-500">{order.shippingAddress.city}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{formatDateTimeIST(w.spunAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {w.fulfilledAt ? (
                      <span className="text-xs text-green-700">✓ packed {formatDateTimeIST(w.fulfilledAt)}</span>
                    ) : (
                      <button onClick={() => markPacked(w)} disabled={busyId === w._id}
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">
                        {busyId === w._id ? 'Saving…' : '✓ Mark packed'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
