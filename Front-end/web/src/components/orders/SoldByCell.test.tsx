/** "Sold by" on the admin orders list: text when unpaid; on a paid order a dropdown that asks first. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SoldByCell, { type Seller } from './SoldByCell';

const put = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { put: (...a: unknown[]) => put(...a), get: jest.fn() } }));

const SELLERS: Seller[] = [{ id: 's1', name: 'Sam', isHead: false }, { id: 's2', name: 'Hari', isHead: true }];
const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

beforeEach(() => { put.mockReset(); window.confirm = jest.fn(() => true); });

it('unpaid: just says who sold it (no dropdown)', () => {
  wrap(<SoldByCell orderId="o1" paid={false} seller={{ _id: 's1', name: 'Sam' }} sellers={SELLERS} onChanged={jest.fn()} />);
  expect(screen.getByText('Sam')).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

it('paid website order → credit it to a salesman (asks first, sends what was seen)', async () => {
  put.mockResolvedValue({});
  wrap(<SoldByCell orderId="o1" paid seller={null} sellers={SELLERS} onChanged={jest.fn()} />);
  const select = screen.getByLabelText('Sold by');
  expect(select).toHaveValue('');
  fireEvent.change(select, { target: { value: 's2' } });
  await waitFor(() => expect(put).toHaveBeenCalledWith('/staff/attribution/orders/o1', { salesUserId: 's2', expectedSalesUserId: null }));
});

it("paid salesman's order → back to Website order; the server's refusal is shown", async () => {
  put.mockRejectedValue(Object.assign(new Error('x'), { rawData: { message: 'Someone else just changed this order.' } }));
  wrap(<SoldByCell orderId="o1" paid seller={{ _id: 's1', name: 'Sam' }} sellers={SELLERS} onChanged={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('Sold by'), { target: { value: '' } });
  await waitFor(() => expect(put).toHaveBeenCalledWith('/staff/attribution/orders/o1', { salesUserId: null, expectedSalesUserId: 's1' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Someone else just changed');
});
