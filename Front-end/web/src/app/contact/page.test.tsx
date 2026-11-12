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

  it('shows phone and email only — no office address or working hours', () => {
    const { container } = render(<ContactPage />);
    expect(screen.getAllByText('+91 98952 57905').length).toBeGreaterThan(0);
    expect(screen.getAllByText('support@autobacsindia.com').length).toBeGreaterThan(0);
    const text = container.textContent ?? '';
    for (const gone of ['Headquarters', 'Working Hours', 'Jomer Symphony', 'Vyttila', '10:00 AM', 'Roavion']) {
      expect(text).not.toContain(gone);
    }
  });
});
