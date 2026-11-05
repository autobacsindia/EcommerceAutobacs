import { Roboto } from 'next/font/google';

/**
 * Team chat's typeface: Roboto, the classic Google text face, self-hosted by
 * next/font (no request to Google at runtime). Exposed as `--font-gc`, which
 * chat.css applies inside `.gc-theme` only — the rest of the panel and the shop
 * keep DM Sans.
 */
export const chatFont = Roboto({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-gc',
  display: 'swap',
});
