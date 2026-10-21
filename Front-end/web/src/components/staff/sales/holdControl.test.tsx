/**
 * "On hold — customer thinking": the button parks a quotation / unpaid order with
 * a follow-up date; a held one says so and can be resumed; the lists split
 * active from on-hold.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HoldControl, { dayFromToday } from './HoldControl';
import SalesOrdersList from './SalesOrdersList';
import QuotationsList from './QuotationsList';

const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a> }));
jest.mock('qrcode.react', () => ({ QRCodeCanvas: () => <canvas /> }));
jest.mock('@/components/staff/work/WorkOrderPanel', () => ({ __esModule: true, default: () => null }));

const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

beforeEach(() => { get.mockReset(); post.mockReset(); });

describe('HoldControl', () => {
  it('puts a record on hold with a follow-up date (3 days ahead by default) and a note', async () => {
    post.mockResolvedValue({});
    const onDone = jest.fn();
    wrap(<HoldControl base="/staff/sales/quotations/q1" hold={null} what="quotation" onDone={onDone} />);

    fireEvent.click(screen.getByRole('button', { name: /On hold – customer thinking/ }));
    expect(screen.getByLabelText('Follow up on')).toHaveValue(dayFromToday(3));
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: ' Asking his brother ' } });
    fireEvent.click(screen.getByRole('button', { name: /Put on hold/ }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/sales/quotations/q1/hold', { until: dayFromToday(3), note: 'Asking his brother' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('a held record shows its follow-up and can be resumed', async () => {
    post.mockResolvedValue({});
    const onDone = jest.fn();
    wrap(<HoldControl base="/staff/sales/orders/o1" what="order" onDone={onDone}
      hold={{ since: null, until: '2026-10-24T18:30:00.000Z', note: 'Thinking', by: 'Asha', due: false }} />);
    expect(screen.getByRole('status')).toHaveTextContent(/On hold — customer thinking\. Follow up on/);
    expect(screen.getByRole('status')).toHaveTextContent('Thinking · by Asha');
    fireEvent.click(screen.getByRole('button', { name: /Resume/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/sales/orders/o1/resume', {}));
  });

  it('a due hold asks for the follow-up now', () => {
    wrap(<HoldControl base="/x" what="order" onDone={jest.fn()}
      hold={{ since: null, until: '2026-10-20T18:30:00.000Z', note: '', by: '', due: true }} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Follow up now/);
  });

  it('shows the server\'s reason when it refuses', async () => {
    post.mockRejectedValue(Object.assign(new Error('x'), { rawData: { message: 'This order was paid or changed just now — reload it.' } }));
    wrap(<HoldControl base="/staff/sales/orders/o1" hold={null} what="order" onDone={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /On hold – customer thinking/ }));
    fireEvent.click(screen.getByRole('button', { name: /Put on hold/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('paid or changed just now');
  });
});

describe('the lists', () => {
  it('my orders: Active by default, On hold on its own tab', async () => {
    get.mockResolvedValue({ orders: [], nextCursor: null, scope: 'mine' });
    wrap(<SalesOrdersList mode="sales" />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/staff/sales/orders?view=active'));
    fireEvent.click(await screen.findByRole('tab', { name: 'On hold' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/staff/sales/orders?view=on_hold'));
    expect(await screen.findByText(/Nothing on hold/)).toBeInTheDocument();
  });

  it('quotations have an On hold tab', async () => {
    get.mockResolvedValue({ quotations: [], nextCursor: null, scope: 'mine' });
    wrap(<QuotationsList />);
    fireEvent.click(await screen.findByRole('tab', { name: 'On hold' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/staff/sales/quotations?status=on_hold'));
  });
});
