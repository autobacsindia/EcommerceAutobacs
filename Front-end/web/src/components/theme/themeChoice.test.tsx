/**
 * Which theme a page shows (themeChoice.ts), the script that applies it before
 * first paint, ThemeSync after it, and the panel's Light / Dark / Match switch.
 *
 * What must hold:
 *   - the storefront shows its own choice and NEVER follows the computer
 *   - the panel shows its own choice; not chosen yet → the shop's (as before)
 *   - "match my computer" follows the OS, including a change while open
 *   - moving between shop and panel without a reload repaints the right theme
 *   - the panel switch never touches the shop's saved choice
 *   - blocked storage never throws
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PANEL_THEME_KEY, THEME_KEY, THEME_SCRIPT, savedChoice } from './themeChoice';
import ThemeSync from './ThemeSync';
import PanelThemeSwitch from '@/components/panel/PanelThemeSwitch';

let mockPath = '/team';
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }));

const root = () => document.documentElement;
const theme = () => root().getAttribute('data-theme');

// A controllable prefers-color-scheme.
let osDark = false;
const listeners = new Set<() => void>();
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({
      get matches() { return q.includes('dark') && osDark; },
      media: q,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }),
  });
});
const setOs = (dark: boolean) => { osDark = dark; listeners.forEach((fn) => fn()); };

const at = (path: string) => window.history.replaceState(null, '', path);
// eslint-disable-next-line no-new-func
const runScript = () => new Function(THEME_SCRIPT)();

beforeEach(() => {
  localStorage.clear();
  root().removeAttribute('data-theme');
  root().style.colorScheme = '';
  osDark = false;
  listeners.clear();
  mockPath = '/team';
  at('/');
});

describe('before first paint (THEME_SCRIPT)', () => {
  it('the shop: light by default, dark when chosen, never the computer', () => {
    osDark = true;
    at('/products/brake-pads');
    runScript();
    expect(theme()).toBe('light');
    localStorage.setItem(THEME_KEY, 'dark');
    runScript();
    expect(theme()).toBe('dark');
    expect(root().style.colorScheme).toBe('dark');
  });

  it('the shop ignores the panel choice', () => {
    localStorage.setItem(PANEL_THEME_KEY, 'dark');
    at('/cart');
    runScript();
    expect(theme()).toBe('light');
  });

  it('the panel: the shop\'s choice until one is made, then its own', () => {
    at('/team/chat');
    localStorage.setItem(THEME_KEY, 'dark');
    runScript();
    expect(theme()).toBe('dark');
    localStorage.setItem(PANEL_THEME_KEY, 'light');
    runScript();
    expect(theme()).toBe('light');
    at('/admin/orders');
    localStorage.setItem(PANEL_THEME_KEY, 'system');
    osDark = true;
    runScript();
    expect(theme()).toBe('dark');
  });

  it('a path that only starts with the word is not the panel', () => {
    localStorage.setItem(PANEL_THEME_KEY, 'dark');
    at('/teams-of-the-year');
    runScript();
    expect(theme()).toBe('light');
  });

  it('blocked storage: light, no throw', () => {
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      at('/team');
      expect(() => runScript()).not.toThrow();
      expect(theme()).toBe('light');
      expect(savedChoice('/team')).toBe('light');
    } finally {
      get.mockRestore();
    }
  });
});

describe('after hydration (ThemeSync)', () => {
  it('repaints when moving between the panel and the shop without a reload', () => {
    localStorage.setItem(PANEL_THEME_KEY, 'dark');
    mockPath = '/team/tasks';
    const { rerender } = render(<ThemeSync />);
    expect(theme()).toBe('dark');
    mockPath = '/';
    rerender(<ThemeSync />);
    expect(theme()).toBe('light');
  });

  it('"match my computer" follows the computer while the page is open', () => {
    localStorage.setItem(PANEL_THEME_KEY, 'system');
    render(<ThemeSync />);
    expect(theme()).toBe('light');
    act(() => setOs(true));
    expect(theme()).toBe('dark');
    act(() => setOs(false));
    expect(theme()).toBe('light');
  });

  it('a fixed choice ignores the computer', () => {
    localStorage.setItem(PANEL_THEME_KEY, 'light');
    render(<ThemeSync />);
    act(() => setOs(true));
    expect(theme()).toBe('light');
  });
});

describe('the panel switch', () => {
  it('offers three choices, saves the pick for the panel only, and paints it', async () => {
    at('/team');
    localStorage.setItem(THEME_KEY, 'light');
    render(<PanelThemeSwitch />);
    fireEvent.click(screen.getByRole('button', { name: /Colours: Light/ }));
    expect(screen.getByRole('button', { name: 'Light', pressed: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(theme()).toBe('dark');
    expect(localStorage.getItem(PANEL_THEME_KEY)).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('light'); // the shop is untouched
    expect(screen.queryByRole('group', { name: 'Colours' })).toBeNull();

    osDark = false;
    fireEvent.click(screen.getByRole('button', { name: /Colours: Dark/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Match my computer' }));
    expect(localStorage.getItem(PANEL_THEME_KEY)).toBe('system');
    expect(theme()).toBe('light');
    expect(screen.getByRole('button', { name: /Colours: Match my computer/ })).toBeInTheDocument();
  });

  it('closes on Escape and on a click elsewhere', () => {
    at('/team');
    render(<div><PanelThemeSwitch /><p>outside</p></div>);
    const toggle = screen.getByRole('button', { name: /Colours/ });
    fireEvent.click(toggle);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Colours' })).toBeNull();
    fireEvent.click(toggle);
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByRole('group', { name: 'Colours' })).toBeNull();
  });
});
