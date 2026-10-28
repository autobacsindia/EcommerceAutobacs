import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ParcelEta, { EtaBadge, EtaRowBadge, formatEtaDay, istDay } from './ParcelEta';
import WorkOrderPanel from './WorkOrderPanel';
import { filterQuery, NO_FILTERS, isFiltered } from '@/components/staff/OrderListFilters';
import type { WorkOrder } from './types';

const get = jest.fn();
const put = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => get(...a), post: jest.fn(), put: (...a: unknown[]) => put(...a) },
}));
jest.mock('@/lib/http/tokenManager', () => ({
  tokenManager: { ensureCsrfToken: jest.fn().mockResolvedValue(undefined), getHeaders: () => ({}) },
}));

type Parcel = WorkOrder['parcels'][number];
const parcel: Parcel = {
  id: 's1', sequence: 1, status: 'shipped', courier: 'Delhivery', trackingNumber: 'DL555',
  shippedAt: '2026-10-20T05:00:00Z', deliveredAt: null, items: [{ name: 'Snorkel', quantity: 1 }],
  photoUrl: null, canMarkDelivered: true, eta: null, etaState: 'none', etaHistory: [], canSetEta: true,
};

beforeEach(() => { get.mockReset(); put.mockReset(); });

describe('ParcelEta', () => {
  it('"Set expected delivery" opens a date picker (today … +60 days) and sends the date', () => {
    const onSave = jest.fn();
    render(<ParcelEta parcel={parcel} saving={false} onSave={onSave} />);
    expect(screen.getByText('No expected delivery date yet')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Set expected delivery' }));
    const input = screen.getByLabelText('Expected delivery date for parcel 1') as HTMLInputElement;
    expect(input.min).toBe(istDay());
    expect(input.max).toBe(istDay(60));
    fireEvent.change(input, { target: { value: istDay(3) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save date' }));

    expect(onSave).toHaveBeenCalledWith(istDay(3), '');
  });

  it('shows the date, who set it, the badge and the change history; "Change date" sends the date it showed', () => {
    const onSave = jest.fn();
    const d = istDay();
    render(<ParcelEta saving={false} onSave={onSave} parcel={{
      ...parcel, eta: { date: d, setBy: 'Midhun', setAt: '2026-10-25T05:00:00Z' }, etaState: 'due_today',
      etaHistory: [{ from: '2026-10-25', to: d, by: 'Midhun', at: '2026-10-25T05:00:00Z' }, { from: '', to: '2026-10-25', by: 'Asha', at: '2026-10-21T05:00:00Z' }],
    }} />);
    expect(screen.getByText(formatEtaDay(d))).toBeInTheDocument();
    expect(screen.getByText(/set by Midhun/)).toBeInTheDocument();
    expect(screen.getByText('Due today')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Date changes \(2\)/ }));
    expect(screen.getByText(`25/10/2026 → ${formatEtaDay(d)}`)).toBeInTheDocument();
    expect(screen.getByText('Set to 25/10/2026')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Change date' }));
    fireEvent.change(screen.getByLabelText('Expected delivery date for parcel 1'), { target: { value: istDay(4) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save date' }));
    expect(onSave).toHaveBeenCalledWith(istDay(4), d);
  });

  it('read-only for people who cannot set it; hidden when there is nothing to show', () => {
    const { rerender, container } = render(<ParcelEta saving={false} onSave={jest.fn()} parcel={{ ...parcel, canSetEta: false }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ParcelEta saving={false} onSave={jest.fn()} parcel={{ ...parcel, canSetEta: false, eta: { date: '2026-10-20', setBy: 'Midhun', setAt: null }, etaState: 'overdue' }} />);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Change date|Set expected/ })).not.toBeInTheDocument();
  });
});

describe('badges', () => {
  it('parcel badge: only due today / overdue', () => {
    const { rerender, container } = render(<EtaBadge state="upcoming" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<EtaBadge state="overdue" />);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('list badge: the most urgent of the order\'s parcels wins', () => {
    const { rerender, container } = render(<EtaRowBadge eta={{ overdue: 2, dueToday: 1, missing: 1, earliest: '2026-10-20' }} />);
    expect(screen.getByText('Overdue · 2 parcels')).toBeInTheDocument();
    rerender(<EtaRowBadge eta={{ overdue: 0, dueToday: 1, missing: 0, earliest: '2026-10-28' }} />);
    expect(screen.getByText('Due today')).toBeInTheDocument();
    rerender(<EtaRowBadge eta={{ overdue: 0, dueToday: 0, missing: 0, earliest: '2026-10-30' }} />);
    expect(screen.getByText('Expected 30/10/2026')).toBeInTheDocument();
    rerender(<EtaRowBadge eta={{ overdue: 0, dueToday: 0, missing: 1, earliest: null }} />);
    expect(screen.getByText('No delivery date')).toBeInTheDocument();
    rerender(<EtaRowBadge eta={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('deliveries filter', () => {
  it('sends ?eta= and counts as a filter', () => {
    expect(filterQuery({ ...NO_FILTERS, eta: 'overdue' })).toBe('&eta=overdue');
    expect(isFiltered({ ...NO_FILTERS, eta: 'due_today' })).toBe(true);
    expect(filterQuery(NO_FILTERS)).toBe('');
  });
});

describe('in the order panel', () => {
  const order = {
    id: 'o1', orderNumber: 'ORD1', createdAt: '2026-10-06T05:00:00Z', enteredAt: '2026-10-06T05:00:00Z',
    status: 'shipped', paymentStatus: 'paid', totalAmount: 6000, source: 'website', soldBy: 'Website',
    customer: { name: 'Ravi Kumar', email: 'ravi@example.com', phone: '9876543210' }, city: 'Kochi, Kerala',
    summary: 'Dispatched', needs: ['operations'], inWorkflow: true, owesGoodie: false,
    shippingAddress: { addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    payment: null, lines: [], parcels: [parcel], cancellations: [], history: [],
    canShip: false, canDispatchOwn: false, canContactCustomer: false,
  } as WorkOrder;

  it('saves through PUT …/parcels/:id/eta and shows the server\'s answer', async () => {
    get.mockResolvedValue({ success: true, order });
    const d = istDay(2);
    put.mockResolvedValue({ success: true, order: { ...order, parcels: [{ ...parcel, eta: { date: d, setBy: 'Midhun', setAt: null }, etaState: 'upcoming' }] } });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <WorkOrderPanel orderId="o1" />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Set expected delivery' }));
    fireEvent.change(screen.getByLabelText('Expected delivery date for parcel 1'), { target: { value: d } });
    fireEvent.click(screen.getByRole('button', { name: 'Save date' }));

    await waitFor(() => expect(put).toHaveBeenCalledWith('/staff/work/orders/o1/parcels/s1/eta', { date: d, previousDate: '' }));
    expect(await screen.findByText(formatEtaDay(d))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change date' })).toBeInTheDocument();
  });

  it('shows the server\'s refusal', async () => {
    get.mockResolvedValue({ success: true, order });
    put.mockRejectedValue(Object.assign(new Error('Someone else just changed this date. Refresh and try again.'), { status: 409 }));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <WorkOrderPanel orderId="o1" />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Set expected delivery' }));
    fireEvent.change(screen.getByLabelText('Expected delivery date for parcel 1'), { target: { value: istDay(1) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save date' }));
    expect(await screen.findByText(/Someone else just changed this date|Could not save the expected delivery date/)).toBeInTheDocument();
  });
});
