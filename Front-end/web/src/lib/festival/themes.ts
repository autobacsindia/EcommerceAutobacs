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
  /**
   * Words for the festive home page (components/home/store/FestiveHome.tsx).
   * Every number on that page comes from the live catalogue; only words live here.
   */
  home: {
    /** Gold pill at the front of the green department bar; links to /offers. */
    navLabel: string;
    heroEyebrow: string;
    /** Headline, split so the middle part takes the gold accent. */
    heroTitle: [before: string, accent: string, after: string];
    heroSubtitle: string;
    heroCta: string;
    dealsTitle: string;
    dealsSubtitle: string;
    giftTitle: string;
    giftSubtitle: string;
    /** Titles for the gift budget bands, cheapest first. */
    giftTiers: [string, string, string];
    wishTitle: string;
    wishSubtitle: string;
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
    home: {
      navLabel: 'Diwali Sale',
      heroEyebrow: 'The Diwali Sale',
      heroTitle: ['Light up ', 'every drive', ' this Diwali'],
      heroSubtitle:
        'Festive prices on suspension, body kits, lighting and interiors — shop by your car and see only what fits. Upgrade your own, or gift one to someone you love.',
      heroCta: 'Shop Diwali Deals',
      dealsTitle: 'Diwali Deals',
      dealsSubtitle: 'The biggest festive savings — M.R.P. shown on every deal',
      giftTitle: 'Gift for your car this Diwali',
      giftSubtitle: 'Thoughtful upgrades at every budget, for your own car or someone special',
      giftTiers: ['Little sparkles', 'Festive upgrades', 'The grand gift'],
      wishTitle: 'Happy Diwali from Team Autobacs',
      wishSubtitle: 'May your roads be bright and every drive be safe.',
    },
  },
};

export function getThemeTokens(themeKey: string | null | undefined): FestivalThemeTokens | null {
  if (!themeKey) return null;
  return FESTIVAL_THEMES[themeKey] ?? null;
}
