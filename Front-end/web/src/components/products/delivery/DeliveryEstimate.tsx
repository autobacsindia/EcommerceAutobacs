'use client';

import { useEffect, useState } from 'react';
import { Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { windowDates, windowDays, type DeliveryWindow } from '@/lib/deliveryWindow';

/**
 * The delivery estimate line. The space is ALWAYS reserved (fixed height), whether the
 * estimate has loaded, failed, or the product can't be ordered — so nothing below it
 * moves when it arrives (CLS).
 *
 *  - `card`: "7–10 days delivery" — compact, one line.
 *  - `page`: "Delivered by Wed 2 Dec – Sat 5 Dec" + "7–10 days". Dates are computed in
 *    the browser after mount (the page HTML is cached, so a server-rendered date could
 *    be days old); before that it shows the day count, same height.
 */
export default function DeliveryEstimate({
  window: w,
  variant = 'card',
  className,
}: {
  window: DeliveryWindow | null | undefined;
  variant?: 'card' | 'page';
  className?: string;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { if (variant === 'page') setNow(Date.now()); }, [variant]);

  if (variant === 'card') {
    return (
      <p
        className={cn('flex h-4 items-center gap-1 truncate text-[11px] leading-4 text-ink-muted', className)}
        data-testid="delivery-estimate"
      >
        {w && (
          <>
            <Truck className="h-3 w-3 shrink-0 text-gold" aria-hidden />
            <span className="truncate">{windowDays(w)} delivery</span>
          </>
        )}
      </p>
    );
  }

  return (
    <div
      className={cn('flex h-10 items-start gap-2 text-[13px] leading-5', className)}
      data-testid="delivery-estimate"
    >
      {w && (
        <>
          <Truck className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">
              {now != null ? `Delivered by ${windowDates(w, now)}` : `Delivered in ${windowDays(w)}`}
            </p>
            <p className="truncate text-ink-muted">
              {w.heavy ? `Heavy item · ${windowDays(w)}` : windowDays(w)} · we keep you updated throughout
            </p>
          </div>
        </>
      )}
    </div>
  );
}
