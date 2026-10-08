/**
 * The site-wide navbar: every destination stays reachable, Offers stands out, and
 * the phone menu gives a shopper Track Order plus a person to call or message.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import RedesignNav from './RedesignNav';
import { navLinks } from './homeContent';
import { SUPPORT_PHONE_TEL } from '@/lib/contactInfo';

jest.mock('next/navigation', () => ({ usePathname: () => '/' }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: false, user: null }) }));
jest.mock('@/context/CartContext', () => ({ useCart: () => ({ itemCount: 3 }) }));
jest.mock('@/hooks/queries/useAffiliate', () => ({ useMyAffiliate: () => ({ data: undefined }) }));
jest.mock('./RedesignVehicleMenu', () => {
  const Link = jest.requireActual('next/link').default;
  return { __esModule: true, default: () => <Link href="/vehicles">Vehicle Makes</Link> };
});
jest.mock('./RedesignNavSearch', () => ({ __esModule: true, default: () => <input aria-label="Search products" /> }));
jest.mock('./ProfileAvatar', () => {
  const Link = jest.requireActual('next/link').default;
  return { __esModule: true, default: () => <Link href="/profile">Profile</Link> };
});
jest.mock('@/components/profile/KarmaBadge', () => ({ __esModule: true, default: () => null }));
jest.mock('./Img', () => ({ __esModule: true, default: (p: { alt?: string }) => <img alt={p.alt} /> }));

it('keeps every nav destination and highlights Offers', () => {
  const { container } = render(<RedesignNav />);
  const bar = container.querySelector('.nav-links') as HTMLElement;
  for (const l of navLinks) {
    expect(within(bar).getByRole('link', { name: l.label })).toBeInTheDocument();
  }
  expect(within(bar).getByRole('link', { name: 'Offers' })).toHaveClass('nav-offers');
});

it('shows the cart count', () => {
  render(<RedesignNav />);
  expect(screen.getByRole('link', { name: 'Cart, 3 items' })).toBeInTheDocument();
});

it('phone menu: all links, Track Order, and call / WhatsApp buttons', () => {
  const { container } = render(<RedesignNav />);
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  const menu = container.querySelector('.nav-mobile') as HTMLElement;
  for (const l of navLinks) expect(within(menu).getByRole('link', { name: l.label })).toBeInTheDocument();
  expect(within(menu).getByRole('link', { name: /track order/i })).toHaveAttribute('href', '/track');
  expect(within(menu).getByRole('link', { name: /call/i })).toHaveAttribute('href', `tel:${SUPPORT_PHONE_TEL}`);
  expect(within(menu).getByRole('link', { name: /whatsapp/i }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\//);
  expect(within(menu).getByRole('link', { name: /sign in/i })).toBeInTheDocument();
});
