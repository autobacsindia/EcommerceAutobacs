/**
 * The FAQ's "Still need help?" box. Its second button pointed at /support/chat,
 * a page that has never existed, so every shopper who reached the bottom of the
 * FAQ without an answer landed on a 404.
 */
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import FAQPage from './page';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));
jest.mock('@/components/store/StorePageHeader', () => ({ __esModule: true, default: () => null }));

const APP = path.join(__dirname, '..');
/** True when the App Router has a page for this path (static segments only). */
const routeExists = (href: string) => {
  const dir = path.join(APP, ...href.split(/[?#]/)[0].split('/').filter(Boolean));
  return ['page.tsx', 'page.ts'].some((f) => fs.existsSync(path.join(dir, f)));
};

it('every link on the FAQ goes somewhere real', () => {
  render(<FAQPage />);
  const internal = screen.getAllByRole('link').map((a) => a.getAttribute('href') || '').filter((h) => h.startsWith('/'));
  expect(internal.length).toBeGreaterThan(0);
  for (const href of internal) expect([href, routeExists(href)]).toEqual([href, true]);
});

it('the chat button opens WhatsApp in a new tab', () => {
  render(<FAQPage />);
  const chat = screen.getByRole('link', { name: /Chat on WhatsApp/ });
  expect(chat.getAttribute('href')).toMatch(/^https:\/\/wa\.me\//);
  expect(chat).toHaveAttribute('target', '_blank');
});
