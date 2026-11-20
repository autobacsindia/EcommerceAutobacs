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
  /**
   * Which artwork set draws the decoration. 'diwali' = toran, lanterns and diyas;
   * 'neon' = the Black Friday night stage (neon ticker strip, red light beams,
   * neon price tag). Colours and words still come from the tokens below.
   */
  style: 'diwali' | 'neon';
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
    /** Name of the extra price offer on price lines, e.g. "Diwali offer −3%". */
    offerName: string;
    /** Label for the price before the offer, e.g. "Before Diwali ₹1,12,500". */
    offerBefore: string;
  };
  /**
   * Words for the neon ticker strip at the top of every storefront page
   * (style 'neon' only). Repeated across the strip.
   */
  ticker?: string[];
  /**
   * The round "Without shipping, packing, delivery charges" seal. Only themes
   * whose event really waives those charges at checkout may set this — it is a
   * promise about money, so it must match what the checkout charges.
   */
  freeDeliverySeal?: { top: string; middle: string; bottom: string };
  /**
   * The perks carousel along the top of the hero, shown only while checkout
   * really waives the delivery fees (same server check as the seal). Each item
   * names a real fee line from checkout (Back-end/server/utils/deliveryFees.js),
   * so the carousel never promises a saving checkout does not give.
   */
  perks?: { strong: string; text: string }[];
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
    style: 'diwali',
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
      offerName: 'Diwali offer',
      offerBefore: 'Before Diwali',
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
  /*
   * Black Friday — night stage, neon red, chrome-white headline, gold highlights
   * (the owner's two posters). `primary` is the deal red used on badges and the
   * countdown strip; `accent` is the gold of the highlight words.
   */
  blackfriday: {
    key: 'blackfriday',
    name: 'Black Friday',
    style: 'neon',
    colors: {
      primary: '#c8102e',
      onPrimary: '#ffffff',
      accent: '#ffd23f',
      glow: 'rgba(255, 45, 70, 0.85)',
    },
    particles: ['#ff2d46', '#ff5c70', '#ffffff', '#ffd23f', '#e0102f', '#ff8fa0'],
    icons: {
      lamp: '🏷️',
      garland: ['🏷️'],
    },
    copy: {
      dealBadge: 'Black Friday Deal',
      orderConfirmed: 'Black Friday win! Your order is confirmed 🎉',
      countdownLabel: 'Black Friday deals end in',
      offerName: 'Black Friday offer',
      offerBefore: 'Before Black Friday',
    },
    ticker: ['Black Friday Blowout', 'Biggest auto upgrade event', 'Limited time only', 'Shop by your car'],
    freeDeliverySeal: { top: 'Without', middle: 'Shipping, packing, delivery', bottom: 'charges' },
    // "₹0 <fee name>": the names match checkout's fee lines
    // word for word, and "free …" delivery wording is barred by the site-wide
    // guard in app/shippingWording.test.ts.
    perks: [
      { strong: '₹0', text: 'Shipping fee' },
      { strong: '₹0', text: 'Packing fee' },
      { strong: '₹0', text: 'Handling fee' },
      { strong: '₹0', text: 'Platform fee' },
      { strong: '₹0', text: 'Fuel surcharge' },
      { strong: '₹0', text: 'Docket / processing fee' },
      { strong: '₹0', text: 'Remote area fee' },
      { strong: '₹0', text: 'GST on fees' },
    ],
    home: {
      navLabel: 'Black Friday',
      heroEyebrow: 'The biggest auto upgrade event',
      heroTitle: ['Black', 'Friday', 'Blowout'],
      heroSubtitle:
        'Massive deals on premium automotive upgrades & accessories — body kits, lighting, suspension and more. Shop by your car and see only what fits.',
      heroCta: 'Shop Black Friday Deals',
      dealsTitle: 'Black Friday Deals',
      dealsSubtitle: 'Our biggest savings of the year — M.R.P. shown on every deal',
      giftTitle: 'Black Friday picks for every budget',
      giftSubtitle: 'Premium upgrades for your own car, or for someone who loves theirs',
      giftTiers: ['Quick wins', 'Serious upgrades', 'The big upgrade'],
      wishTitle: 'Black Friday Blowout — limited time only',
      wishSubtitle: 'Prices this low don\u2019t wait. Upgrade your ride before the clock runs out.',
    },
  },
};

export function getThemeTokens(themeKey: string | null | undefined): FestivalThemeTokens | null {
  if (!themeKey) return null;
  return FESTIVAL_THEMES[themeKey] ?? null;
}
