import { readFileSync } from 'fs';
import { join } from 'path';
import { GOLD, OBSIDIAN, TEXT, WEDGE_A, WEDGE_B } from './spinTheme';

/**
 * Two source assertions the rendered-output tests structurally cannot make.
 *
 * The reward wheel was restyled to match the home hero's poster dial, but the two live
 * in different worlds: the hero's colours come from CSS custom properties scoped to
 * `.hr`, and this wheel renders on the order-success page, outside that scope. Both
 * failures below are silent — nothing throws, nothing logs, and jsdom computes no
 * styles, so a snapshot or a render test would pass while the wheel painted wrong.
 */

const HR_CSS = readFileSync(
  join(__dirname, '../home/redesign/home-redesign.css'),
  'utf8',
);
const GAUGE = readFileSync(join(__dirname, 'SpinGauge.tsx'), 'utf8');

/** Read one custom property out of the `.hr` token block. */
function hrToken(name: string): string {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(HR_CSS);
  expect(m).not.toBeNull(); // a renamed token must fail here, not drift quietly
  return m![1].trim();
}

describe('spin wheel theme', () => {
  it('uses the same gold as the hero dial it was matched to', () => {
    // If someone re-skins `.hr`, this fails and names the drift rather than leaving two
    // "gold" wheels that are quietly a few shades apart on the same site.
    expect(GOLD).toBe(hrToken('gold'));
  });

  /*
    ⚠ The trap this guards.

    `var(--gold)` works in HeroSpinWheel.tsx because that component renders inside `.hr`,
    where the token is defined. Copying the same attribute into SpinGauge — the obvious
    thing to do when matching two designs — resolves to NOTHING on the order-success
    page, and an SVG paint attribute that fails to resolve falls back to its initial
    value: black. The needle would paint black on a black face and simply not exist,
    with no error in any console.
  */
  it('never paints from a CSS custom property, which does not resolve outside .hr', () => {
    expect(GAUGE).not.toMatch(/(?:fill|stroke)=(?:"|\{`?)var\(--/);
  });

  it('keeps the needle distinguishable from every wedge it can rest on', () => {
    // Including the winning wedge, which is filled GOLD — a bare gold needle vanishes
    // into the one slice it exists to point at. The outline is what prevents that.
    const needle = /<polygon[\s\S]*?\/>/.exec(GAUGE)?.[0] ?? '';
    expect(needle).toContain('fill={GOLD}');
    expect(needle).toContain('stroke={OBSIDIAN}');
  });

  it('alternates two distinct wedge fills, both darker than the label on them', () => {
    expect(WEDGE_A).not.toBe(WEDGE_B);
    const lum = (hex: string) => parseInt(hex.slice(1), 16);
    expect(lum(WEDGE_A)).toBeLessThan(lum(TEXT));
    expect(lum(WEDGE_B)).toBeLessThan(lum(TEXT));
    expect(lum(OBSIDIAN)).toBeLessThan(lum(WEDGE_A));
  });
});
