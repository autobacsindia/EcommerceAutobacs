/**
 * React keys in the Journal carousel must be unique.
 *
 * THE BUG THIS PINS: the card was keyed on `p.href`, and every entry in the
 * `journalPosts` fallback carries href '/blog' — six identical keys. React's
 * documented response to duplicate keys is to duplicate and/or omit children,
 * so the server's markup and the client's disagreed and the home page threw
 * React #418 ("the server rendered HTML didn't match the client") on every
 * load, discarding the server-rendered tree and re-rendering it on the client.
 *
 * It was invisible for two reasons worth remembering:
 *   - It only fires when the fallback is in use, i.e. when the articles fetch
 *     returns nothing. A local build holding real articles is clean, so the
 *     bug reproduced in production and nowhere else.
 *   - A duplicate-key warning is a console.error in development only. Nothing
 *     server-side, and nothing in a production console beyond the minified #418.
 *
 * So the invariant is asserted against the DATA, which is where it broke.
 */

import { journalPosts } from './homeContent';

/** Must match the key expression in Journal.tsx. */
const keyOf = (p: { href: string; title: string }) => `${p.href}|${p.title}`;

describe('journal fallback posts', () => {
  it('exist (guards the guard — an empty list would pass vacuously)', () => {
    expect(journalPosts.length).toBeGreaterThan(1);
  });

  it('produce unique React keys', () => {
    const keys = journalPosts.map(keyOf);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('would NOT be unique on href alone — the original bug', () => {
    // Pinned deliberately: the fallback cards all point at the blog index by
    // design, so href can never be the key. If this ever starts passing, the
    // fallback data changed and the comment in Journal.tsx needs revisiting.
    const hrefs = journalPosts.map((p) => p.href);
    expect(new Set(hrefs).size).toBeLessThan(hrefs.length);
  });

  it('has a unique title per post, which is what makes the pair unique', () => {
    const titles = journalPosts.map((p) => p.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
