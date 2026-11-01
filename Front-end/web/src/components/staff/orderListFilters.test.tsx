/**
 * The search / filter / sort bar on the team order lists (work lists, Order
 * processing / Delivered, a seller's own orders). What the person picks is kept
 * in the page address and reaches the API (the server filters, so every page
 * honours it); typing waits for a pause; Clear all resets the filters but keeps
 * the sort (and the seller's tab); a link opens the same view; values a list
 * does not offer are ignored.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkQueueList from './work/WorkQueueList';
import SalesOrdersList from './sales/SalesOrdersList';
import { addressBar } from '@/test-utils/addressBarMock';

const get = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: jest.fn() } }));
jest.mock('next/navigation', () => jest.requireActual('@/test-utils/addressBarMock').nextNavigation);
jest.mock('./work/WorkOrderPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
jest.mock('qrcode.react', () => ({ QRCodeCanvas: () => <canvas /> }));

const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);
/** The last list request (the filter-options call is not one). */
const lastList = () => String(get.mock.calls.map((c) => String(c[0])).filter((u) => !u.includes('filter-options')).at(-1));

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((url: string) => Promise.resolve(url.includes('filter-options') ? { sellers: [] } : { orders: [], nextCursor: null }));
});

describe('work lists', () => {
  beforeEach(() => addressBar.reset('/team/procurement'));

  it('sends search, stage, source, dates and sort; keeps them in the address; Clear all keeps the sort', async () => {
    wrap(<WorkQueueList queue="procurement" />);
    await waitFor(() => expect(lastList()).toBe('/staff/work?queue=procurement'));

    fireEvent.change(screen.getByLabelText('Search orders'), { target: { value: 'hilux kochi' } });
    await waitFor(() => expect(lastList()).toBe('/staff/work?queue=procurement&q=hilux+kochi'));
    expect(addressBar.search).toBe('q=hilux+kochi');

    fireEvent.change(screen.getByLabelText('Stage'), { target: { value: 'to_ship' } });
    fireEvent.change(screen.getByLabelText('Sold by'), { target: { value: 'website' } });
    fireEvent.change(screen.getByLabelText('Ordered on: from'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'oldest' } });
    await waitFor(() => expect(lastList()).toBe('/staff/work?queue=procurement&q=hilux+kochi&step=to_ship&source=website&from=2026-10-01&sort=oldest'));
    expect(await screen.findByText('No orders match — try fewer words or clear the filters.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Clear all/ }));
    await waitFor(() => expect(lastList()).toBe('/staff/work?queue=procurement&sort=oldest'));
    expect(addressBar.search).toBe('sort=oldest');
    expect(screen.getByLabelText('Search orders')).toHaveValue('');
  });

  it('opens from a link with its filters; a work list offers no amount sort or amount range', async () => {
    addressBar.search = 'q=arun&step=shipped&sort=amount_desc&min=500&paid=paid';
    wrap(<WorkQueueList queue="procurement" />);
    // amount_desc, min and paid are not on a work list: ignored, not sent.
    await waitFor(() => expect(lastList()).toBe('/staff/work?queue=procurement&q=arun&step=shipped'));
    expect(screen.getByLabelText('Search orders')).toHaveValue('arun');
    expect(screen.getByLabelText('Sort')).toHaveValue('newest');
    expect(screen.queryByLabelText('Amount: from')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Expected delivery')).not.toBeInTheDocument();
  });

  it('Deliveries: the expected-delivery filter is sent and counts as a filter', async () => {
    addressBar.reset('/team/deliveries');
    wrap(<WorkQueueList queue="deliveries" />);
    fireEvent.change(await screen.findByLabelText('Expected delivery'), { target: { value: 'overdue' } });
    await waitFor(() => expect(lastList()).toBe('/staff/work?queue=deliveries&eta=overdue'));
    expect(screen.getByRole('button', { name: /Clear all/ })).toBeInTheDocument();
  });

  it('says how many are shown, with a + when more follow; the next page keeps the filters', async () => {
    const row = (i: number) => ({
      id: `o${i}`, orderNumber: `N${i}`, createdAt: '2026-10-01T05:00:00Z', enteredAt: '2026-10-01T05:00:00Z',
      customer: { name: `C${i}` }, soldBy: 'Website', city: 'Kochi', lines: [], summaryStage: 'stock_check', summary: 'New Order',
    });
    get.mockImplementation((url: string) => Promise.resolve(url.includes('cursor=')
      ? { orders: [row(3)], nextCursor: null }
      : { orders: [row(1), row(2)], nextCursor: 'c1' }));
    addressBar.search = 'q=kochi';
    wrap(<WorkQueueList queue="procurement" />);
    expect(await screen.findByRole('status')).toHaveTextContent('2+ orders found');
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(lastList()).toBe('/staff/work?queue=procurement&q=kochi&cursor=c1'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('3 orders found'));
  });
});

describe('Order processing / Delivered', () => {
  beforeEach(() => addressBar.reset('/team/orders'));

  it('offers amount sorts and an amount range, and shows the server\'s count and total', async () => {
    get.mockResolvedValue({ orders: [], nextCursor: null, summary: { count: 12, capped: false, total: 84500 } });
    wrap(<SalesOrdersList mode="paid" stage="processing" />);
    await waitFor(() => expect(lastList()).toBe('/staff/orders/paid?stage=processing'));
    expect(await screen.findByRole('status')).toHaveTextContent('12 orders found · total ₹84,500');

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'amount_desc' } });
    fireEvent.change(screen.getByLabelText('Amount: from'), { target: { value: '1000' } });
    fireEvent.blur(screen.getByLabelText('Amount: from'));
    await waitFor(() => expect(lastList()).toBe('/staff/orders/paid?stage=processing&min=1000&sort=amount_desc'));
    expect(screen.queryByLabelText('Stage')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Payment')).not.toBeInTheDocument();
  });

  it('a huge match reads 1,000+ and asks for narrower filters instead of a total', async () => {
    get.mockResolvedValue({ orders: [], nextCursor: null, summary: { count: 1000, capped: true, total: null } });
    wrap(<SalesOrdersList mode="paid" stage="delivered" />);
    expect(await screen.findByRole('status')).toHaveTextContent('1,000+ orders found — narrow the dates or filters to see the total');
  });
});

