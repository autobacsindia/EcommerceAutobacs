'use client';

import { useEffect, useMemo, useState } from 'react';
import { alreadyPlayed, momentCopy, momentDayShort, momentSignature, rememberPlayed, type OrderMomentData } from './orderMomentCopy';
import { sceneMarkup } from './orderMomentScenes';

/**
 * The picture + words at the top of an order ("order moments", owner-approved
 * 2026-11-26). Which moment it is comes from the server (`order.moment`); this
 * component only draws and words it — it never moves an order forward by itself.
 *
 *   • plays once per new update per browser; a repeat visit shows the still picture
 *   • prefers-reduced-motion → still picture (CSS in app/globals.css)
 *   • the words are real text (announced); the drawing is decoration (aria-hidden)
 *   • the scene box has a fixed 16:9 shape, so nothing jumps when it renders
 */
export default function OrderMoment({
  orderId,
  moment,
  shipped = false,
  replayable = false,
  className = '',
}: {
  orderId: string;
  moment: OrderMomentData;
  /** At least one parcel is with the courier (from the order's `progress`). */
  shipped?: boolean;
  /**
   * Always play, never read the play-once memory. For server-rendered pages (order
   * success): reading storage during hydration would mismatch the server's markup.
   */
  replayable?: boolean;
  className?: string;
}) {
  const signature = momentSignature(moment);
  // Decided on mount, before paint. On the order page this component only renders
  // once the order has loaded in the browser, so reading storage cannot mismatch a
  // server render; server-rendered pages pass `replayable` and skip the read.
  const [still] = useState(() => !replayable && typeof window !== 'undefined' && alreadyPlayed(orderId, signature));

  useEffect(() => {
    rememberPlayed(orderId, signature);
  }, [orderId, signature]);

  const copy = momentCopy(moment, { shipped });
  const svg = useMemo(
    () => sceneMarkup(moment.key, { lateDay: momentDayShort(moment.late?.dueDay), newDay: momentDayShort(moment.newDay) }),
    [moment.key, moment.late?.dueDay, moment.newDay],
  );

  const chipClass = copy.tone === 'care'
    ? 'bg-gold/15 text-[#8a5200]'
    : copy.tone === 'calm'
      ? 'bg-obsidian-deep text-ink-muted'
      : 'bg-[#3B9EE8]/12 text-[#1A6FB5]';

  return (
    <section
      aria-label="Order update"
      data-testid="order-moment"
      data-moment={moment.key}
      className={`overflow-hidden rounded-xl border border-hairline bg-obsidian-raised grid grid-cols-1 sm:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] sm:items-center ${className}`}
    >
      <div className={`om-scene aspect-[16/9] w-full bg-[#f5f7f6]${still ? ' om-still' : ''}`} aria-hidden="true" data-still={still ? 'true' : 'false'}>
        <svg
          viewBox="0 0 320 180"
          preserveAspectRatio="xMidYMid meet"
          className="block h-full w-full"
          focusable="false"
          // Built only from constants in orderMomentScenes.ts (the one date is validated and escaped).
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-2 p-4 sm:p-6" role="status">
        <span className={`self-start rounded-full px-2.5 py-0.5 font-display text-[11px] font-semibold uppercase tracking-[0.08em] ${chipClass}`}>
          {copy.chip}
        </span>
        <h2 className="font-display text-xl font-bold leading-tight text-ink sm:text-2xl" data-testid="order-moment-title">{copy.title}</h2>
        <p className="font-display text-sm text-ink-muted" data-testid="order-moment-body">{copy.body}</p>
        {copy.note && (
          <p className="rounded-lg border-l-2 border-[#EF9F27] bg-obsidian-deep px-3 py-2 font-display text-sm text-ink" data-testid="order-moment-note">
            <span className="text-ink-muted">Update from our team: </span>{copy.note}
          </p>
        )}
        {copy.updated && <p className="font-display text-xs text-ink-muted" data-testid="order-moment-updated">{copy.updated}</p>}
        {copy.steps && (
          <ol className="mt-1 flex flex-wrap gap-1.5" aria-label="Return steps">
            {copy.steps.labels.map((label, i) => {
              const at = copy.steps!.at;
              const state = i < at ? 'done' : i === at ? 'now' : 'todo';
              return (
                <li
                  key={label}
                  data-state={state}
                  aria-current={state === 'now' ? 'step' : undefined}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-display ${
                    state === 'now' ? 'border-[#3B9EE8] bg-[#3B9EE8]/10 text-[#1A6FB5] font-semibold'
                      : state === 'done' ? 'border-hairline bg-obsidian-deep text-ink' : 'border-hairline text-ink-muted'
                  }`}
                >
                  {label}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
