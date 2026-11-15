import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ContactFab from './ContactFab';
import { capture } from '@/lib/analytics';
import { pushToGtm } from '@/lib/gtm';

let pathname = '/';
jest.mock('next/navigation', () => ({ usePathname: () => pathname }));
jest.mock('@/lib/analytics', () => ({ capture: jest.fn() }));
jest.mock('@/lib/gtm', () => ({ pushToGtm: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

describe('ContactFab', () => {
  it('shows WhatsApp and Call on storefront pages', () => {
    pathname = '/';
    render(<ContactFab />);
    expect(screen.getByLabelText(/whatsapp/i)).toHaveAttribute('href', expect.stringContaining('https://wa.me/919895257905'));
    expect(screen.getByLabelText(/call us/i)).toHaveAttribute('href', 'tel:+919895257905');
  });

  it.each(['/admin/orders', '/team', '/team/members', '/checkout', '/staff-invite'])(
    'stays out of %s',
    (path) => {
      pathname = path;
      const { container } = render(<ContactFab />);
      expect(container).toBeEmptyDOMElement();
    },
  );

  it('does not hide on a page that merely starts with "team"', () => {
    pathname = '/teamwork-guide';
    render(<ContactFab />);
    expect(screen.getByLabelText(/whatsapp/i)).toBeInTheDocument();
  });

  it('includes the product link in the WhatsApp message on a product page', () => {
    pathname = '/products/ironman-reco-traks';
    render(<ContactFab />);
    const href = decodeURIComponent(screen.getByLabelText(/whatsapp/i).getAttribute('href') || '');
    expect(href).toContain('/products/ironman-reco-traks');
  });

  it('treats product search as a normal page, not a product page', () => {
    pathname = '/products/search';
    render(<ContactFab />);
    const href = decodeURIComponent(screen.getByLabelText(/whatsapp/i).getAttribute('href') || '');
    expect(href).not.toContain('/products/search');
  });

  it('shows WhatsApp and Call as separate buttons on phones too (no collapsed menu)', () => {
    pathname = '/';
    render(<ContactFab />);
    for (const el of [screen.getByLabelText(/whatsapp/i), screen.getByLabelText(/call us/i)]) {
      expect(el).not.toHaveClass('hidden');
      // 48px tap targets on phones.
      expect(el).toHaveClass('h-12', 'w-12');
    }
    expect(screen.queryByRole('button', { name: 'Contact us' })).not.toBeInTheDocument();
  });

  it('sits above the chat launcher, and higher still above the product page buy bar', () => {
    pathname = '/';
    const { container, unmount } = render(<ContactFab />);
    const stack = () => container.firstElementChild as HTMLElement;
    expect(stack().className).toContain('bottom-[calc(80px_+_env(safe-area-inset-bottom))]');
    expect(stack()).toHaveClass('md:bottom-28');
    unmount();
    pathname = '/products/ironman-reco-traks';
    const second = render(<ContactFab />);
    expect((second.container.firstElementChild as HTMLElement).className)
      .toContain('bottom-[calc(192px_+_env(safe-area-inset-bottom))]');
  });

  it('records each tap once, per channel, in PostHog and GTM', () => {
    pathname = '/cart';
    render(<ContactFab />);
    fireEvent.click(screen.getByLabelText(/whatsapp/i));
    fireEvent.click(screen.getByLabelText(/call us/i));
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenNthCalledWith(1, 'contact_click', { channel: 'whatsapp', path: '/cart' });
    expect(capture).toHaveBeenNthCalledWith(2, 'contact_click', { channel: 'call', path: '/cart' });
    expect(pushToGtm).toHaveBeenCalledTimes(2);
    expect(pushToGtm).toHaveBeenNthCalledWith(1, { event: 'contact_click', contact_channel: 'whatsapp', page_path: '/cart' });
    expect(pushToGtm).toHaveBeenNthCalledWith(2, { event: 'contact_click', contact_channel: 'call', page_path: '/cart' });
  });
});
