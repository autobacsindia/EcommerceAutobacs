'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import {
  isFestivalLive,
  isFestiveRoute,
  isStaffPanelRoute,
  msUntilNextBoundary,
  type PublicFestivalTheme,
} from '@/lib/festival/festivalTheme';
import { FESTIVAL_THEMES, getThemeTokens, type FestivalThemeTokens } from '@/lib/festival/themes';

interface FestivalState {
  theme: PublicFestivalTheme | null;
  tokens: FestivalThemeTokens | null;
  /** Inside its date window AND on a route that may be decorated. */
  live: boolean;
  /** Inside its date window AND on a route with a sparkle trail (festive routes + staff panels). */
  trailLive: boolean;
  /** Inside its date window, on ANY route (the cart and checkout name the offer too). */
  windowLive: boolean;
}

const FestivalContext = createContext<FestivalState>({ theme: null, tokens: null, live: false, trailLive: false, windowLive: false });

/** setTimeout's ceiling (~24.8 days); longer waits just re-arm. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Holds the festival switch for the whole storefront.
 *
 * `initialLive` comes from the server render so the first client render matches
 * the HTML (no hydration mismatch, and the toran's space is already in the SSR
 * markup). After mount it is re-checked on the visitor's clock and a timer flips
 * it at the start/end time — so a page cached before the end date still switches
 * itself off on time, with no deploy.
 */
export function FestivalThemeProvider({
  theme,
  initialLive,
  children,
}: {
  theme: PublicFestivalTheme | null;
  initialLive: boolean;
  children: ReactNode;
}) {
  const [live, setLive] = useState(initialLive);
  // Read once here rather than in every consumer: a badge on every product
  // tile then costs a context read, not a router subscription each.
  const pathname = usePathname();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      setLive(isFestivalLive(theme));
      const wait = msUntilNextBoundary(theme);
      if (wait !== null) timer = setTimeout(tick, Math.min(wait + 50, MAX_TIMER_MS));
    };
    tick();
    return () => clearTimeout(timer);
  }, [theme]);

  const tokens = getThemeTokens(theme?.themeKey);
  const active = live && !!tokens && isFestiveRoute(pathname);
  const trailActive = active || (live && !!tokens && isStaffPanelRoute(pathname));

  // Page-wide accents (rangoli behind headings) hang off <html data-festival>.
  // Set after hydration and purely decorative: it adds a background, never size.
  useEffect(() => {
    const root = document.documentElement;
    if (!active || !tokens) return;
    root.dataset.festival = tokens.key;
    root.dataset.festivalStyle = tokens.style;
    root.style.setProperty('--fx-primary', tokens.colors.primary);
    root.style.setProperty('--fx-accent', tokens.colors.accent);
    return () => {
      delete root.dataset.festival;
      delete root.dataset.festivalStyle;
      root.style.removeProperty('--fx-primary');
      root.style.removeProperty('--fx-accent');
    };
  }, [active, tokens]);

  return (
    <FestivalContext.Provider value={{ theme, tokens, live: active, trailLive: trailActive, windowLive: live && !!tokens }}>
      {children}
    </FestivalContext.Provider>
  );
}

/**
 * The active festival for THIS page, or null. Null on admin/team, sign-in and the
 * checkout/payment path, and whenever the theme is off or outside its window.
 */
export function useFestival(): { theme: PublicFestivalTheme; tokens: FestivalThemeTokens } | null {
  const { theme, tokens, live } = useContext(FestivalContext);
  if (!live || !theme || !tokens) return null;
  return { theme, tokens };
}

/**
 * How price lines name the extra festival price offer ("🪔 Diwali offer −3%",
 * "🏷️ Black Friday offer −3%"). Follows the festival in its date window on every
 * route — the cart and checkout too, where the decoration itself is off — and
 * falls back to the Diwali words when no theme is running (the offer has its own
 * switch and may outlast the decoration). Words only; never a number.
 */
export function useFestivalOfferLabel(): { icon: string; name: string; before: string } {
  const { tokens, windowLive } = useContext(FestivalContext);
  const t = windowLive && tokens ? tokens : FESTIVAL_THEMES.diwali;
  return { icon: t.icons.lamp, name: t.copy.offerName, before: t.copy.offerBefore };
}

/** The theme tokens if THIS page has a sparkle trail, or null. */
export function useFestivalTrail(): FestivalThemeTokens | null {
  const { tokens, trailLive } = useContext(FestivalContext);
  return trailLive ? tokens : null;
}
