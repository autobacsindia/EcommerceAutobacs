import React from 'react';
import { render, screen } from '@testing-library/react';
import ContactFab from './ContactFab';

let pathname = '/';
jest.mock('next/navigation', () => ({ usePathname: () => pathname }));
jest.mock('@/lib/analytics', () => ({ capture: jest.fn() }));

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
});
