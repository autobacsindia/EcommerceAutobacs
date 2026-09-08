import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Source assertion on the hero carousel's CSS.
 *
 * The carousel is `position: absolute` in every mode where `.hero` is a fixed
 * 100vh/100svh stage. There is one mode where it must NOT be: the phone layout used
 * when the frame sequence opts out (reduced motion, data saver, sub-2GB device). There
 * `.hero-seq-active` never lands, `.hero` is content-height, and its children are back
 * in normal flow — so an absolutely-positioned track takes the section's only in-flow
 * content out of flow and collapses the hero to its padding. The hero disappears
 * entirely, on exactly the devices least able to report why.
 *
 * jsdom does not do layout, so a render test cannot catch this and never will. Reading
 * the stylesheet is the honest option: it pins that the reset exists, the way
 * cacheTtl.test.js pins route wiring by reading the router source.
 */

const CSS = readFileSync(join(__dirname, 'home-redesign.css'), 'utf8');

/**
 * Every `@media (max-width: 768px)` body, concatenated.
 *
 * The stylesheet has SEVERAL such blocks (nav, hero, sections…), so taking the first
 * match would silently test the wrong one — and pass vacuously the day someone moves
 * a rule between them.
 */
function stackedMobileBlocks(): string {
  const NEEDLE = '@media (max-width: 768px)';
  const bodies: string[] = [];
  let search = 0;
  for (;;) {
    const start = CSS.indexOf(NEEDLE, search);
    if (start === -1) break;
    // Walk braces so nested rules inside the media block are captured whole.
    let depth = 0;
    let i = CSS.indexOf('{', start);
    const from = i;
    for (; i < CSS.length; i++) {
      if (CSS[i] === '{') depth += 1;
      else if (CSS[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    bodies.push(CSS.slice(from, i));
    search = i;
  }
  // Guards the scanner itself: zero blocks would make every assertion below vacuous.
  expect(bodies.length).toBeGreaterThan(0);
  return bodies.join('\n');
}

describe('hero carousel CSS', () => {
  it('puts the track back in flow on the stacked (non-pinned) phone hero', () => {
    const block = stackedMobileBlocks();

    // Without these three the hero collapses to zero height whenever the frame
    // sequence opts out.
    for (const selector of [
      '.hr .hero-pin:not(.hero-seq-active) .hero .hero-carousel',
      '.hr .hero-pin:not(.hero-seq-active) .hero .hero-slide',
      '.hr .hero-pin:not(.hero-seq-active) .hero .hero-spin',
    ]) {
      expect(block).toContain(selector);
    }
    expect(block).toMatch(/\.hero-carousel\s*\{[^}]*position:\s*static/);
    expect(block).toMatch(/\.hero-slide\s*\{[^}]*position:\s*relative/);
    expect(block).toMatch(/\.hero-spin\s*\{[^}]*position:\s*relative/);
  });

  it('keeps the track absolute for the fixed-height stage modes', () => {
    // Desktop and the pinned phone hero are both fixed-height with absolutely
    // positioned children; the track must share their containing block exactly, or
    // the car shifts.
    expect(CSS).toMatch(/\.hr \.hero \.hero-carousel\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/);
    expect(CSS).toMatch(/\.hr \.hero \.hero-slide\s*\{[^}]*position:\s*absolute;\s*inset:\s*0/);
  });

  /*
    The scroll snap-back gets its own, much shorter transition. Hero.test.tsx pins that
    the class is applied; only the stylesheet says what it is worth, and jsdom computes
    no transitions, so this is the one place the duration can be held to account. If the
    two ever converge, the lock goes back to fighting the user's scroll with a 0.8s
    slide — which looks exactly like a bug and is the reason this rule exists.
  */
  it('returns from the scroll lock faster than a deliberate advance', () => {
    const seconds = (rule: RegExp) => {
      const decl = rule.exec(CSS)?.[1] ?? '';
      const ms = /transition:\s*transform\s+([\d.]+)(m?s)/.exec(decl);
      expect(ms).not.toBeNull();
      return parseFloat(ms![1]) * (ms![2] === 'ms' ? 1 : 1000);
    };

    const advance = seconds(/\.hr \.hero \.hero-carousel\s*\{([^}]*)\}/);
    const snapBack = seconds(/\.hr \.hero \.hero-carousel\.is-snapping-back\s*\{([^}]*)\}/);

    expect(snapBack).toBeLessThan(advance);
    // Short enough to be finished before the scrub has anything to show.
    expect(snapBack).toBeLessThanOrEqual(250);
  });

  it('moves the track with a transform, never a scroll container', () => {
    // A horizontal scroll container inside the sticky, pinned hero would compete for
    // the vertical drag the frame scrub depends on. See the comment in the CSS.
    const carousel = /\.hr \.hero \.hero-carousel\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(carousel).toContain('transition: transform');
    expect(carousel).not.toMatch(/overflow-x|scroll-snap/);
  });
});
