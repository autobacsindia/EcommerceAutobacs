'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pin, PinOff } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { adminKeys, staffKeys } from '@/hooks/queries/keys';

/**
 * Pin / unpin an order to the top of MY order lists (like pinned chats).
 * Personal: nobody else's lists change. The server allows 5 pins and says so
 * when a sixth is tried. A pin moves an order in every list, so every order
 * list is refreshed afterwards.
 */
export default function PinButton({ orderId, pinned, className = '' }: { orderId: string; pinned: boolean; className?: string }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => (pinned
      ? apiClient.delete(`/staff/orders/${encodeURIComponent(orderId)}/pin`)
      : apiClient.post(`/staff/orders/${encodeURIComponent(orderId)}/pin`, {})),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: staffKeys.orders() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.resource('orders') }),
    ]),
    onError: (e) => window.alert(e instanceof Error && e.message ? e.message : 'Could not change the pin. Try again.'),
  });
  const label = pinned ? 'Unpin this order' : 'Pin this order to the top of my list';
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); toggle.mutate(); }}
      disabled={toggle.isPending}
      aria-pressed={pinned}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full disabled:opacity-50 ${
        pinned ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
      } ${className}`}
    >
      {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
    </button>
  );
}
