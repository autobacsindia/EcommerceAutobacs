'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Package, ChevronRight } from 'lucide-react';
import orderService from '@/lib/services/orderService';
import { profileKeys } from '@/hooks/queries/keys';
import { getOrderStatusBadgeClass, getOrderStatusLabel } from '@/lib/orderStatus';

/**
 * Recent orders summary for the profile dashboard. Reads via TanStack Query so
 * the list is cached across navigations — revisiting /profile shows it instantly
 * instead of re-fetching + flashing empty on every visit.
 */
export default function RecentOrdersCard() {
  const { data: orders } = useQuery({
    queryKey: profileKeys.recentOrders(),
    queryFn: () => orderService.getUserOrders(1, 4).then((res) => res.orders || []),
  });

  // Hide while the FIRST load resolves; on revisits the cached list renders at
  // once (no null flash). A failed fetch resolves via the shared retry policy.
  if (orders === undefined) return null;

  return (
    <div className="bg-obsidian border border-hairline rounded-lg p-6 mb-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-gold" />
          <h2 className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest">
            Recent Orders
          </h2>
        </div>
        {orders.length > 0 && (
          <Link
            href="/orders"
            className="text-xs font-display text-gold hover:text-gold/80 inline-flex items-center gap-1"
          >
            View all <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </div>

      {orders.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-ink-muted font-display mb-4">You haven&apos;t placed any orders yet.</p>
          <Link
            href="/products"
            className="inline-block bg-gold text-obsidian px-5 py-2.5 rounded-sm text-sm font-display font-bold hover:bg-gold/90 transition"
          >
            Start shopping
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-hairline">
          {orders.map((order) => (
            <li key={order._id}>
              <Link
                href={`/orders/${order._id}`}
                className="flex items-center justify-between gap-4 py-3 hover:bg-obsidian-raised/40 -mx-2 px-2 rounded transition"
              >
                <div className="min-w-0">
                  <p className="text-sm font-display text-ink truncate">
                    #{order.orderNumber || order._id.slice(-8).toUpperCase()}
                  </p>
                  <p className="text-xs text-ink-muted font-display mt-0.5">
                    {new Date(order.createdAt).toLocaleDateString('en-IN', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                    {' · '}
                    ₹{Number(order.totalAmount || 0).toLocaleString('en-IN')}
                  </p>
                </div>
                <span
                  className={`shrink-0 px-3 py-1 rounded-full text-[10px] font-display font-bold uppercase tracking-widest ${getOrderStatusBadgeClass(
                    order.status
                  )}`}
                >
                  {getOrderStatusLabel(order.status)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
