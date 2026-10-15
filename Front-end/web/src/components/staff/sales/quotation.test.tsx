/**
 * Quotation link and "new order for this customer": the form starts from an
 * earlier order's customer and address, fetched by id (no personal details in
 * the URL), and leaves the items empty.
 */
import fs from 'fs';
import path from 'path';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NewSalesOrderForm from './NewSalesOrderForm';
import { quotationHref } from './types';

const get = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: jest.fn() } }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const earlier = {
  id: 'o1', orderNumber: '#AB12CD34', customer: { name: 'Rithik Keloth', email: 'rithik@example.com', phone: '9633226204' },
  shippingAddress: { addressLine1: 'Keloth House', city: 'Kannur', state: 'Kerala', postalCode: '670001' },
};

const renderForm = (fromOrderId: string | null) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <NewSalesOrderForm fromOrderId={fromOrderId} />
  </QueryClientProvider>,
);

beforeEach(() => get.mockReset());

it('points at the server-rendered quotation for the order', () => {
  expect(quotationHref('66f0c0ffee00000000abcdef')).toBe('/api/v1/staff/sales/orders/66f0c0ffee00000000abcdef/quotation');
});

it('uses a path the site actually forwards to the backend', () => {
  // A plain <a href> bypasses the API client, so it must match a rewrite in
  // next.config.ts itself — '/api/staff/…' (no /v1) shipped once and was a 404.
  const config = fs.readFileSync(path.join(process.cwd(), 'next.config.ts'), 'utf8');
  const sources = [...config.matchAll(/source:\s*'([^']+)'/g)].map((m) => m[1].replace(/:path\*$/, ''));
  expect(sources.some((src) => quotationHref('x').startsWith(src))).toBe(true);
});

it('starts a new order with the earlier customer and address, and no items', async () => {
  get.mockResolvedValue({ order: earlier });
  renderForm('o1');
  await waitFor(() => expect(get).toHaveBeenCalledWith('/staff/sales/orders/o1'));
  expect(await screen.findByText(/Same customer as order #AB12CD34/)).toBeInTheDocument();
  expect(screen.getByDisplayValue('Rithik Keloth')).toBeInTheDocument();
  expect(screen.getByDisplayValue('9633226204')).toBeInTheDocument();
  expect(screen.getByDisplayValue('rithik@example.com')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Keloth House')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Kannur')).toBeInTheDocument();
});

it('a plain new order fetches nothing and starts empty', () => {
  renderForm(null);
  expect(get).not.toHaveBeenCalledWith(expect.stringMatching(/^\/staff\/sales\/orders\//));
  expect(screen.queryByText(/Same customer as order/)).toBeNull();
});
