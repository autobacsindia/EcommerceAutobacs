/**
 * "Consult a specialist" must stay easy to see. Customers reported missing it when
 * it was faint gold hairline text that faded in 1.3s late beside the chat bubbles.
 * jsdom does no layout or paint, so the stylesheet is read directly (the same
 * approach as heroCarouselCss.test.ts).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, screen } from '@testing-library/react';
import Hero from './Hero';

jest.mock('./HeroSequence', () => ({
  __esModule: true,
  default: () => null,
  HERO_LAYOUT_SCRIPT: '',
  useHeroLayoutClass: () => {},
}));

const CSS = readFileSync(join(__dirname, 'home-redesign.css'), 'utf8');
const rule = (selector: RegExp) => selector.exec(CSS)?.[1] ?? '';

describe('Consult a specialist button', () => {
  it('renders as a link to the consultation page, with an icon and readable label', () => {
    render(<Hero />);
    const link = screen.getByRole('link', { name: /consult a specialist/i });
    expect(link).toHaveAttribute('href', '/consultation');
    expect(link.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('is styled to be seen: solid border, light bold text, arrives with the other CTAs', () => {
    const btn = rule(/\.hr \.hero \.hero-consult\s*\{([^}]*)\}/);
    expect(btn).toMatch(/border:\s*1\.5px solid var\(--gold\)/);
    expect(btn).toMatch(/font-weight:\s*600/);
    expect(btn).toMatch(/color:\s*#f7f0e3/);
    const delay = /animation:\s*hr-fadeUp\s+[\d.]+s\s+ease\s+([\d.]+)s/.exec(btn);
    expect(delay).not.toBeNull();
    expect(Number(delay![1])).toBeLessThanOrEqual(0.5); // not 1.3s behind everything else
  });

  it('sits clear of the fixed WhatsApp + call bubbles on the pinned phone hero', () => {
    const wrap = rule(/\.hr \.hero-pin\.hero-seq-layout \.hero \.hero-consult-wrap\s*\{([^}]*)\}/);
    const bottom = /bottom:\s*(\d+)px/.exec(wrap);
    expect(bottom).not.toBeNull();
    // The two bubbles stack ~128px up from the bottom edge.
    expect(Number(bottom![1])).toBeGreaterThanOrEqual(128);
  });
});
