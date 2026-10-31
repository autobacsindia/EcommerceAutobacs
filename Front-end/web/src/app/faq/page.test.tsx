/**
 * /faq: every question in lib/help/faq.ts, grouped into sections you can jump
 * to, each answer pointing at the page that does what it describes — and the
 * same questions, and only those, handed to Google as FAQPage JSON-LD.
 */
import fs from 'fs';
import path from 'path';
import { render, screen, within } from '@testing-library/react';
import FAQPage from './page';
import ShippingPage from '../shipping/page';
import { ALL_FAQS, FAQ_CATEGORIES } from '@/lib/help/faq';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));
jest.mock('@/components/store/StorePageHeader', () => ({ __esModule: true, default: () => null }));

const APP = path.join(__dirname, '..');
/** True when the App Router has a page for this path (static segments; route groups like (list) allowed). */
const routeExists = (href: string) => {
  const dir = path.join(APP, ...href.split(/[?#]/)[0].split('/').filter(Boolean));
  const hasPage = (d: string) => ['page.tsx', 'page.ts'].some((f) => fs.existsSync(path.join(d, f)));
  if (!fs.existsSync(dir)) return false;
  return hasPage(dir) || fs.readdirSync(dir).some((e) => /^\(.+\)$/.test(e) && hasPage(path.join(dir, e)));
};

it('has at least ten questions, each with an answer', () => {
  expect(ALL_FAQS.length).toBeGreaterThanOrEqual(10);
  render(<FAQPage />);
  for (const f of ALL_FAQS) expect(screen.getByText(f.question)).toBeInTheDocument();
});

it('every link on the FAQ goes somewhere real', () => {
  render(<FAQPage />);
  const internal = screen.getAllByRole('link').map((a) => a.getAttribute('href') || '').filter((h) => h.startsWith('/'));
  expect(internal.length).toBeGreaterThan(10);
  for (const href of internal) expect([href, routeExists(href)]).toEqual([href, true]);
});

it('answers point to the page that does the thing', () => {
  render(<FAQPage />);
  const answerOf = (q: string) => screen.getByText(q).closest('details')!;
  expect(within(answerOf('How can I track my order?')).getByRole('link', { name: /Track an order/ })).toHaveAttribute('href', '/track');
  expect(within(answerOf('How do I return an item?')).getByRole('link', { name: /My orders/ })).toHaveAttribute('href', '/orders');
  expect(within(answerOf('I forgot my password. How can I reset it?')).getByRole('link', { name: /Reset my password/ })).toHaveAttribute('href', '/forgot-password');
});

it('the section shortcuts jump to sections that exist', () => {
  const { container } = render(<FAQPage />);
  const nav = screen.getByRole('navigation', { name: 'FAQ sections' });
  const anchors = within(nav).getAllByRole('link');
  expect(anchors).toHaveLength(FAQ_CATEGORIES.length);
  for (const a of anchors) expect(container.querySelector(a.getAttribute('href')!)).not.toBeNull();
});

it('tells Google exactly the questions on the page', () => {
  const { container } = render(<FAQPage />);
  const ld = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!);
  expect(ld['@type']).toBe('FAQPage');
  expect(ld.mainEntity.map((q: { name: string }) => q.name)).toEqual(ALL_FAQS.map((f) => f.question));
  expect(ld.mainEntity[0].acceptedAnswer.text).toBe(ALL_FAQS[0].answer);
});

it('the chat button opens WhatsApp in a new tab', () => {
  render(<FAQPage />);
  const chat = screen.getByRole('link', { name: /Chat on WhatsApp/ });
  expect(chat.getAttribute('href')).toMatch(/^https:\/\/wa\.me\//);
  expect(chat).toHaveAttribute('target', '_blank');
});

/*
  Checkout charges no shipping (it sends shippingCost: 0): the customer pays the
  courier on delivery, by cash or GPay / UPI, and the amount depends on the parcel
  and the address. The FAQ and the Shipping page used to quote ₹199 / ₹399 / ₹599
  fees nobody could be charged, then told customers delivery was free — it is not.
*/
it('neither the FAQ nor the Shipping page quotes a delivery fee', () => {
  const delivery = FAQ_CATEGORIES.find((c) => c.id === 'shipping')!.faqs.map((f) => f.answer).join(' ');
  expect(delivery).not.toMatch(/₹/);
  const { container } = render(<ShippingPage />);
  expect(container.textContent).not.toMatch(/₹/);
});

it('the FAQ and the Shipping page say shipping is extra and paid on delivery, never free', () => {
  const delivery = FAQ_CATEGORIES.find((c) => c.id === 'shipping')!.faqs.map((f) => f.answer).join(' ');
  expect(delivery).toMatch(/pay it on delivery by cash or GPay \/ UPI/);
  expect(delivery).not.toMatch(/\bfree\b/i);

  const { container } = render(<ShippingPage />);
  const text = container.textContent ?? '';
  expect(text).not.toMatch(/\bfree\b/i);
  expect(text).toMatch(/Extra — paid on delivery/);
  expect(text).toMatch(/Cash or GPay \/ UPI to the courier/);
  expect(text).toMatch(/Shipping charges are extra and paid on delivery, by cash or GPay \/ UPI\./);
});
