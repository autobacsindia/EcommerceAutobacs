'use client';

import { useEffect, useState } from 'react';
import { useFestival } from './FestivalThemeContext';
import { festivalVars } from './festivalStyle';

/** "HH:MM:SS", with a day prefix past 24 hours ("2d 04:10:03"). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d > 0 ? `${d}d ` : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * "Diwali offers end in HH:MM:SS", counting to the admin's end date.
 *
 * The time is filled in after mount (the server can't know the visitor's clock,
 * and rendering it on the server would mismatch on hydration). The strip's
 * height is fixed in CSS, so the late text never moves the page.
 */
export default function FestivalCountdown() {
  const festival = useFestival();
  const endsAt = festival?.theme.endsAt ? Date.parse(festival.theme.endsAt) : NaN;
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (Number.isNaN(endsAt)) return;
    const tick = () => setLeft(endsAt - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  if (!festival || Number.isNaN(endsAt)) return null;
  return (
    <div className="fx-countdown" style={festivalVars(festival.tokens)} role="timer" aria-live="off" data-testid="festival-countdown">
      <span aria-hidden="true">{festival.tokens.icons.lamp}</span>
      <span>{festival.tokens.copy.countdownLabel}</span>
      <span className="fx-countdown-time">{left === null ? '--:--:--' : formatCountdown(left)}</span>
    </div>
  );
}
