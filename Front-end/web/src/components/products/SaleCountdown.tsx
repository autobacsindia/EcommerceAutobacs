'use client';

import { useEffect, useState } from 'react';

/**
 * Ticking clock for a time-boxed product sale.
 *
 * `live` is true only while `saleEndsAt` is in the future. The instant it
 * passes, `live` flips to false and the interval stops — callers gate both the
 * slashed price AND the countdown on `live`, so the sale UI disappears in sync
 * without a refetch. The backend (pricingService) is already authoritative for
 * what is actually charged; this is display-only.
 */
export function useSaleCountdown(saleEndsAt?: string | null) {
  const endMs = saleEndsAt ? new Date(saleEndsAt).getTime() : NaN;
  const valid = Number.isFinite(endMs);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!valid || endMs <= Date.now()) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= endMs) clearInterval(id); // stop ticking once the sale ends
    }, 1000);
    return () => clearInterval(id);
  }, [endMs, valid]);

  const remaining = valid ? endMs - now : 0;
  return { live: valid && remaining > 0, remaining };
}

const pad = (n: number) => String(n).padStart(2, '0');

interface SaleCountdownProps {
  saleEndsAt?: string | null;
  className?: string;
}

/**
 * "Sale ends in 02d 04h 11m 09s" — renders nothing once the sale is over.
 */
export default function SaleCountdown({ saleEndsAt, className = '' }: SaleCountdownProps) {
  const { live, remaining } = useSaleCountdown(saleEndsAt);
  if (!live) return null;

  const totalSec = Math.floor(remaining / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  return (
    <div
      role="timer"
      aria-live="off"
      className={`inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/15 px-3 py-1 text-sm font-semibold text-orange-400 ${className}`}
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-500" />
      </span>
      <span>
        Sale ends in{' '}
        <span className="tabular-nums">
          {days > 0 && `${days}d `}
          {pad(hours)}h {pad(minutes)}m {pad(seconds)}s
        </span>
      </span>
    </div>
  );
}
