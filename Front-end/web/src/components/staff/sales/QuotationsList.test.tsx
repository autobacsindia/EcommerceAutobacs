/**
 * The Quotations list: the tab, search, salesman, created-on dates and sort are
 * kept in the page address and sent to the server (which does the filtering, so
 * every page honours them); "Follow-up date" is offered only on the On hold tab;
 * the count and total come from the server; Clear all keeps the tab and sort.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import QuotationsList from './QuotationsList';
import { addressBar } from '@/test-utils/addressBarMock';

const get = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: jest.fn() } }));
jest.mock('next/navigation', () => jest.requireActual('@/test-utils/addressBarMock').nextNavigation);
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const wrap = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><QuotationsList /></QueryClientProvider>,
);
const lastList = () => String(get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/staff/sales/quotations')).at(-1));
const serve = ({ sellers = [] as { id: string; name: string }[], page = {} } = {}) => {
  get.mockImplementation((url: string) => Promise.resolve(url.includes('filter-options')
    ? { sellers }
    : { quotations: [], nextCursor: null, scope: sellers.length ? 'team' : 'mine', ...page }));
};

beforeEach(() => { get.mockReset(); addressBar.reset('/team/sales/quotations'); serve(); });

it('sends the search, dates and sort; keeps them in the address; Clear all keeps the tab and sort', async () => {
  wrap();
  await waitFor(() => expect(lastList()).toBe('/staff/sales/quotations?status=open'));
  fireEvent.change(screen.getByLabelText('Search quotations'), { target: { value: 'ravi kochi' } });
  await waitFor(() => expect(lastList()).toBe('/staff/sales/quotations?status=open&q=ravi+kochi'));
  fireEvent.change(screen.getByLabelText('Created on: from'), { target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'amount_desc' } });
  await waitFor(() => expect(lastList()).toBe('/staff/sales/quotations?status=open&sort=amount_desc&q=ravi+kochi&from=2026-10-01'));
  expect(addressBar.search).toBe('q=ravi+kochi&from=2026-10-01&sort=amount_desc');
  expect(await screen.findByText('No quotations match — try fewer words or clear the filters.')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: 'Accepted' }));
  fireEvent.click(screen.getByRole('button', { name: /Clear all/ }));
  await waitFor(() => expect(lastList()).toBe('/staff/sales/quotations?status=accepted&sort=amount_desc'));
  expect(screen.getByLabelText('Search quotations')).toHaveValue('');
});

it('"Follow-up date" is offered on On hold only; leaving the tab drops it', async () => {
  wrap();
  await waitFor(() => expect(lastList()).toBe('/staff/sales/quotations?status=open'));
  expect(screen.queryByRole('option', { name: 'Follow-up date (soonest)' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'On hold' }));
  fireEvent.change(await screen.findByLabelText('Sort'), { target: { value: 'follow_up' } });
  await waitFor(() => expect(lastList()).toBe('/staff/sales/quotations?status=on_hold&sort=follow_up'));
  fireEvent.click(screen.getByRole('tab', { name: 'Open' }));
  await waitFor(() => expect(lastList()).toBe('/staff/sales/quotations?status=open'));
  expect(addressBar.search).toBe('');
});

it('opens from a link; an unknown tab or a follow-up sort off the On hold tab fall back', async () => {
  addressBar.search = 'status=lost&sort=follow_up&q=Q-0042';
  wrap();
  await waitFor(() => expect(lastList()).toBe('/staff/sales/quotations?status=open&q=Q-0042'));
  expect(screen.getByRole('tab', { name: 'Open' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByLabelText('Search quotations')).toHaveValue('Q-0042');
});

it('the GTM head picks a salesman; a seller has no such choice', async () => {
  const seller = wrap();
  await waitFor(() => expect(lastList()).toBe('/staff/sales/quotations?status=open'));
  expect(screen.queryByLabelText('Salesman')).toBeNull();
  seller.unmount();

  serve({ sellers: [{ id: 'u1', name: 'Nevin' }, { id: 'u2', name: 'Arjun' }] });
  wrap();
  fireEvent.change(await screen.findByLabelText('Salesman'), { target: { value: 'u2' } });
  await waitFor(() => expect(lastList()).toBe('/staff/sales/quotations?status=open&seller=u2'));
});

it('shows the server\'s count and total, and pages with the same filters', async () => {
  const quotation = (id: string) => ({
    id, number: id, version: 1, status: 'open', hold: null, customer: { name: 'Ravi', phone: '1', email: '' },
    totalAmount: 1000, discount: null, salesPerson: null, updatedAt: '2026-10-01T05:00:00Z',
  });
  get.mockImplementation((url: string) => Promise.resolve(url.includes('filter-options') ? { sellers: [] } : url.includes('cursor=')
    ? { quotations: [quotation('Q-2')], nextCursor: null, scope: 'mine' }
    : { quotations: [quotation('Q-1')], nextCursor: 'c1', scope: 'mine', summary: { count: 2, capped: false, total: 2000 } }));
  addressBar.search = 'q=ravi';
  wrap();
  expect(await screen.findByRole('status')).toHaveTextContent('2 quotations found · total ₹2,000');
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
  await waitFor(() => expect(lastList()).toBe('/staff/sales/quotations?status=open&q=ravi&cursor=c1'));
  expect(await screen.findByText('Q-2')).toBeInTheDocument();
});
