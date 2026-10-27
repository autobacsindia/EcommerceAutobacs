/**
 * The search / filter / sort bar on the team order lists: what the person picks
 * reaches the API (the server filters, so every page honours it); typing waits
 * for a pause; Clear resets the filters but keeps the sort.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkQueueList from './work/WorkQueueList';
import { filterQuery, NO_FILTERS } from './OrderListFilters';

const get = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: jest.fn() } }));
jest.mock('./work/WorkOrderPanel', () => ({ __esModule: true, default: () => null }));

const wrap = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <WorkQueueList queue="procurement" />
  </QueryClientProvider>,
);
const lastUrl = () => String(get.mock.calls.at(-1)?.[0]);

beforeEach(() => { get.mockReset(); get.mockResolvedValue({ orders: [], nextCursor: null }); });

it('filterQuery leaves out what is not set', () => {
  expect(filterQuery(NO_FILTERS)).toBe('');
  expect(filterQuery({ q: ' hilux ', step: 'to_ship', source: 'sales', sort: 'oldest' })).toBe('&q=hilux&step=to_ship&source=sales&sort=oldest');
});

it('sends search, stage, source and sort to the server; Clear resets filters but keeps the sort', async () => {
  wrap();
  await waitFor(() => expect(get).toHaveBeenCalledWith('/staff/work?queue=procurement'));

  fireEvent.change(screen.getByLabelText('Search orders'), { target: { value: 'hilux kochi' } });
  await waitFor(() => expect(lastUrl()).toBe('/staff/work?queue=procurement&q=hilux+kochi'));

  fireEvent.change(screen.getByLabelText('Stage'), { target: { value: 'to_ship' } });
  fireEvent.change(screen.getByLabelText('Sold by'), { target: { value: 'website' } });
  fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'oldest' } });
  await waitFor(() => expect(lastUrl()).toBe('/staff/work?queue=procurement&q=hilux+kochi&step=to_ship&source=website&sort=oldest'));
  expect(await screen.findByText('No orders match these filters.')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Clear/ }));
  await waitFor(() => expect(lastUrl()).toBe('/staff/work?queue=procurement&sort=oldest'));
  expect(screen.getByLabelText('Search orders')).toHaveValue('');
});
