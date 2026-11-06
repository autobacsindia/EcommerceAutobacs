/**
 * Festival theme tokens — the ONE place a festival's look and words live.
 *
 * The backend stores only which theme is switched on and its date window
 * (Back-end/server/config/festivalThemes.js keeps the allowed keys in step with
 * this file). Christmas, Onam, Holi … = add an entry here and its key there;
 * every component reads from the theme, never from hard-coded Diwali copy.
 */

export interface FestivalThemeTokens {
  key: string;
  name: string;
  colors: {
    /** Strip / badge background. */
    primary: string;
    /** Text on `primary`. */
    onPrimary: string;
    /** Highlight (marigold, gold). */
    accent: string;
    /** Glow behind the flying icon. */
    glow: string;
  };
  /** Particle colours for sparks and fireworks. */
  particles: string[];
  icons: {
    /** Flies to the cart; sits in badges and copy. */
    lamp: string;
    /** Repeats along the toran strip. */
    garland: string[];
  };
  copy: {
    dealBadge: string;
    orderConfirmed: string;
    /** Followed by the live countdown, e.g. "Diwali offers end in 04:10:03". */
    countdownLabel: string;
  };
}

export const FESTIVAL_THEMES: Record<string, FestivalThemeTokens> = {
  diwali: {
    key: 'diwali',
    name: 'Diwali',
    colors: {
      primary: '#7a1f0f',
      onPrimary: '#fff6dc',
      accent: '#f5a524',
      glow: 'rgba(255, 190, 60, 0.85)',
    },
    particles: ['#ffd166', '#f5a524', '#ff7b00', '#ff4d6d', '#fff3b0', '#ffe066'],
    icons: {
      lamp: '🪔',
      garland: ['🌼', '🪔', '🌼', '✨'],
    },
    copy: {
      dealBadge: 'Diwali Deal',
      orderConfirmed: 'Happy Diwali! Your order is confirmed 🪔',
      countdownLabel: 'Diwali offers end in',
    },
  },
};

export function getThemeTokens(themeKey: string | null | undefined): FestivalThemeTokens | null {
  if (!themeKey) return null;
  return FESTIVAL_THEMES[themeKey] ?? null;
}
