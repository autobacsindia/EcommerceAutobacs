/**
 * Quotation line order.
 *
 * The PDF prints the lines in exactly the order they sit in the form, so moving
 * a row here is what changes what the customer reads. The seller needs that:
 * the item they discussed first should lead the quotation, and search results
 * arrive in whatever order the catalogue returns them.
 *
 * Buttons rather than drag-and-drop on purpose — this form gets used on a phone
 * mid-call, where a drag fights the page scroll, and buttons work by keyboard
 * and screen reader too. These tests drive them the way a person would.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NewSalesOrderForm from './NewSalesOrderForm';
import type { Quotation, QuotationLine } from './types';

jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const line = (name: string, price: number): QuotationLine => ({
  product: null, variantId: null, variantLabel: null, custom: true,
  name, image: '', quantity: 1, price, listPrice: null,
});

const quotation = (names: string[]): Quotation => ({
  id: 'q1', number: 'QT-1', version: 1, status: 'open',
  customer: { name: 'Rithik', email: '', phone: '9633226204' },
  shippingAddress: { addressLine1: 'Keloth House', city: 'Kannur', state: 'Kerala', postalCode: '670001' },
  items: names.map((n, i) => line(n, 100 * (i + 1))),
  totalAmount: 600, notes: '', validUntil: '', salesPerson: null, orderId: null,
  createdAt: '', updatedAt: '', revisions: [],
} as unknown as Quotation);

const renderWith = (names: string[]) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <NewSalesOrderForm quotation={quotation(names)} />
  </QueryClientProvider>,
);

/** The item rows, in the order they appear — each row's "Remove" label names it. */
const orderOnScreen = () =>
  screen.getAllByRole('button', { name: /^Remove / }).map((b) => b.getAttribute('aria-label')!.replace('Remove ', ''));

it('moves a line up, and the one above it takes its place', () => {
  renderWith(['Bull bar', 'Roof rack', 'Side steps']);
  expect(orderOnScreen()).toEqual(['Bull bar', 'Roof rack', 'Side steps']);

  fireEvent.click(screen.getByRole('button', { name: 'Move Side steps up' }));

  expect(orderOnScreen()).toEqual(['Bull bar', 'Side steps', 'Roof rack']);
});

it('moves a line down', () => {
  renderWith(['Bull bar', 'Roof rack', 'Side steps']);

  fireEvent.click(screen.getByRole('button', { name: 'Move Bull bar down' }));

  expect(orderOnScreen()).toEqual(['Roof rack', 'Bull bar', 'Side steps']);
});

/*
  The guards. Without them a click on an edge button wraps an item from the top
  of the quotation to the bottom — which on a shared PDF reads as a mistake the
  customer sees before the seller does.
*/
it('cannot move the first line up or the last line down', () => {
  renderWith(['Bull bar', 'Roof rack', 'Side steps']);

  expect(screen.getByRole('button', { name: 'Move Bull bar up' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Move Side steps down' })).toBeDisabled();
  // …and the inner rows stay movable in both directions.
  expect(screen.getByRole('button', { name: 'Move Roof rack up' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Move Roof rack down' })).toBeEnabled();
});

it('a single line cannot be moved at all', () => {
  renderWith(['Bull bar']);
  expect(screen.getByRole('button', { name: 'Move Bull bar up' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Move Bull bar down' })).toBeDisabled();
});

/*
  Reordering must not disturb what each line IS. The rows carry their own price
  and quantity, and a swap that moved the name but left the price behind would
  quietly misprice the quotation.
*/
it('keeps each line with its own price when the order changes', () => {
  renderWith(['Bull bar', 'Roof rack']);

  const priceOf = (name: string) => {
    const row = screen.getByRole('button', { name: `Remove ${name}` }).closest('li')!;
    return (within(row).getByDisplayValue(/^\d+$/) as HTMLInputElement).value;
  };
  const bullBarPrice = priceOf('Bull bar');

  fireEvent.click(screen.getByRole('button', { name: 'Move Bull bar down' }));

  expect(orderOnScreen()).toEqual(['Roof rack', 'Bull bar']);
  expect(priceOf('Bull bar')).toBe(bullBarPrice);
});
