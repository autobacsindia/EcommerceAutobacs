import { render, screen, fireEvent } from '@testing-library/react';
import ContactPage from './page';
import { capture } from '@/lib/analytics';

jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
jest.mock('@/lib/analytics', () => ({ capture: jest.fn() }));
jest.mock('@/components/support/ContactForm', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/store/StorePageHeader', () => ({ __esModule: true, default: () => null }));

describe('Contact page', () => {
  it('offers the free consultation beside the contact details, and records the click', () => {
    render(<ContactPage />);
    const cta = screen.getByRole('link', { name: /Consult a specialist/i });
    expect(cta).toHaveAttribute('href', '/consultation');
    fireEvent.click(cta);
    expect(capture).toHaveBeenCalledWith('consult_cta_click', { from: 'contact' });
  });
});
