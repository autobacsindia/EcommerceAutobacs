/**
 * The admin / team panel frame. It is visual, but a few things in it are
 * behaviour people rely on: the phone menu opens and gets out of the way, the
 * current page is marked for screen readers, the collapsed rail still names
 * every link, and Log out logs out.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { GraduationCap, LifeBuoy, Package, Tag } from 'lucide-react';
import PanelShell, { type PanelNavSection } from './PanelShell';

let pathname = '/admin/orders';
jest.mock('next/navigation', () => ({ usePathname: () => pathname }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));
jest.mock('@/components/notifications/PushPrompt', () => ({ __esModule: true, default: () => null }));

const sections = (expanded = true, onToggle = jest.fn()): PanelNavSection[] => [
  { items: [{ href: '/admin/orders', label: 'Orders', icon: Package, active: true, count: 3 }] },
  { title: 'Catalog', expanded, onToggle, items: [{ href: '/admin/brands', label: 'Brands', icon: Tag, active: false }] },
];

const shell = (props: Partial<React.ComponentProps<typeof PanelShell>> = {}) => render(
  <PanelShell
    homeHref="/admin"
    subtitle="Admin panel"
    sections={sections()}
    heading={<h2>Orders</h2>}
    user={{ name: 'Autobacs India', role: 'Admin' }}
    onLogout={jest.fn()}
    {...props}
  >
    <p>page content</p>
  </PanelShell>,
);

beforeEach(() => { pathname = '/admin/orders'; });

it('renders the page inside the frame, with the logo linking home', () => {
  shell();
  expect(screen.getByText('page content')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Roavion' }).closest('a')).toHaveAttribute('href', '/admin');
  expect(screen.getByText('Admin panel')).toBeInTheDocument();
});

it('marks the current page for screen readers, and shows unread counts', () => {
  shell();
  expect(screen.getByRole('link', { name: /Orders/ })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: /Brands/ })).not.toHaveAttribute('aria-current');
  expect(screen.getByLabelText('3 unread')).toBeInTheDocument();
});

it('a collapsed section hides its links; its header toggles it', () => {
  const onToggle = jest.fn();
  shell({ sections: sections(false, onToggle) });
  expect(screen.queryByRole('link', { name: /Brands/ })).toBeNull();
  const header = screen.getByRole('button', { name: 'Catalog' });
  expect(header).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(header);
  expect(onToggle).toHaveBeenCalledTimes(1);
});

it('phone menu: opens from the top bar and closes on Escape, the backdrop, or navigating', () => {
  const { rerender } = shell();
  const menu = document.getElementById('panel-menu')!;
  const open = screen.getByRole('button', { name: 'Open menu' });
  expect(menu).toHaveAttribute('data-open', 'false');

  fireEvent.click(open);
  expect(menu).toHaveAttribute('data-open', 'true');
  expect(open).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(menu).toHaveAttribute('data-open', 'false');

  fireEvent.click(open);
  // The backdrop and the X in the drawer are both "Close menu".
  fireEvent.click(screen.getAllByRole('button', { name: 'Close menu' })[0]);
  expect(menu).toHaveAttribute('data-open', 'false');

  fireEvent.click(open);
  pathname = '/admin/brands';
  act(() => {
    rerender(
      <PanelShell homeHref="/admin" subtitle="Admin panel" sections={sections()} heading={<h2>Brands</h2>} user={{ name: 'A' }} onLogout={jest.fn()}>
        <p>page content</p>
      </PanelShell>,
    );
  });
  expect(menu).toHaveAttribute('data-open', 'false');
});

it('the collapsed rail keeps every link named and offers to expand', () => {
  const onToggleCollapsed = jest.fn();
  shell({ collapsed: true, onToggleCollapsed });
  // Labels become screen-reader-only on the rail, not removed.
  expect(screen.getByRole('link', { name: /Brands/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Expand menu' }));
  expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
});

it('Log out calls the panel’s logout', () => {
  const onLogout = jest.fn();
  shell({ onLogout });
  fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
  expect(onLogout).toHaveBeenCalledTimes(1);
});

describe('hover rail (every panel page)', () => {
  beforeEach(() => { jest.useFakeTimers(); localStorage.clear(); });
  afterEach(() => { jest.useRealTimers(); });
  const menu = () => document.getElementById('panel-menu')!;
  const page = () => screen.getByText('page content').closest('div.flex.min-h-screen')!;

  it('is off unless asked: other pages keep the full sidebar, with no pin', () => {
    shell();
    expect(menu()).not.toHaveAttribute('data-rail');
    expect(menu().className).toContain('md:w-64');
    expect(page().className).toContain('md:ml-64');
    expect(screen.queryByRole('button', { name: 'Keep menu open' })).toBeNull();
  });

  it('starts as icons, every link still named; the page sits beside the rail', () => {
    shell({ hoverRail: true });
    expect(menu()).toHaveAttribute('data-rail', 'rail');
    expect(menu().className).toContain('md:w-[60px]');
    expect(page().className).toContain('md:ml-[60px]');
    expect(screen.getByRole('link', { name: /Brands/ })).toBeInTheDocument();
  });

  it('hover opens it over the page after a moment; leaving closes it; the page never moves', () => {
    shell({ hoverRail: true });
    fireEvent.mouseEnter(menu());
    expect(menu()).toHaveAttribute('data-rail', 'rail');
    act(() => { jest.advanceTimersByTime(150); });
    expect(menu()).toHaveAttribute('data-rail', 'peek');
    expect(menu().className).toContain('md:w-64');
    expect(page().className).toContain('md:ml-[60px]');
    fireEvent.mouseLeave(menu());
    act(() => { jest.advanceTimersByTime(250); });
    expect(menu()).toHaveAttribute('data-rail', 'rail');
  });

  it('a mouse just crossing it does not open it', () => {
    shell({ hoverRail: true });
    fireEvent.mouseEnter(menu());
    act(() => { jest.advanceTimersByTime(50); });
    fireEvent.mouseLeave(menu());
    act(() => { jest.advanceTimersByTime(500); });
    expect(menu()).toHaveAttribute('data-rail', 'rail');
  });

  it('keyboard focus opens it at once; Escape closes it; tabbing out closes it', () => {
    shell({ hoverRail: true });
    const link = screen.getByRole('link', { name: /Orders/ });
    fireEvent.focus(link);
    expect(menu()).toHaveAttribute('data-rail', 'peek');
    fireEvent.keyDown(link, { key: 'Escape' });
    expect(menu()).toHaveAttribute('data-rail', 'rail');
    fireEvent.focus(link);
    fireEvent.blur(link, { relatedTarget: document.body });
    act(() => { jest.advanceTimersByTime(250); });
    expect(menu()).toHaveAttribute('data-rail', 'rail');
  });

  it('the pin keeps it open beside the page, and this device remembers it', () => {
    const { unmount } = shell({ hoverRail: true });
    fireEvent.click(screen.getByRole('button', { name: 'Keep menu open' }));
    expect(menu()).toHaveAttribute('data-rail', 'pinned');
    expect(page().className).toContain('md:ml-64');
    expect(localStorage.getItem('panel-rail-pinned')).toBe('1');
    unmount();
    shell({ hoverRail: true });
    expect(menu()).toHaveAttribute('data-rail', 'pinned');
    fireEvent.click(screen.getByRole('button', { name: 'Unpin menu' }));
    expect(menu()).toHaveAttribute('data-rail', 'rail');
    expect(localStorage.getItem('panel-rail-pinned')).toBe('0');
  });

  it('still works when the browser blocks storage', () => {
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    shell({ hoverRail: true });
    fireEvent.click(screen.getByRole('button', { name: 'Keep menu open' }));
    expect(menu()).toHaveAttribute('data-rail', 'pinned');
    get.mockRestore(); set.mockRestore();
  });

  it('opening and closing it never re-renders the page under it (the Tasks board is big)', () => {
    let renders = 0;
    const Page = () => { renders += 1; return <p>page content</p>; };
    // The layout builds the page element once; the shell only passes it through.
    const page = <Page />;
    render(
      <PanelShell homeHref="/team" subtitle="Team" sections={sections()} heading={<h2>Tasks</h2>} user={{ name: 'A' }} onLogout={jest.fn()} hoverRail>
        {page}
      </PanelShell>,
    );
    const before = renders;
    fireEvent.mouseEnter(menu());
    act(() => { jest.advanceTimersByTime(150); });
    fireEvent.mouseLeave(menu());
    act(() => { jest.advanceTimersByTime(250); });
    expect(menu()).toHaveAttribute('data-rail', 'rail');
    expect(renders).toBe(before);
  });

  it('phones keep the drawer: the menu button opens it with full labels', () => {
    shell({ hoverRail: true });
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(menu()).toHaveAttribute('data-open', 'true');
    expect(menu().className).toContain('md:w-64');
  });

  it('touch tablets (no hover) keep the menu button: the frame is marked so panel.css can show it', () => {
    const { container } = shell({ hoverRail: true });
    expect(container.firstChild).toHaveClass('pn-rail-touch');
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveClass('pn-menu-btn');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getAllByRole('button', { name: 'Close menu' })[0]).toHaveClass('pn-menu-backdrop');
  });

  it('page padding is separate from the rail: only tight pages (Tasks) lose it', () => {
    const { unmount } = shell({ hoverRail: true });
    expect(screen.getByRole('main').className).toContain('lg:p-8');
    unmount();
    shell({ hoverRail: true, tightPage: true });
    expect(screen.getByRole('main').className).toContain('md:p-5');
  });
});

/* ── "More": one shared group for the less-used links ───────────────────── */

