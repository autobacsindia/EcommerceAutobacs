/**
 * The light/dark switch.
 *
 * ── What is actually at risk here ───────────────────────────────────────────
 * The theme is one attribute on <html>, so "does it set the attribute" is the
 * easy half. The half that broke in production is subtler: a CSS property whose
 * value is `var(--token)` and which carries a `transition` does NOT re-resolve
 * when the token changes in Chromium. Every `transition-colors` element kept
 * painting the old theme's colour until the next reload — on /about-us the
 * headings stayed dark-theme white on a light card.
 *
 * The fix is to suppress transitions for the frame in which the attribute
 * changes. That is invisible to a screenshot and easy to delete as "pointless",
 * so these tests pin the sequence: the class goes on BEFORE the attribute
 * moves, and comes off afterwards. jsdom computes no styles, so the contrast
 * itself is verified against a real browser, not here.
 */
import { render, screen, act } from '@testing-library/react';
import ThemeToggle, { applyTheme, THEME_KEY } from './ThemeToggle';

const root = () => document.documentElement;

describe('applyTheme', () => {
  beforeEach(() => {
    root().removeAttribute('data-theme');
    root().className = '';
    root().style.colorScheme = '';
    localStorage.clear();
  });

  it('sets the attribute, the colour scheme and the saved choice', () => {
    applyTheme('dark');
    expect(root().getAttribute('data-theme')).toBe('dark');
    expect(root().style.colorScheme).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  it('suppresses transitions while the attribute changes, then restores them', async () => {
    applyTheme('dark');
    // Still on at this point: the class is removed two frames later, which is
    // what lets the new colours resolve before anything animates.
    expect(root().classList.contains('theme-switching')).toBe(true);

    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    });
    expect(root().classList.contains('theme-switching')).toBe(false);
  });

  it('applies the theme even when storage throws', () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(() => applyTheme('dark')).not.toThrow();
      expect(root().getAttribute('data-theme')).toBe('dark');
    } finally {
      setItem.mockRestore();
    }
  });
});

describe('ThemeToggle', () => {
  beforeEach(() => {
    root().removeAttribute('data-theme');
    root().className = '';
    localStorage.clear();
  });

  it('offers the other theme, and switches to it', async () => {
    render(<ThemeToggle />);
    const button = await screen.findByRole('button', { name: /switch to dark theme/i });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await act(async () => { button.click(); });

    expect(root().getAttribute('data-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: /switch to light theme/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('reads the theme the pre-paint script already applied, rather than assuming light', async () => {
    // ThemeScript runs before React and may already have set dark; the button
    // must not offer to "switch to dark" when the page is dark already.
    root().setAttribute('data-theme', 'dark');
    render(<ThemeToggle />);
    expect(await screen.findByRole('button', { name: /switch to light theme/i })).toBeInTheDocument();
  });
});
