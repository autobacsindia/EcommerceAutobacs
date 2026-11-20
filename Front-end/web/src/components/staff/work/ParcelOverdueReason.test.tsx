import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ParcelOverdueReason from './ParcelOverdueReason';
import { EtaRowBadge } from './ParcelEta';
import type { WorkOrder } from './types';

const put = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: (...a: unknown[]) => put(...a) },
}));
jest.mock('@/lib/http/tokenManager', () => ({
  tokenManager: { ensureCsrfToken: jest.fn().mockResolvedValue(undefined), getHeaders: () => ({}) },
}));

type Parcel = WorkOrder['parcels'][number];
const parcel: Parcel = {
  id: 's1', sequence: 1, status: 'shipped', courier: 'DTDC', trackingNumber: 'R100',
  shippedAt: '2026-11-14T05:00:00Z', deliveredAt: null, items: [{ name: 'Keycase', quantity: 1 }],
  photoUrl: null, canMarkDelivered: true, eta: { date: '2026-11-17', setBy: 'binu joy', setAt: null },
  etaState: 'overdue', etaHistory: [], canSetEta: true,
  overdueReason: null, overdueReasonHistory: [], canExplainOverdue: true,
};

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);

beforeEach(() => put.mockReset());

describe('ParcelOverdueReason', () => {
  it('an overdue parcel with no reason says so; procurement picks one and it is sent with the date shown', async () => {
    put.mockResolvedValue({ order: { parcels: [] } });
    wrap(<ParcelOverdueReason orderId="o1" parcel={parcel} />);
    expect(screen.getByText('No reason for overdue yet')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add reason' }));
    const save = screen.getByRole('button', { name: 'Save reason' });
    expect(save).toBeDisabled(); // nothing picked yet
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'courier_delay' } });
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: '  stuck at hub ' } });
    fireEvent.click(save);

    await waitFor(() => expect(put).toHaveBeenCalledWith(
      '/staff/work/orders/o1/parcels/s1/overdue-reason',
      { code: 'courier_delay', note: 'stuck at hub', expectedDate: '2026-11-17' },
    ));
  });

  it('"Other" needs details before it can be saved', () => {
    wrap(<ParcelOverdueReason orderId="o1" parcel={parcel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add reason' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'other' } });
    expect(screen.getByRole('button', { name: 'Save reason' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'Customer on holiday' } });
    expect(screen.getByRole('button', { name: 'Save reason' })).toBeEnabled();
  });

  it('shows the reason, who gave it and the history; no button for someone who may not give it', () => {
    wrap(<ParcelOverdueReason orderId="o1" parcel={{
      ...parcel, canExplainOverdue: false,
      overdueReason: { code: 'courier_delay', label: 'Courier delay', note: 'stuck at hub', text: 'Courier delay — stuck at hub', by: 'Aromal S', at: null },
      overdueReasonHistory: [
        { code: 'courier_delay', label: 'Courier delay', note: 'stuck at hub', forDate: '2026-11-17', by: 'Aromal S', at: '2026-11-20T05:00:00Z' },
        { code: 'supplier_delay', label: 'Supplier delay', note: '', forDate: '2026-11-17', by: 'Admin', at: '2026-11-19T05:00:00Z' },
      ],
    }} />);
    expect(screen.getByText('Courier delay — stuck at hub')).toBeInTheDocument();
    expect(screen.getByText(/by Aromal S/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reason$/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Reasons given \(2\)/ }));
    expect(screen.getByText('Supplier delay')).toBeInTheDocument();
    expect(screen.getAllByText(/was due 17\/11\/2026/)).toHaveLength(2);
  });

  it('a server refusal is shown', async () => {
    put.mockRejectedValue(new Error('A reason can only be given while the parcel is overdue.'));
    wrap(<ParcelOverdueReason orderId="o1" parcel={parcel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add reason' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'address_issue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reason' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('nothing for a parcel that is not overdue and was never explained', () => {
    const { container } = wrap(<ParcelOverdueReason orderId="o1" parcel={{ ...parcel, etaState: 'upcoming', canExplainOverdue: false }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('EtaRowBadge', () => {
  it('hovering Overdue shows the reason, or that none was given', () => {
    const { rerender } = render(<EtaRowBadge eta={{ overdue: 1, dueToday: 0, missing: 0, earliest: '2026-11-17', noReason: 1, reason: null }} />);
    expect(screen.getByTitle('No reason for overdue yet')).toHaveTextContent('Overdue· no reason');
    rerender(<EtaRowBadge eta={{ overdue: 1, dueToday: 0, missing: 0, earliest: '2026-11-17', noReason: 0, reason: { text: 'Courier delay', by: 'Aromal S', at: null } }} />);
    expect(screen.getByTitle('Reason: Courier delay (Aromal S)')).toHaveTextContent(/^Overdue$/);
  });
});
