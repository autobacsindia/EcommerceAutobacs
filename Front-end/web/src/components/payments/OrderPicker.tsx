'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, X } from 'lucide-react';
import { formatDateIST } from '@/lib/datetime';
import { errorMessage, lookupOrders, paymentKeys, rupees, type OrderMatch } from './api';

const input = 'w-full rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

/** The typed text, once typing pauses — one search per pause, not per key. */
function useSettled(value: string, ms = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/**
 * Find a paid order to link an expense to: by its number (#DD97FE16), the
 * customer's name or phone. The server searches (bounded, newest first) and
 * returns only the number, customer, total and date.
 */
export default function OrderPicker({ picked, onPick, id = 'order-picker', autoFocus = false }: {
  picked: OrderMatch | null;
  onPick: (o: OrderMatch | null) => void;
  id?: string;
  /** Opened by a button ("Link to order"): put the cursor in the box. */
  autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const q = useSettled(text.trim());
  const search = useQuery({
    queryKey: paymentKeys.orderLookup(q),
    queryFn: () => lookupOrders(q),
    enabled: q.length >= 2 && !picked,
    staleTime: 30 * 1000,
  });

  if (picked) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
        <span className="font-semibold text-gray-900">{picked.number}</span>
        <span className="text-gray-700">{picked.customer}</span>
        <button type="button" onClick={() => { onPick(null); setText(''); }} aria-label="Remove the order"
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline">
          <X className="h-3.5 w-3.5" /> Change
        </button>
      </div>
    );
  }

  const orders = search.data?.orders ?? [];
  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
        <input id={id} className={input} autoFocus={autoFocus} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off"
          placeholder="Order number, customer name or phone" aria-describedby={`${id}-hint`} />
      </div>
      <p id={`${id}-hint`} className="sr-only">Type at least 2 characters to search paid orders.</p>
      {q.length >= 2 && (
        <div className="mt-1 rounded-lg border border-gray-200 bg-white text-sm" role="listbox" aria-label="Matching orders">
          {search.isFetching && !orders.length ? (
            <p className="flex items-center gap-2 px-3 py-2 text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</p>
          ) : search.isError ? (
            <p role="alert" className="px-3 py-2 text-red-700">{errorMessage(search.error, 'Could not search orders.')}</p>
          ) : orders.length === 0 ? (
            <p className="px-3 py-2 text-gray-500">No paid order matches “{q}”.</p>
          ) : orders.map((o) => (
            <button key={o.id} type="button" role="option" aria-selected={false} onClick={() => onPick(o)}
              className="flex w-full flex-wrap items-center gap-x-2 border-b border-gray-100 px-3 py-2 text-left last:border-0 hover:bg-blue-50">
              <span className="font-semibold text-gray-900">{o.number}</span>
              <span className="text-gray-700">{o.customer || 'Customer'}</span>
              <span className="ml-auto text-xs text-gray-500">
                {o.total != null ? `${rupees(o.total)} · ` : ''}{formatDateIST(o.createdAt)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
