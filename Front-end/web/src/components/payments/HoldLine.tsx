import { PauseCircle } from 'lucide-react';
import { formatDateIST } from '@/lib/datetime';
import type { PaymentHold } from './api';

const ROLE = (role: string) => (role === 'admin' ? 'Admin' : role ? 'Accounts' : '');

/** "Held by Meera (Accounts) on 20 Nov" — or '' when the record does not say. */
export function heldByText(hold: PaymentHold): string {
  if (!hold.byName && !hold.at) return '';
  const who = hold.byName ? `${hold.byName}${ROLE(hold.role) ? ` (${ROLE(hold.role)})` : ''}` : '';
  return ['Held', who && `by ${who}`, hold.at && `on ${formatDateIST(hold.at)}`].filter(Boolean).join(' ');
}

/**
 * A held payment, the same on every list: why it is on hold, and who held it and
 * when. Every view reads it from the request itself (`hold`), so it shows
 * wherever the payment is listed and disappears everywhere once it moves on.
 */
export default function HoldLine({ hold, className = '' }: { hold: PaymentHold | null | undefined; className?: string }) {
  if (!hold) return null;
  const by = heldByText(hold);
  return (
    <span role="note" aria-label="On hold" className={`flex items-start gap-1 text-xs text-orange-800 ${className}`}>
      <PauseCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <strong>On hold</strong>{hold.note ? `: ${hold.note}` : ''}
        {by && <span className="block text-orange-700/80">{by}</span>}
      </span>
    </span>
  );
}
