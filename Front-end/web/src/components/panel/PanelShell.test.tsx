/**
 * The admin / team panel frame. It is visual, but a few things in it are
 * behaviour people rely on: the phone menu opens and gets out of the way, the
 * current page is marked for screen readers, the collapsed rail still names
 * every link, and Log out logs out.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Package, Tag } from 'lucide-react';
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
