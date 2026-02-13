import { render, screen } from '@testing-library/react';
import Footer from './Footer';
import { APP_NAME, FOOTER_LINKS } from '@/lib/constants';

describe('Footer Component', () => {
  it('renders brand name and description', () => {
    render(<Footer />);
    expect(screen.getByText(APP_NAME)).toBeInTheDocument();
    expect(screen.getByText(/Premium automotive accessories/i)).toBeInTheDocument();
  });

  it('renders company links', () => {
    render(<Footer />);
    FOOTER_LINKS.company.forEach(link => {
      expect(screen.getByRole('link', { name: link.label })).toHaveAttribute('href', link.href);
    });
  });

  it('renders support links', () => {
    render(<Footer />);
    FOOTER_LINKS.support.forEach(link => {
      expect(screen.getByRole('link', { name: link.label })).toHaveAttribute('href', link.href);
    });
  });

  it('renders legal links', () => {
    render(<Footer />);
    FOOTER_LINKS.legal.forEach(link => {
      expect(screen.getByRole('link', { name: link.label })).toHaveAttribute('href', link.href);
    });
  });

  it('renders current year in copyright', () => {
    render(<Footer />);
    const currentYear = new Date().getFullYear();
    expect(screen.getByText(new RegExp(currentYear.toString()))).toBeInTheDocument();
    expect(screen.getByText(/All rights reserved/i)).toBeInTheDocument();
  });

  it('renders security badges', () => {
    render(<Footer />);
    expect(screen.getByText('SSL Secured')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });
});