describe('"More" group', () => {
  const withMore = (more: PanelNavSection['more']): PanelNavSection[] => [
    { items: [{ href: '/team', label: 'Dashboard', icon: Package, active: false }], more },
  ];
  const lessons = (active = false, count?: number) => ({ href: '/team/lessons', label: 'Lessons', icon: GraduationCap, active, count });
  const help = { href: '/team/help', label: 'Help', icon: LifeBuoy, active: false };

  it('starts closed, opens and closes on click, with aria-expanded and aria-controls', () => {
    shell({ sections: withMore([lessons(), help]) });
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: /Lessons/ })).toBeNull();
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    const list = document.getElementById(more.getAttribute('aria-controls')!)!;
    expect(list).toContainElement(screen.getByRole('link', { name: /Lessons/ }));
    expect(list).toContainElement(screen.getByRole('link', { name: /Help/ }));
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: /Lessons/ })).toBeNull();
  });

  it('is a real button, so Enter and Space work from the keyboard', () => {
    shell({ sections: withMore([lessons()]) });
    const more = screen.getByRole('button', { name: 'More' });
    expect(more.tagName).toBe('BUTTON');
    expect(more).toHaveAttribute('type', 'button');
  });

  it('opens by itself and marks itself when the current page is inside it; the person can still close it', () => {
    shell({ sections: withMore([lessons(true), help]) });
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: /Lessons/ })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'false');
    // Closed over the current page: "More" itself still shows where you are.
    expect(more).toHaveAttribute('data-active', 'true');
  });

  it('opens again for the next page if that page lives inside it', () => {
    const { rerender } = shell({ sections: withMore([lessons(), help]) });
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'false');
    pathname = '/team/lessons';
    rerender(
      <PanelShell homeHref="/team" subtitle="Team" sections={withMore([lessons(true), help])} heading={<h2>Lessons</h2>} user={{ name: 'Kim' }} onLogout={jest.fn()}>
        <p>page content</p>
      </PanelShell>,
    );
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('rolls hidden unread counts up onto "More" while it is closed', () => {
    shell({ sections: withMore([lessons(false, 4), help]) });
    const more = screen.getByRole('button', { name: 'More, 4 unread' });
    expect(more).toHaveTextContent('4');
    fireEvent.click(more);
    // Open: the count sits on the item itself, not twice.
    expect(more).toHaveAccessibleName('More');
    expect(screen.getByLabelText('4 unread')).toBeInTheDocument();
  });

  it('is hidden when nothing is left in it after permissions', () => {
    shell({ sections: withMore([]) });
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    shell({ sections: withMore(undefined) });
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('on the icon rail it stays named for screen readers and hovers', () => {
    localStorage.clear();
    shell({ hoverRail: true, sections: withMore([lessons()]) });
    expect(document.getElementById('panel-menu')).toHaveAttribute('data-rail', 'rail');
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('title', 'More');
    fireEvent.click(more);
    expect(screen.getByRole('link', { name: /Lessons/ })).toHaveAttribute('title', 'Lessons');
  });
});
