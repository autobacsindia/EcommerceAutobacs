/**
 * Admin cancellations panel.
 *
 * The behaviours that matter here are the ones that protect money and stock:
 * quantities start at ZERO (never pre-filled), the admin is warned before a packed
 * parcel is edited or the whole order is killed, and a refund is a SEPARATE, explicitly
 * pressed action that cannot be fired twice from one render.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OrderCancellations from './OrderCancellations';
import apiClient from '@/lib/api';

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));
jest.mock('lucide-react', () => {
  const Icon = () => <span />;
  return { AlertTriangle: Icon, IndianRupee: Icon, PackageX: Icon, RotateCcw: Icon };
});

const ITEM_NAMES = { i1: 'Wax', i2: 'Polish' };

const view = (over = {}) => ({
  cancellations: [],
  remaining: [
    { itemId: 'i1', name: 'Wax', quantity: 2, packed: 0 },
    { itemId: 'i2', name: 'Polish', quantity: 1, packed: 0 },
  ],
  summary: {
    orderedUnits: 3, cancelledUnits: 0, liveUnits: 3, cancellationCount: 0,
    fullyCancelled: false, partial: false, label: null,
  },
  ...over,
});

const serve = (payload: unknown) => (apiClient.get as jest.Mock).mockResolvedValue(payload);

const renderPanel = () =>
  render(<OrderCancellations orderId="o1" itemNames={ITEM_NAMES} />);

beforeEach(() => {
  jest.clearAllMocks();
  (apiClient.post as jest.Mock).mockResolvedValue({ message: 'ok' });
});

describe('the cancel form', () => {
  /*
    The parcel form pre-fills "everything left" because shipping the wrong thing is
    recoverable. Cancelling is not: it takes money out of the business. Every unit has
    to be chosen.
  */
  it('starts every quantity at zero, unlike the parcel form', async () => {
    serve(view());
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /cancel items/i }));

    expect((screen.getByLabelText(/Quantity of Wax to cancel/i) as HTMLInputElement).value).toBe('0');
    expect(screen.getByRole('button', { name: /cancel these items/i })).toBeDisabled();
  });

  it('clamps a typed quantity to what is actually cancellable', async () => {
    serve(view());
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /cancel items/i }));

    const input = screen.getByLabelText(/Quantity of Wax to cancel/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '99' } });
    expect(input.value).toBe('2');
  });

  it('sends only the chosen lines', async () => {
    serve(view());
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /cancel items/i }));
    fireEvent.change(screen.getByLabelText(/Quantity of Wax to cancel/i), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /cancel these items/i }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/orders/o1/cancellations',
        expect.objectContaining({ lines: [{ itemId: 'i1', quantity: 1 }] }),
      );
    });
  });

  // A packer may be holding that box right now.
  it('warns when the cancellation will edit a packed parcel', async () => {
    serve(view({
      remaining: [{ itemId: 'i1', name: 'Wax', quantity: 2, packed: 2 }],
    }));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /cancel items/i }));

    expect(screen.queryByText(/taken back out of it/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Quantity of Wax to cancel/i), { target: { value: '1' } });
    expect(screen.getByText(/taken back out of it/i)).toBeInTheDocument();
  });

  // Killing the last line cancels the ORDER and emails the customer — never a surprise.
  it('warns when the selection would cancel the whole order', async () => {
    serve(view());
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /cancel items/i }));

    fireEvent.change(screen.getByLabelText(/Quantity of Wax to cancel/i), { target: { value: '2' } });
    expect(screen.queryByText(/whole order/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Quantity of Polish to cancel/i), { target: { value: '1' } });
    expect(screen.getByText(/whole order/i)).toBeInTheDocument();
  });
});

describe('the refund action', () => {
  const withRecord = (refund: Record<string, unknown>) => view({
    remaining: [],
    cancellations: [{
      _id: 'c1', sequence: 1, lines: [{ itemId: 'i1', quantity: 1 }],
      cancelledAt: '2026-08-20T00:00:00Z', reason: 'out_of_stock', refund,
    }],
  });

  it('offers a refund only while one is owed', async () => {
    serve(withRecord({ productValuePaise: 40000, amountPaise: 0, status: 'pending' }));
    renderPanel();
    expect(await screen.findByRole('button', { name: /send refund/i })).toBeInTheDocument();
  });

  it('offers a RETRY after a gateway failure, and shows why it failed', async () => {
    serve(withRecord({
      productValuePaise: 40000, amountPaise: 40000, status: 'failed',
      failureReason: 'Bank declined',
    }));
    renderPanel();
    expect(await screen.findByRole('button', { name: /retry refund/i })).toBeInTheDocument();
    expect(screen.getByText('Bank declined')).toBeInTheDocument();
  });

  // Money already sent, or none owed: no button at all, so it cannot be fired twice
  // from this screen.
  it('offers no refund button once completed, or when none is due', async () => {
    serve(withRecord({ productValuePaise: 40000, amountPaise: 40000, status: 'completed' }));
    const { unmount } = renderPanel();
    await screen.findByText(/Refunded/);
    expect(screen.queryByRole('button', { name: /refund/i })).not.toBeInTheDocument();
    unmount();

    serve(withRecord({ productValuePaise: 0, amountPaise: 0, status: 'not_applicable' }));
    renderPanel();
    await screen.findByText(/No refund due/i);
    expect(screen.queryByRole('button', { name: /refund/i })).not.toBeInTheDocument();
  });

  it('disables the button while the refund is in flight', async () => {
    serve(withRecord({ productValuePaise: 40000, amountPaise: 0, status: 'pending' }));
    (apiClient.post as jest.Mock).mockImplementation(() => new Promise(() => {}));
    renderPanel();

    const button = await screen.findByRole('button', { name: /send refund/i });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('button', { name: /sending/i })).toBeDisabled());
  });

  /*
    Before sending, the figure shown is what is OWED; after, what actually went. They
    differ whenever the headroom cap bit — an earlier return having already drawn part
    of the same capture.
  */
  it('shows the owed amount before sending and the sent amount after', async () => {
    serve(withRecord({ productValuePaise: 40000, amountPaise: 0, status: 'pending' }));
    const { unmount } = renderPanel();
    expect(await screen.findByText('400.00')).toBeInTheDocument();
    unmount();

    serve(withRecord({ productValuePaise: 40000, amountPaise: 25000, status: 'completed' }));
    renderPanel();
    expect(await screen.findByText('250.00')).toBeInTheDocument();
  });
});

describe('self-hiding', () => {
  // An order with nothing cancelled and nothing cancellable has no business showing it.
  it('renders nothing when there is nothing to cancel and nothing cancelled', async () => {
    serve(view({ remaining: [], cancellations: [] }));
    const { container } = renderPanel();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('stays visible for the record once everything is cancelled', async () => {
    serve(view({
      remaining: [],
      cancellations: [{
        _id: 'c1', sequence: 1, lines: [{ itemId: 'i1', quantity: 2 }],
        refund: { productValuePaise: 100000, amountPaise: 100000, status: 'completed' },
      }],
      summary: { ...view().summary, fullyCancelled: true, label: 'Cancelled' },
    }));
    renderPanel();
    expect(await screen.findByText('Cancellation 1')).toBeInTheDocument();
  });
});
