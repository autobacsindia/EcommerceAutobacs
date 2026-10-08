/**
 * The footer redesign must not lose any content: every column link, the social
 * profiles, the newsletter box and the copyright stay, and the contact strip adds
 * the published phone, WhatsApp, email and consultation routes.
 */
import { render, screen, within } from '@testing-library/react';
import RedesignFooter from './RedesignFooter';
import { footer } from './homeContent';
import { SUPPORT_PHONE_TEL, SUPPORT_EMAIL } from '@/lib/contactInfo';

jest.mock('./Img', () => ({ __esModule: true, default: (p: { alt?: string }) => <img alt={p.alt} /> }));

it('keeps every column link, with its destination', () => {
  render(<RedesignFooter />);
  for (const col of footer.columns) {
    expect(screen.getByRole('heading', { name: col.title })).toBeInTheDocument();
    for (const l of col.links) {
      const links = screen.getAllByRole('link', { name: l.label });
      expect(links.some((a) => a.getAttribute('href') === l.href)).toBe(true);
    }
  }
});

it('keeps the social profiles, newsletter box and copyright', () => {
  render(<RedesignFooter />);
  for (const s of footer.social) {
    expect(screen.getByRole('link', { name: s.label })).toHaveAttribute('href', s.href);
  }
  expect(screen.getByRole('textbox', { name: 'Email address' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Subscribe' })).toBeInTheDocument();
  expect(screen.getByText(footer.copyright)).toBeInTheDocument();
});

it('adds the contact strip with the published numbers', () => {
  const { container } = render(<RedesignFooter />);
  const strip = container.querySelector('.footer-contact') as HTMLElement;
  expect(within(strip).getByRole('link', { name: /call us/i })).toHaveAttribute('href', `tel:${SUPPORT_PHONE_TEL}`);
  expect(within(strip).getByRole('link', { name: /email/i })).toHaveAttribute('href', `mailto:${SUPPORT_EMAIL}`);
  expect(within(strip).getByRole('link', { name: /whatsapp/i }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\/919895257905/);
  expect(within(strip).getByRole('link', { name: /consult a specialist/i })).toHaveAttribute('href', '/consultation');
});