describe('a seller\'s own orders', () => {
  beforeEach(() => addressBar.reset('/team/sales'));

  it('Paid / Not paid yet and dates; the tab stays when Clear all is pressed', async () => {
    wrap(<SalesOrdersList mode="sales" />);
    await waitFor(() => expect(lastList()).toBe('/staff/sales/orders?view=active'));
    fireEvent.click(screen.getByRole('tab', { name: 'On hold' }));
    fireEvent.change(screen.getByLabelText('Payment'), { target: { value: 'unpaid' } });
    await waitFor(() => expect(lastList()).toBe('/staff/sales/orders?paid=unpaid&view=on_hold'));
    // A seller gets no "Salesman" choices from the server, so none are shown.
    expect(screen.queryByLabelText('Salesman')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Clear all/ }));
    await waitFor(() => expect(lastList()).toBe('/staff/sales/orders?view=on_hold'));
  });

  it('the GTM head can narrow to one salesman', async () => {
    get.mockImplementation((url: string) => Promise.resolve(url.includes('filter-options')
      ? { sellers: [{ id: 'u1', name: 'Nevin' }, { id: 'u2', name: 'Arjun' }] }
      : { orders: [], nextCursor: null, scope: 'team', summary: { count: 0, capped: false, total: 0 } }));
    wrap(<SalesOrdersList mode="sales" />);
    fireEvent.change(await screen.findByLabelText('Salesman'), { target: { value: 'u2' } });
    await waitFor(() => expect(lastList()).toBe('/staff/sales/orders?seller=u2&view=active'));
    expect(addressBar.search).toBe('seller=u2');
  });

  it('two quick changes in a row both stick (the address lands a render later)', async () => {
    addressBar.defer = true;
    wrap(<SalesOrdersList mode="sales" />);
    await waitFor(() => expect(lastList()).toBe('/staff/sales/orders?view=active'));
    act(() => {
      fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'amount_asc' } });
      fireEvent.change(screen.getByLabelText('Payment'), { target: { value: 'paid' } });
    });
    await waitFor(() => expect(addressBar.search).toBe('sort=amount_asc&paid=paid'));
  });
});
