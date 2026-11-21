import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ContactFab from './ContactFab';
import { capture } from '@/lib/analytics';
import { pushToGtm } from '@/lib/gtm';
import { OPEN_HELP_BOT_EVENT } from '@/components/help/helpBotVisibility';
import {
  resetFloatingClearance,
  setBuyBarHeight,
  setBuyButtonsInView,
} from '@/lib/floatingClearance';

let pathname = '/';
jest.mock('next/navigation', () => ({ usePathname: () => pathname }));
jest.mock('@/lib/analytics', () => ({ capture: jest.fn() }));
jest.mock('@/lib/gtm', () => ({ pushToGtm: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  act(() => resetFloatingClearance());
});

const toggle = () => screen.getByRole('button', { name: /contact us|close contact options/i });
const stack = () => screen.getByTestId('contact-fab');

describe('ContactFab', () => {
  it('links WhatsApp and Call to the support number', () => {
    pathname = '/';
    render(<ContactFab />);
    expect(screen.getByLabelText(/whatsapp/i)).toHaveAttribute('href', expect.stringContaining('https://wa.me/919895257905'));
    expect(screen.getByLabelText(/call us/i)).toHaveAttribute('href', 'tel:+919895257905');
  });

  it.each(['/admin/orders', '/team', '/team/members', '/cart', '/checkout', '/checkout/success', '/staff-invite'])(
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

  describe('on phones: one "Contact us" button', () => {
    it('shows only the Contact us button until it is tapped', () => {
      pathname = '/';
      render(<ContactFab />);
      expect(toggle()).toHaveAttribute('aria-expanded', 'false');
      expect(toggle()).toHaveClass('md:hidden'); // phones only
      // Channels are hidden on phones, still shown from md up.
      for (const el of [screen.getByLabelText(/whatsapp/i), screen.getByLabelText(/call us/i)]) {
        expect(el).toHaveClass('hidden', 'md:flex');
      }
      expect(screen.getByRole('button', { name: 'Chat with us' })).toHaveClass('hidden');
    });

    it('opens a menu of WhatsApp, Call and Chat with us, and closes again', () => {
      pathname = '/';
      render(<ContactFab />);
      fireEvent.click(toggle());
      expect(toggle()).toHaveAttribute('aria-expanded', 'true');
      for (const el of [
        screen.getByLabelText(/whatsapp/i),
        screen.getByLabelText(/call us/i),
        screen.getByRole('button', { name: 'Chat with us' }),
      ]) {
        expect(el).toHaveClass('flex');
        expect(el).not.toHaveClass('hidden');
        expect(el).toHaveClass('h-12'); // 48px tap target
      }
      expect(screen.getByText('WhatsApp')).toBeInTheDocument();
      expect(screen.getByText('Call us')).toBeInTheDocument();
      fireEvent.click(toggle());
      expect(toggle()).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByLabelText(/whatsapp/i)).toHaveClass('hidden');
    });

    it('closes on Escape and on a tap elsewhere', () => {
      pathname = '/';
      render(<ContactFab />);
      fireEvent.click(toggle());
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(toggle()).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(toggle());
      fireEvent.pointerDown(document.body);
      expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    });

    it('"Chat with us" opens the help chat and counts one chat contact', () => {
      pathname = '/orders';
      const opened = jest.fn();
      window.addEventListener(OPEN_HELP_BOT_EVENT, opened);
      render(<ContactFab />);
      fireEvent.click(toggle());
      fireEvent.click(screen.getByRole('button', { name: 'Chat with us' }));
      window.removeEventListener(OPEN_HELP_BOT_EVENT, opened);
      expect(opened).toHaveBeenCalledTimes(1);
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture).toHaveBeenCalledWith('contact_click', { channel: 'chat', path: '/orders' });
      expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    });

    it('leaves Chat out where the help chat is not available', () => {
      pathname = '/login';
      render(<ContactFab />);
      expect(screen.queryByRole('button', { name: 'Chat with us' })).not.toBeInTheDocument();
      expect(screen.getByLabelText(/whatsapp/i)).toBeInTheDocument();
    });

    it('opening the menu is not itself a contact', () => {
      pathname = '/';
      render(<ContactFab />);
      fireEvent.click(toggle());
      expect(capture).not.toHaveBeenCalled();
      expect(pushToGtm).not.toHaveBeenCalled();
    });
  });

  describe('never covers the buy buttons', () => {
    it('sits 16px off the bottom with no buy bar, and keeps desktop at bottom-28', () => {
      pathname = '/products/ironman-reco-traks';
      render(<ContactFab />);
      expect(stack().style.transform).toBe('translateY(-0px)');
      expect(stack().className).toContain('bottom-[calc(16px_+_env(safe-area-inset-bottom))]');
      expect(stack()).toHaveClass('md:bottom-28');
    });

    it('lifts above the sticky buy bar by its measured height, and drops back when it hides', () => {
      pathname = '/products/ironman-reco-traks';
      render(<ContactFab />);
      act(() => setBuyBarHeight(117)); // the taller sale variant
      // A transform, not `bottom`, so the lift is not a layout shift (CLS).
      expect(stack().style.transform).toBe('translateY(-117px)');
      act(() => setBuyBarHeight(0));
      expect(stack().style.transform).toBe('translateY(-0px)');
    });

    it('steps aside on phones while Add to cart / Buy now are on screen, and closes its menu', () => {
      pathname = '/products/ironman-reco-traks';
      render(<ContactFab />);
      fireEvent.click(toggle());
      const token = {};
      act(() => setBuyButtonsInView(token, true));
      expect(stack()).toHaveClass('max-md:invisible', 'max-md:opacity-0', 'max-md:pointer-events-none');
      expect(toggle()).toHaveAttribute('aria-expanded', 'false');
      act(() => setBuyButtonsInView(token, false));
      expect(stack()).not.toHaveClass('max-md:invisible');
    });
  });

  it('reserves room after the page on phones so content can scroll clear of the button', () => {
    pathname = '/orders';
    render(<ContactFab />);
    const spacer = screen.getByTestId('fab-clearance');
    expect(spacer).toHaveClass('md:hidden');
    expect(spacer.className).toContain('h-[calc(76px');
  });

  it('records each channel tap once, in PostHog and GTM, and closes the menu', () => {
    pathname = '/orders';
    render(<ContactFab />);
    fireEvent.click(toggle());
    fireEvent.click(screen.getByLabelText(/whatsapp/i));
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByLabelText(/call us/i));
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenNthCalledWith(1, 'contact_click', { channel: 'whatsapp', path: '/orders' });
    expect(capture).toHaveBeenNthCalledWith(2, 'contact_click', { channel: 'call', path: '/orders' });
    expect(pushToGtm).toHaveBeenCalledTimes(2);
    expect(pushToGtm).toHaveBeenNthCalledWith(1, { event: 'contact_click', contact_channel: 'whatsapp', page_path: '/orders' });
    expect(pushToGtm).toHaveBeenNthCalledWith(2, { event: 'contact_click', contact_channel: 'call', page_path: '/orders' });
  });
});
