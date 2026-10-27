import { formatDateTimeIST } from '@/lib/datetime';

/** Courier progress the operations team recorded on a parcel (Order.shipments[].trackingSteps). */
export type ParcelStep = { status: string; note?: string; at: string };

/** How the customer reads each step. "Delivered" is not a step — the parcel's own status says it. */
const CUSTOMER_COPY: Record<string, string> = {
  picked_up: 'Picked up by the courier',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivery_failed: 'Delivery attempt missed — the courier will try again',
};

/**
 * Customer — where a parcel in transit has got to, newest first. Renders nothing
 * until operations has recorded a step, so a parcel without updates looks exactly
 * as it always did.
 */
export default function ParcelSteps({ steps }: { steps?: ParcelStep[] }) {
  if (!steps?.length) return null;
  const newestFirst = [...steps].reverse();
  return (
    <ol className="mt-3 space-y-1.5 border-l border-hairline pl-3" aria-label="Parcel updates">
      {newestFirst.map((s, i) => (
        <li key={`${s.at}-${i}`} className={`text-xs ${i === 0 ? 'text-ink' : 'text-ink-muted'}`}>
          <span className="font-display font-semibold">{CUSTOMER_COPY[s.status] || s.status}</span>
          {s.note && <span> · {s.note}</span>}
          <span className="block text-[11px] text-ink-muted">{formatDateTimeIST(s.at)}</span>
        </li>
      ))}
    </ol>
  );
}
